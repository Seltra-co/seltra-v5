//ai/providers/cloudflare-images.ts
import * as crypto from 'crypto'
import { prisma } from '../../db'
import { uploadImageBuffer } from '../../store/cloudinary.service'
import {
  CF_API_BASE,
  fetchWithTimeout,
  getModelState,
  isModelAvailable,
  recordError,
  recordSuccess,
} from '../../providers/cloudflare'

const IMAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30
const IMAGE_MODEL_TIMEOUT_MS: Record<string, number> = {
  '@cf/black-forest-labs/flux-2-dev': 90_000,
  '@cf/black-forest-labs/flux-2-klein-9b': 70_000,
  '@cf/black-forest-labs/flux-2-klein-4b': 60_000,
  '@cf/black-forest-labs/flux-1-schnell': 45_000,
}

const MULTIPART_MODELS = new Set([
  '@cf/black-forest-labs/flux-2-dev',
  '@cf/black-forest-labs/flux-2-klein-9b',
  '@cf/black-forest-labs/flux-2-klein-4b',
])

// Every product/hero image gets this appended. Diffusion models frequently
// render the brand name or tagline as literal typography when a prompt
// mentions a store/brand name. Standard negative-prompt technique, costs
// nothing when the model had no reason to draw text anyway.
const NO_TEXT_SUFFIX = ', no text, no words, no letters, no typography, no writing, no watermark, no logo text'

function withNoTextGuard(prompt: string): string {
  return `${prompt}${NO_TEXT_SUFFIX}`
}

async function getCachedImageUrl(prompt: string, model: string): Promise<string | null> {
  const promptHash = crypto.createHash('sha256').update(`${prompt}${model}`).digest('hex')
  const cached = await prisma.generatedImageCache.findUnique({ where: { promptHash } })
  if (!cached) return null
  const expired = Date.now() - new Date(cached.createdAt).getTime() > IMAGE_CACHE_TTL_MS
  return expired ? null : cached.url
}

async function saveCachedImageUrl(prompt: string, model: string, url: string) {
  const promptHash = crypto.createHash('sha256').update(`${prompt}${model}`).digest('hex')
  await prisma.generatedImageCache.upsert({
    where: { promptHash },
    update: { prompt, model, url },
    create: { promptHash, prompt, model, url },
  })
}

function getPublicId(prompt: string, model: string): string {
  const promptHash = crypto.createHash('sha256').update(`${prompt}${model}`).digest('hex').slice(0, 16)
  const shortModel = model.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'image'
  return `seltra/generated/${shortModel}/${promptHash}`
}

function isImageContentType(contentType: string | null) {
  return Boolean(contentType && contentType.toLowerCase().startsWith('image/'))
}

const SCHEMA_ERROR = /required properties.*multipart|Invalid input/i
const FLAGGED_ERROR = /output has been flagged|flagged.*prompt.*input image/i

// ── Circuit breaker ──────────────────────────────────────────────────────────
const IMAGE_GEN_CIRCUIT_COOLDOWN_MS = 5 * 60_000
let imageGenDisabledUntil = 0
let imageGenDisabledLoggedAt = 0

function tripImageGenCircuit(errText: string) {
  imageGenDisabledUntil = Date.now() + IMAGE_GEN_CIRCUIT_COOLDOWN_MS
  console.error(
    `[CF Image] Schema error detected — disabling ALL image generation for ${IMAGE_GEN_CIRCUIT_COOLDOWN_MS / 1000}s ` +
    `to avoid hammering a broken request shape across every product. First error:`,
    errText.slice(0, 200),
  )
}

function isImageGenCircuitOpen(): boolean {
  if (Date.now() >= imageGenDisabledUntil) return false
  if (Date.now() - imageGenDisabledLoggedAt > 30_000) {
    const waitSec = Math.ceil((imageGenDisabledUntil - Date.now()) / 1000)
    console.warn(`[CF Image] Circuit open — skipping image generation for ${waitSec}s more, using placeholders`)
    imageGenDisabledLoggedAt = Date.now()
  }
  return true
}

export function isImageGenerationDisabled(): boolean {
  return isImageGenCircuitOpen()
}

// A flagged prompt on one model will almost always flag on the next model
// too, since it's a content-safety trip, not a model quirk — retrying with
// the SAME prompt just burns the whole roster for nothing. Strips likely
// triggers (quoted brand/product names, age descriptors) down to a generic,
// safe descriptive prompt before falling through to the next model.
function sanitizePromptForRetry(prompt: string): string {
  // Aggressively strip quoted strings (brand/product names) and likely flagged
  // descriptors (age, minors, sexualized terms). Fall back to a short,
  // neutral photography prompt when the sanitized result is too short.
  const stripped = prompt
    .replace(/['"][^'"\n]{1,60}['"]/g, '') // remove quoted phrases
    .replace(/\b(young women|young girls?|teen(agers?)?|kids?|children|boys|girls|under \d+|adult[s]? only)\b/gi, 'adults')
    .replace(/\b(nude|naked|sex|sexual|explicit)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s,.-]/g, ' ') // remove odd punctuation
    .replace(/\s{2,}/g, ' ')
    .trim()

  // If the sanitized prompt still contains brand-like tokens (short words
  // or very few words), return a safe generic photography prompt instead.
  if (stripped.split(/\s+/).length < 6) {
    return 'professional product photography, studio lighting, plain neutral background'
  }

  return stripped
}

function buildRequestInit(prompt: string, model: string, apiToken: string): RequestInit {
  if (MULTIPART_MODELS.has(model)) {
    const form = new FormData()
    form.append('prompt', prompt)
    form.append('width', '1024')
    form.append('height', '1024')
    if (model === '@cf/black-forest-labs/flux-2-dev') {
      form.append('steps', '25')
    }
    return {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
    }
  }
  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  }
}

async function generateImageWithModel(
  rawPrompt: string,
  model: string,
  allowFlaggedRetry = true,
  allowFetchRetry = false,
): Promise<string | null> {
  const prompt = withNoTextGuard(rawPrompt)
  const cached = await getCachedImageUrl(prompt, model)
  if (cached) return cached

  const accountId = process.env.CF_ACCOUNT_ID
  const apiToken = process.env.CF_AI_API_TOKEN
  if (!accountId || !apiToken) return null

  const state = getModelState(model)
  if (!isModelAvailable(model)) {
    const waitSec = Math.ceil((state.cooldownUntil - Date.now()) / 1000)
    console.warn(`[CF Image] ${model.split('/').pop()} in cooldown for ${waitSec}s`)
    return null
  }

  // Direct per-model endpoint, model id NOT encoded — same fix as chat/codegen.
  const url = `${CF_API_BASE}/${accountId}/ai/run/${model}`
  const timeoutMs = IMAGE_MODEL_TIMEOUT_MS[model] ?? 60_000

  let res: Response
  const startedAt = Date.now()
  try {
    res = await fetchWithTimeout(url, buildRequestInit(prompt, model, apiToken), timeoutMs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const elapsedMs = Date.now() - startedAt
    if (allowFetchRetry && elapsedMs < 5_000) {
      console.warn(`[CF Image] ${model.split('/').pop()} early fetch failure, retrying once immediately`)
      return generateImageWithModel(rawPrompt, model, allowFlaggedRetry, false)
    }
    recordError(model, elapsedMs < 5_000 ? 5_000 : 15_000)
    console.warn(`[CF Image] ${model.split('/').pop()} fetch failed:`, message)
    return null
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)

    if (SCHEMA_ERROR.test(errText)) {
      tripImageGenCircuit(errText)
      recordError(model, res.status === 429 ? 60_000 : 15_000)
      console.warn(`[CF Image] ${model.split('/').pop()} request failed:`, errText.slice(0, 160))
      return null
    }

    if (FLAGGED_ERROR.test(errText) && allowFlaggedRetry) {
      console.warn(`[CF Image] ${model.split('/').pop()} flagged prompt, retrying once with sanitized prompt`)
      const sanitized = sanitizePromptForRetry(rawPrompt)
      return generateImageWithModel(sanitized, model, false)
    }

    recordError(model, res.status === 429 ? 60_000 : 15_000)
    console.warn(`[CF Image] ${model.split('/').pop()} request failed:`, errText.slice(0, 160))
    return null
  }

  try {
    const contentType = res.headers.get('content-type') ?? ''
    let base64 = ''
    let mimeType = 'image/png'

    if (isImageContentType(contentType)) {
      mimeType = contentType.split(';')[0] || 'image/png'
      const buffer = Buffer.from(await res.arrayBuffer())
      base64 = buffer.toString('base64')
    } else {
      const data = await res.json().catch(() => null)
      const payload = data?.result ?? data
      const imageCandidate =
        payload?.image ??
        payload?.images?.[0]?.image ??
        payload?.images?.[0]?.b64_json ??
        payload?.image_base64 ??
        null

      if (typeof imageCandidate !== 'string' || imageCandidate.length === 0) {
        recordError(model, 10_000)
        console.warn(`[CF Image] ${model.split('/').pop()} returned no image bytes`)
        return null
      }

      base64 = imageCandidate
      mimeType = payload?.mimeType ?? 'image/png'
    }

    if (!base64) {
      recordError(model, 10_000)
      return null
    }

    const upload = await uploadImageBuffer(base64, mimeType, getPublicId(prompt, model))
    await saveCachedImageUrl(prompt, model, upload.secure_url)
    recordSuccess(model)
    return upload.secure_url
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordError(model, 10_000)
    console.warn(`[CF Image] ${model.split('/').pop()} upload failed:`, message)
    return null
  }
}

async function generateWithFallback(prompt: string, candidates: string[]): Promise<string | null> {
  if (isImageGenCircuitOpen()) return null

  for (const [index, model] of candidates.entries()) {
    if (!isModelAvailable(model)) {
      console.warn(`[CF Image] ${model.split('/').pop()} in cooldown, trying next model`)
      continue
    }
    try {
      const result = await generateImageWithModel(prompt, model, true, index === 0)
      if (result) return result
      if (isImageGenCircuitOpen()) return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[CF Image] ${model.split('/').pop()} failed:`, message)
    }
  }
  return null
}

export async function generateHeroImage(prompt: string): Promise<string | null> {
  return generateWithFallback(prompt, [
    '@cf/black-forest-labs/flux-2-klein-9b',
    '@cf/black-forest-labs/flux-2-klein-4b',
    '@cf/black-forest-labs/flux-1-schnell',
    '@cf/black-forest-labs/flux-2-dev',
  ])
}

export async function generateProductImage(prompt: string): Promise<string | null> {
  return generateWithFallback(prompt, [
    '@cf/black-forest-labs/flux-2-klein-9b',
    '@cf/black-forest-labs/flux-2-klein-4b',
    '@cf/black-forest-labs/flux-1-schnell',
    '@cf/black-forest-labs/flux-2-dev',
  ])
}

export async function generateDraftImage(prompt: string): Promise<string | null> {
  return generateWithFallback(prompt, [
    '@cf/black-forest-labs/flux-2-klein-4b',
    '@cf/black-forest-labs/flux-1-schnell',
    '@cf/black-forest-labs/flux-2-klein-9b',
    '@cf/black-forest-labs/flux-2-dev',
  ])
}
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { HttpException } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { prisma } from '../db'
import { creditCost, type ModelRole } from '../ai/model-router'
import { mirrorWorkspaceCredit } from '../credits/workspace_credit_mirror'
import { hashEngineApiKey } from './engine-key'

// Credit reservations can contend with account-level usage writes. Keep the
// transaction atomic while allowing transient Neon latency beyond Prisma's
// five-second default.
const CREDIT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 }

type KeyIdentity = { id: string; workspaceId: string; userId?: string; tenantId?: string }
type CreditIdentity = { userId: string; tenantId: string; expiresAt: number }

@Injectable()
export class SeltraEngineService implements OnModuleInit {
  private readonly logger = new Logger('SeltraEngine')
  private readonly requests = new Map<string, number[]>()
  private readonly salt = process.env.SELTRA_ENGINE_API_KEY_HASH_SALT ?? ''
  private readonly maxImages = Number(process.env.SELTRA_ENGINE_MAX_IMAGES_PER_REQUEST ?? 4)
  private readonly timeoutMs = Number(process.env.SELTRA_ENGINE_UPSTREAM_TIMEOUT_MS ?? 60_000)
  private readonly maxUpstreamBytes = Number(process.env.SELTRA_ENGINE_MAX_UPSTREAM_MB ?? 16) * 1024 * 1024
  private readonly storageDir = resolve(process.env.SELTRA_ENGINE_STORAGE_DIR ?? './storage/engine')

  async onModuleInit() {
    this.validateConfig()
    await mkdir(this.storageDir, { recursive: true })
    const bootstrap = process.env.SELTRA_ENGINE_BOOTSTRAP_KEY
    if (bootstrap) {
      if (process.env.NODE_ENV === 'production' && process.env.SELTRA_ENGINE_ALLOW_BOOTSTRAP !== 'true') {
        // A bootstrap key is only for local development/initial provisioning.
        // Render may inherit it from a shared env group; ignore it safely in
        // production instead of taking the whole API down during startup.
        this.logger.warn('SELTRA_ENGINE_BOOTSTRAP_KEY is set but bootstrap seeding is disabled in production; ignoring it.')
      } else {
        const keyHash = this.hashKey(bootstrap)
        if (!(await prisma.seltraEngineApiKey.findUnique({ where: { keyHash } }))) {
          const workspaceId = process.env.SELTRA_ENGINE_BOOTSTRAP_WORKSPACE ?? 'local-dev'
          // This workspace exists only to keep the legacy API-key foreign key.
          // Account allowances live in user_credits and are mirrored per user.
          await prisma.workspaceCredit.upsert({ where: { workspaceId }, update: {}, create: { workspaceId } })
          await prisma.seltraEngineApiKey.create({ data: { workspaceId, label: 'Local development bootstrap', keyHash } })
        }
      }
    }
  }

  private validateConfig() {
    if (this.salt.length < 32) throw new Error('SELTRA_ENGINE_API_KEY_HASH_SALT must contain at least 32 characters.')
    const encryptionSecret = process.env.ENGINE_KEY_ENCRYPTION_SECRET
    if (!encryptionSecret || Buffer.byteLength(encryptionSecret, 'utf8') < 32) throw new Error('ENGINE_KEY_ENCRYPTION_SECRET must contain at least 32 bytes.')
    if (!Number.isInteger(this.maxImages) || this.maxImages < 1 || this.maxImages > 8) throw new Error('SELTRA_ENGINE_MAX_IMAGES_PER_REQUEST must be an integer from 1 to 8.')
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 180_000) throw new Error('SELTRA_ENGINE_UPSTREAM_TIMEOUT_MS must be from 1000 to 180000.')
    if (!Number.isInteger(Number(process.env.SELTRA_ENGINE_RATE_LIMIT_PER_MINUTE ?? 60))) throw new Error('SELTRA_ENGINE_RATE_LIMIT_PER_MINUTE must be an integer.')
    const bodyLimit = Number(process.env.SELTRA_ENGINE_MAX_BODY_MB ?? 20)
    if (!Number.isInteger(bodyLimit) || bodyLimit < 1 || bodyLimit > 50) throw new Error('SELTRA_ENGINE_MAX_BODY_MB must be an integer from 1 to 50.')
    const upstreamLimit = Number(process.env.SELTRA_ENGINE_MAX_UPSTREAM_MB ?? 16)
    if (!Number.isInteger(upstreamLimit) || upstreamLimit < 1 || upstreamLimit > 64) throw new Error('SELTRA_ENGINE_MAX_UPSTREAM_MB must be an integer from 1 to 64.')
    if ((process.env.SELTRA_ENGINE_BASE_PATH ?? '/v1') !== '/v1') throw new Error('SELTRA_ENGINE_BASE_PATH must remain /v1 to match the core client contract.')
    if (process.env.SELTRA_ENGINE_PORT && process.env.PORT && process.env.SELTRA_ENGINE_PORT !== process.env.PORT) throw new Error('SELTRA_ENGINE_PORT must match PORT because the engine shares the Seltra API process.')
    if ((process.env.AI_PROVIDER ?? 'cloudflare') !== 'cloudflare') throw new Error('Only AI_PROVIDER=cloudflare is implemented by Seltra Engine.')
    for (const role of ['AI_MODEL_DEFAULT', 'AI_MODEL_VISION']) {
      if (!process.env[role]) throw new Error(`${role} is required by Seltra Engine.`)
    }
    if (!(process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.MODEL_ACCOUNT_ID)) throw new Error('CLOUDFLARE_ACCOUNT_ID is required by Seltra Engine.')
    if (!(process.env.CLOUDFLARE_API_TOKEN ?? process.env.MODEL_API_KEY)) throw new Error('CLOUDFLARE_API_TOKEN is required by Seltra Engine.')
    const bootstrap = process.env.SELTRA_ENGINE_BOOTSTRAP_KEY
    if (bootstrap && !/^sk_seltra_[A-Za-z0-9_-]{40,}$/.test(bootstrap)) throw new Error('SELTRA_ENGINE_BOOTSTRAP_KEY must be a generated sk_seltra_ key.')
  }

  private hashKey(key: string) { return hashEngineApiKey(key, this.salt) }

  async authenticate(header?: string, creditIdentityToken?: string): Promise<KeyIdentity | null> {
    if (!header?.startsWith('Bearer ')) return null
    const key = header.slice(7).trim()
    if (!/^sk_seltra_[A-Za-z0-9_-]{40,}$/.test(key)) return null
    const digest = Buffer.from(this.hashKey(key), 'hex')
    const creditIdentity = this.verifyCreditIdentity(creditIdentityToken)
    const candidates = await prisma.seltraEngineApiKey.findMany({ where: { revokedAt: null }, select: { id: true, workspaceId: true, tenantId: true, keyHash: true } })
    let match: KeyIdentity | null = null
    for (const candidate of candidates) {
      const stored = Buffer.from(candidate.keyHash, 'hex')
      const equal = stored.length === digest.length && timingSafeEqual(stored, digest)
      if (equal && (!candidate.tenantId || !creditIdentity || candidate.tenantId === creditIdentity.tenantId)) {
        match = { id: candidate.id, workspaceId: candidate.workspaceId, ...(candidate.tenantId ? { tenantId: candidate.tenantId } : {}) }
      }
    }
    if (match) await prisma.seltraEngineApiKey.update({ where: { id: match.id }, data: { lastUsedAt: new Date() } })
    return match && creditIdentity ? { ...match, userId: creditIdentity.userId, tenantId: creditIdentity.tenantId } : match
  }

  private verifyCreditIdentity(token?: string): CreditIdentity | null {
    const secret = process.env.CORE_SERVICE_SECRET
    if (!secret || !token || token.length > 4096) return null
    const [payload, suppliedSignature, extra] = token.split('.')
    if (!payload || !suppliedSignature || extra !== undefined) return null
    const expected = createHmac('sha256', secret).update(payload).digest()
    let supplied: Buffer
    try { supplied = Buffer.from(suppliedSignature, 'base64url') } catch { return null }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<CreditIdentity>
      if (typeof claims.userId !== 'string' || !claims.userId || typeof claims.tenantId !== 'string' || !claims.tenantId || !Number.isSafeInteger(claims.expiresAt) || (claims.expiresAt ?? 0) <= Date.now()) return null
      return { userId: claims.userId, tenantId: claims.tenantId, expiresAt: claims.expiresAt! }
    } catch { return null }
  }

  enforceRateLimit(identity: KeyIdentity, ip: string) {
    const limit = Number(process.env.SELTRA_ENGINE_RATE_LIMIT_PER_MINUTE ?? 60)
    const now = Date.now()
    let retry = 0
    for (const id of [`key:${identity.id}`, `ip:${ip}`]) {
      const recent = (this.requests.get(id) ?? []).filter((time) => now - time < 60_000)
      if (recent.length >= limit) retry = Math.max(retry, Math.ceil((60_000 - (now - recent[0])) / 1000))
      else { recent.push(now); this.requests.set(id, recent) }
    }
    if (retry) return retry
    return 0
  }

  async generateImages(identity: KeyIdentity, body: Record<string, unknown>, requestId: string) {
    const prompt = body.prompt
    const n = body.n ?? 1
    if (typeof prompt !== 'string' || prompt.trim().length < 1 || prompt.length > 2048) throw this.httpError(400, 'invalid_request', 'prompt must contain 1 to 2048 characters.')
    const deniedPromptTerms = (process.env.SELTRA_ENGINE_PROMPT_DENYLIST ?? '').split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
    if (deniedPromptTerms.some((term) => prompt.toLowerCase().includes(term))) throw this.httpError(400, 'prompt_rejected', 'Prompt contains content blocked by the configured image safety policy.')
    if (!Number.isInteger(n) || Number(n) < 1 || Number(n) > this.maxImages) throw this.httpError(400, 'invalid_request', `n must be from 1 to ${this.maxImages}.`)
    if (body.response_format !== undefined && !['b64_json', 'url'].includes(String(body.response_format))) throw this.httpError(400, 'invalid_request', 'response_format must be b64_json or url.')
    const reservation = await this.reserveCredits(identity, requestId, '/images/generations', Number(n) * this.imageCreditCost())
    try {
    const data: Array<{ b64_json: string; revised_prompt: string }> = []
    for (let index = 0; index < Number(n); index++) {
      const generated = await this.generateImageWithFallback(prompt.trim(), requestId)
      const image = generated.b64Json
      const model = generated.model
      const bytes = Buffer.from(image, 'base64')
      const mime = this.imageMime(bytes)
      if (!mime) {
        this.logger.error(JSON.stringify({ event: 'invalid_image_bytes', requestId, preview: bytes.subarray(0, 100).toString('hex') }))
        throw this.httpError(502, 'upstream_error', 'Image provider returned invalid image data.')
      }
      const id = randomBytes(16).toString('hex')
      const extension = mime === 'image/png' ? 'png' : 'jpg'
      let storageRef = `${id}.${extension}`
      if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
        const { uploadImageBuffer } = await import('../store/cloudinary.service')
        storageRef = (await uploadImageBuffer(image, mime, `engine/${identity.tenantId ?? identity.workspaceId}/${id}`)).secure_url
      } else {
        await writeFile(join(this.storageDir, `${id}.${extension}`), bytes, { flag: 'wx' })
      }
      await prisma.seltraEngineAsset.create({ data: { id, keyId: identity.id, workspaceId: identity.workspaceId, prompt: prompt.trim(), model, mimeType: mime, sizeBytes: bytes.length, storageRef } })
      data.push({ b64_json: image, revised_prompt: prompt.trim() })
    }
    await this.commitUsage(reservation, identity, requestId, '/images/generations', 'image', 0, 0, data.length)
    return { created: Math.floor(Date.now() / 1000), data }
    } catch (error) {
      await this.releaseCredits(reservation, identity, requestId, '/images/generations')
      throw error
    }
  }

  async imageAsset(id: string) {
    if (!/^[a-f0-9]{32}\.(?:png|jpg)$/.test(id)) return null
    const { readFile } = await import('node:fs/promises')
    try { return await readFile(join(this.storageDir, id)) } catch { return null }
  }

  models() {
    const roles = ['DEFAULT', 'REASONING', 'FAST', 'VISION', 'IMAGE']
    const data = roles.map((role) => process.env[role === 'DEFAULT' ? 'AI_MODEL_DEFAULT' : `AI_MODEL_${role}`]).filter((model): model is string => Boolean(model))
    return { object: 'list', data: [...new Set(data)].map((id) => ({ id, object: 'model', created: 0, owned_by: 'seltra' })) }
  }

  async chatCompletions(identity: KeyIdentity, body: Record<string, unknown>, requestId: string) {
    const messages = body.messages
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 100) throw this.httpError(400, 'invalid_request', 'messages must contain 1 to 100 entries.')
    if (JSON.stringify(messages).length > 15 * 1024 * 1024) throw this.httpError(400, 'invalid_request', 'Diagnostics payload exceeds the 15 MB limit.')
    const isVision = String(body.model ?? '').toLowerCase().includes('vision') || messages.some((message: any) => JSON.stringify(message).includes('image_url'))
    const role = isVision ? 'VISION' : this.configuredRole(body.model) ?? 'REASONING'
    const model = this.requireModel(role)
    const reservation = await this.reserveCredits(identity, requestId, '/chat/completions', 1)
    try {
    let payload: Record<string, unknown> = { ...body, model, stream: false }
    if (isVision) {
      payload.messages = [
        { role: 'system', content: 'Analyze the supplied screenshot and diagnostics. Respond with JSON only using this schema: {"summary":string,"findings":[{"severity":"critical|high|medium|low","issue":string,"evidence":string,"probableCause":string,"suggestedFix":string,"verification":string}]}. Include only evidence-supported findings. Do not claim code was changed.' },
        ...messages,
      ]
    }
    let result = await this.cloudflareChat(payload, requestId)
    const choice = (result as any)?.choices?.[0]
    if (!choice?.message) throw this.httpError(502, 'upstream_error', 'Model provider returned an invalid chat completion.')
    if (isVision) {
      const originalContent = choice.message.content
      const parsed = this.parseVisionJson(originalContent)
      if (!parsed) {
        payload = { ...payload, messages: [...(payload.messages as unknown[]), { role: 'assistant', content: String(originalContent ?? '') }, { role: 'user', content: 'The prior response was not valid JSON for the requested schema. Return one corrected JSON object only.' }] }
        result = await this.cloudflareChat(payload, requestId)
        const retryContent = (result as any)?.choices?.[0]?.message?.content
        const repaired = this.parseVisionJson(retryContent)
        if (!repaired) throw this.httpError(502, 'invalid_vision_response', 'Vision model returned invalid structured analysis after one repair attempt.')
        ;(result as any).choices[0].message.content = JSON.stringify(repaired)
      } else {
        ;(result as any).choices[0].message.content = JSON.stringify(parsed)
      }
    }
    const usage = (result as any).usage ?? {}
    await this.commitUsage(reservation, identity, requestId, '/chat/completions', role.toLowerCase(), Number(usage.prompt_tokens ?? 0), Number(usage.completion_tokens ?? 0), 0)
    return result
    } catch (error) {
      await this.releaseCredits(reservation, identity, requestId, '/chat/completions')
      throw error
    }
  }

  private parseVisionJson(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'string') return null
    const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || typeof parsed.summary !== 'string' || !Array.isArray(parsed.findings)) return null
      const valid = parsed.findings.every((finding: any) => finding && ['critical', 'high', 'medium', 'low'].includes(finding.severity) && ['issue', 'evidence', 'probableCause', 'suggestedFix', 'verification'].every((key) => typeof finding[key] === 'string'))
      return valid ? parsed : null
    } catch { return null }
  }

  async proxyChat(identity: KeyIdentity, body: Record<string, unknown>, requestId: string) {
    const roleName = this.configuredRole(body.model) ?? 'DEFAULT'
    const role = this.requireModel(roleName)
    const reservation = await this.reserveCredits(identity, requestId, '/chat/completions', 1)
    try {
      const result = await this.cloudflareChat({ ...body, model: role, stream: false }, requestId)
      const usage = (result as any)?.usage ?? {}
      await this.commitUsage(reservation, identity, requestId, '/chat/completions', roleName.toLowerCase(), Number(usage.prompt_tokens ?? 0), Number(usage.completion_tokens ?? 0), 0)
      return result
    } catch (error) {
      await this.releaseCredits(reservation, identity, requestId, '/chat/completions')
      throw error
    }
  }

  async assetFile(id: string) { return this.imageAsset(id) }

  private requireModel(role: string) {
    const model = process.env[`AI_MODEL_${role}`] ?? (role === 'DEFAULT' ? process.env.AI_MODEL_DEFAULT : '')
    if (!model) throw this.httpError(503, 'engine_not_configured', `AI_MODEL_${role} is not configured.`)
    return model
  }

  private shouldFallbackFromImageStatus(status: number): boolean {
    return status === 401 || status === 403 || status === 404 || status === 429 || status === 504 || status >= 500
  }

  private imageProviderChain(): string[] {
    const primary = process.env.AI_MODEL_IMAGE?.trim()
    const fallbackList = (process.env.AI_IMAGE_FALLBACKS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value === 'cloudflare-flux-klein'
        ? 'black-forest-labs/flux-3-image-klein'
        : value)
    const exactFlux = 'black-forest-labs/flux-3-image-klein'
    return [...new Set([...(primary ? [primary] : []), exactFlux, ...fallbackList])]
  }

  private async generateImageWithFallback(prompt: string, requestId: string): Promise<{ b64Json: string; model: string }> {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.MODEL_ACCOUNT_ID
    const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.MODEL_API_KEY
    if (!account || !token) {
      throw this.httpError(503, 'engine_not_configured', 'Missing CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN for image generation.')
    }

    const failures: string[] = []
    for (const model of this.imageProviderChain()) {
      try {
        const result = model === 'black-forest-labs/flux-3-image-klein'
          ? await this.cloudflareFluxKlein(prompt, requestId)
          : await this.cloudflareRun(model, { prompt }, requestId)
        const image = typeof result === 'string'
          ? result
          : (result as { image?: unknown })?.image
        if (typeof image !== 'string' || image.length === 0) {
          throw new Error(`${model}: empty image payload`)
        }

        let b64Json = image
        if (/^https?:\/\//i.test(image)) {
          const downloaded = await fetch(image, { signal: AbortSignal.timeout(45_000) })
          if (!downloaded.ok) throw new Error(`${model}: generated image URL returned HTTP ${downloaded.status}`)
          const bytes = Buffer.from(await downloaded.arrayBuffer())
          if (!this.imageMime(bytes)) throw new Error(`${model}: downloaded payload was not a valid PNG/WebP/JPEG`)
          b64Json = bytes.toString('base64')
        } else {
          b64Json = image.includes(',') ? image.split(',', 2)[1] : image
          if (!this.imageMime(Buffer.from(b64Json, 'base64'))) throw new Error(`${model}: invalid image bytes`)
        }
        this.logger.log(JSON.stringify({ event: 'image_provider_served', requestId, provider: 'cloudflare', model }))
        return { b64Json, model }
      } catch (error) {
        let status = 502
        if (error instanceof HttpException) {
          status = typeof error.getStatus === 'function' ? error.getStatus() : 502
        }
        const message = error instanceof Error ? error.message : String(error)
        const safeMessage = message.slice(0, 300).replace(/(?:authorization|api[_ -]?token)[=: ]\S+/gi, '[redacted]')
        failures.push(`${model}: HTTP ${status}${status === 502 ? '' : ` (${safeMessage})`}`)
        this.logger.warn(JSON.stringify({ event: 'image_provider_fallback', requestId, provider: 'cloudflare', model, status, reason: safeMessage }))

        if (status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 404 && status !== 429) break
        if (!this.shouldFallbackFromImageStatus(status) && status !== 502) break
      }
    }
    throw this.httpError(502, 'image_providers_failed', `All image providers failed. ${failures.join('; ')}`)
  }

  private configuredRole(requested: unknown): string | null {
    if (typeof requested !== 'string') return null
    for (const role of ['DEFAULT', 'REASONING', 'FAST', 'VISION']) {
      const model = process.env[role === 'DEFAULT' ? 'AI_MODEL_DEFAULT' : `AI_MODEL_${role}`]
      if (model && requested === model) return role
    }
    return null
  }

  private async cloudflareFluxKlein(prompt: string, requestId: string) {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.MODEL_ACCOUNT_ID
    const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.MODEL_API_KEY
    if (!account || !token) throw this.httpError(503, 'engine_not_configured', 'Missing Cloudflare image credentials.')
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run`

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 45_000)
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
          },
          body: JSON.stringify({
            model: 'black-forest-labs/flux-3-image-klein',
            input: { prompt, resolution: '1k' },
          }),
          signal: controller.signal,
        })
        const bytes = await this.readUpstream(response)
        const text = Buffer.from(bytes).toString('utf8')
        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt === 0) continue
          throw this.httpError(
            response.status,
            response.status === 429 ? 'upstream_rate_limited' : 'upstream_error',
            `Cloudflare FLUX Klein request failed with HTTP ${response.status}.`,
          )
        }
        let parsed: any
        try { parsed = JSON.parse(text) } catch { throw this.httpError(502, 'upstream_error', 'Cloudflare FLUX Klein returned invalid JSON.') }
        if (parsed?.success === false || parsed?.errors?.length) throw this.httpError(502, 'upstream_error', 'Cloudflare FLUX Klein provider error.')
        const image = parsed?.result?.image ?? parsed?.result?.sample ?? parsed?.result?.url ?? parsed?.image
        if (typeof image !== 'string' || !image.trim()) throw this.httpError(502, 'upstream_error', 'Cloudflare FLUX Klein returned no image payload.')
        return { image }
      } catch (error) {
        if (error instanceof HttpException) throw error
        if (controller.signal.aborted) throw this.httpError(504, 'upstream_timeout', 'Cloudflare FLUX Klein timed out.')
        throw this.httpError(502, 'upstream_error', 'Could not connect to Cloudflare FLUX Klein.')
      } finally {
        clearTimeout(timeout)
      }
    }
    throw this.httpError(502, 'upstream_error', 'Cloudflare FLUX Klein failed after retry.')
  }

  private async cloudflareRun(model: string, input: Record<string, unknown>, requestId: string) {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.MODEL_ACCOUNT_ID
    const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.MODEL_API_KEY
    if (!account || !token) throw this.httpError(503, 'engine_not_configured', 'Cloudflare Workers AI credentials are not configured.')
    // Cloudflare's model ID is itself a route path (`@cf/vendor/model`).
    // Encoding the whole identifier escapes `/` to `%2F`, which Cloudflare
    // rejects even though the URL is syntactically valid.
    const modelPath = model.split('/').map((segment) => encodeURIComponent(segment).replace(/%40/gi, '@')).join('/')
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${modelPath}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const isFlux2 = /flux-2-(?:dev|klein)/i.test(model)
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-Request-ID': requestId }
      let body: BodyInit
      if (isFlux2) {
        const form = new FormData()
        form.append('prompt', String(input.prompt ?? ''))
        form.append('width', '1024')
        form.append('height', '1024')
        if (/flux-2-dev/i.test(model)) form.append('steps', '25')
        body = form
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(input)
      }
      const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
      const type = response.headers.get('content-type') ?? ''
      const bytes = await this.readUpstream(response)
      if (!response.ok) {
        const preview = Buffer.from(bytes).toString('utf8').slice(0, 300)
        this.logger.error(JSON.stringify({ event: 'upstream_failure', requestId, status: response.status, preview }))
        const fallbackStatus = [401, 403, 404, 429, 504].includes(response.status) || response.status >= 500
          ? response.status
          : 502
        throw this.httpError(fallbackStatus, response.status === 429 ? 'upstream_rate_limited' : 'upstream_error', response.status === 429 ? 'Image provider is rate limited; retry shortly.' : 'Image provider request failed.')
      }
      if (type.startsWith('image/')) return { image: Buffer.from(bytes).toString('base64') }
      const text = Buffer.from(bytes).toString('utf8')
      let parsed: any
      try { parsed = JSON.parse(text) } catch {
        this.logger.error(JSON.stringify({ event: 'upstream_unexpected_content_type', requestId, contentType: type, preview: text.slice(0, 300) }))
        throw this.httpError(502, 'upstream_error', 'Image provider returned an unexpected response.')
      }
      if (parsed?.success === false || parsed?.errors?.length) {
        this.logger.error(JSON.stringify({ event: 'upstream_provider_error', requestId, preview: JSON.stringify(parsed.errors).slice(0, 300) }))
        throw this.httpError(502, 'upstream_error', 'Image provider could not generate the requested image.')
      }
      return parsed?.result ?? parsed
    } catch (error) {
      if (error instanceof HttpException) throw error
      if (controller.signal.aborted) throw this.httpError(504, 'upstream_timeout', 'Image provider request timed out.')
      this.logger.error(JSON.stringify({ event: 'upstream_connection_failure', requestId, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }))
      throw this.httpError(502, 'upstream_error', 'Could not connect to the image provider.')
    } finally { clearTimeout(timeout) }
  }

  private async cloudflareChat(body: Record<string, unknown>, requestId: string) {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.MODEL_ACCOUNT_ID
    const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.MODEL_API_KEY
    if (!account || !token) throw this.httpError(503, 'engine_not_configured', 'Cloudflare Workers AI credentials are not configured.')
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1/chat/completions`
    return this.upstream(endpoint, body, token, requestId)
  }

  private async upstream(url: string, body: Record<string, unknown>, token: string, requestId: string): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Request-ID': requestId }, body: JSON.stringify(body), signal: controller.signal })
      const responseBytes = await this.readUpstream(response)
      const text = Buffer.from(responseBytes).toString('utf8')
      if (!response.ok) { this.logger.error(JSON.stringify({ event: 'upstream_failure', requestId, status: response.status, preview: text.slice(0, 300) })); throw this.httpError(response.status === 429 ? 429 : 502, 'upstream_error', response.status === 429 ? 'AI provider is rate limited; retry shortly.' : 'AI provider request failed.') }
      try { return JSON.parse(text) } catch { this.logger.error(JSON.stringify({ event: 'upstream_invalid_json', requestId, preview: text.slice(0, 300) })); throw this.httpError(502, 'upstream_error', 'AI provider returned an unexpected response.') }
    } catch (error) {
      if ((error as any)?.status) throw error
      if (controller.signal.aborted) throw this.httpError(504, 'upstream_timeout', 'AI provider request timed out.')
      this.logger.error(JSON.stringify({ event: 'upstream_connection_failure', requestId, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }))
      throw this.httpError(502, 'upstream_error', 'Could not connect to the AI provider.')
    } finally { clearTimeout(timeout) }
  }

  private imageMime(bytes: Buffer) {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    return null
  }

  private async readUpstream(response: Response): Promise<Uint8Array> {
    const announcedSize = Number(response.headers.get('content-length') ?? 0)
    if (announcedSize > this.maxUpstreamBytes) {
      await response.body?.cancel()
      throw this.httpError(502, 'upstream_response_too_large', 'AI provider response exceeded the configured size limit.')
    }
    if (!response.body) return new Uint8Array()
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > this.maxUpstreamBytes) {
          await reader.cancel()
          throw this.httpError(502, 'upstream_response_too_large', 'AI provider response exceeded the configured size limit.')
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const result = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result
  }

  private async reserveCredits(identity: KeyIdentity, requestId: string, route: string, costUnits: number) {
    const userId = identity.userId
    const tenantId = identity.tenantId
    if (!userId || !tenantId) throw this.httpError(403, 'CREDIT_IDENTITY_REQUIRED', 'An authenticated Seltra user identity is required to spend credits.')
    const reservationId = randomBytes(16).toString('hex')
    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findFirst({ where: { id: tenantId, ownerId: userId }, select: { id: true } })
      if (!tenant) throw this.httpError(403, 'CREDIT_IDENTITY_INVALID', 'The Seltra user does not own this project.')
      const changed = await tx.userCredit.updateMany({ where: { userId, balance: { gte: costUnits } }, data: { balance: { decrement: costUnits } } })
      if (changed.count !== 1) throw this.httpError(402, 'OUT_OF_CREDITS', 'Your Seltra account has insufficient credits. Credits are shared across your projects.')
      const updated = await tx.userCredit.findUniqueOrThrow({ where: { userId } })
      await mirrorWorkspaceCredit(tx, updated)
      await tx.userCreditLedger.create({ data: { userId, projectId: tenantId, kind: 'seltra_engine_reserve', delta: -costUnits, balanceAfter: updated.balance, meta: { route, requestId, reservationId, state: 'reserved', engineWorkspaceId: identity.workspaceId } } })
    }, CREDIT_TRANSACTION_OPTIONS)
    return { id: reservationId, costUnits, userId, tenantId }
  }

  private async releaseCredits(reservation: { id: string; costUnits: number; userId: string; tenantId: string }, identity: KeyIdentity, requestId: string, route: string) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.userCredit.update({ where: { userId: reservation.userId }, data: { balance: { increment: reservation.costUnits } } })
      await mirrorWorkspaceCredit(tx, updated)
      await tx.userCreditLedger.create({ data: { userId: reservation.userId, projectId: reservation.tenantId, kind: 'seltra_engine_release', delta: reservation.costUnits, balanceAfter: updated.balance, meta: { route, requestId, reservationId: reservation.id, state: 'released', engineWorkspaceId: identity.workspaceId } } })
    }, CREDIT_TRANSACTION_OPTIONS)
  }

  private async commitUsage(reservation: { id: string; costUnits: number; userId: string; tenantId: string }, identity: KeyIdentity, requestId: string, route: string, role: string, tokensIn: number, tokensOut: number, images: number) {
    const modelRole: ModelRole = ['reasoning', 'default', 'fast', 'vision', 'image'].includes(role) ? role as ModelRole : 'default'
    const costUnits = images > 0 ? images * this.imageCreditCost() : creditCost(tokensIn, tokensOut, modelRole)
    await prisma.$transaction(async (tx) => {
      const adjustment = reservation.costUnits - costUnits
      if (adjustment > 0) {
        await tx.userCredit.update({ where: { userId: reservation.userId }, data: { balance: { increment: adjustment }, lifetimeUsed: { increment: costUnits } } })
      } else if (adjustment < 0) {
        const changed = await tx.userCredit.updateMany({ where: { userId: reservation.userId, balance: { gte: -adjustment } }, data: { balance: { decrement: -adjustment }, lifetimeUsed: { increment: costUnits } } })
        if (changed.count !== 1) throw this.httpError(402, 'OUT_OF_CREDITS', 'Your Seltra account has insufficient credits for completed usage.')
      } else {
        await tx.userCredit.update({ where: { userId: reservation.userId }, data: { lifetimeUsed: { increment: costUnits } } })
      }
      const updated = await tx.userCredit.findUniqueOrThrow({ where: { userId: reservation.userId } })
      await mirrorWorkspaceCredit(tx, updated)
      await tx.userCreditLedger.create({ data: { userId: reservation.userId, projectId: reservation.tenantId, kind: 'seltra_engine_usage', delta: adjustment, balanceAfter: updated.balance, modelRole, tokensIn, tokensOut, meta: { route, requestId, images, reservationId: reservation.id, settledCost: costUnits, engineWorkspaceId: identity.workspaceId } } })
      await tx.seltraEngineUsage.create({ data: { keyId: identity.id, workspaceId: identity.workspaceId, route, modelRole: role, tokensIn, tokensOut, images, costUnits, requestId } })
    }, CREDIT_TRANSACTION_OPTIONS)
    this.logger.log(JSON.stringify({ event: 'usage_committed', requestId, keyId: identity.id, userId: reservation.userId, projectId: reservation.tenantId, route, modelRole, tokensIn, tokensOut, images, creditDelta: -costUnits, reservationId: reservation.id }))
  }

  private imageCreditCost() {
    const cost = Number(process.env.ENGINE_IMAGE_CREDIT_COST ?? 3)
    return Number.isInteger(cost) && cost > 0 ? cost : 3
  }

  private httpError(status: number, code: string, message: string) { return new HttpException({ error: { code, message } }, status) }
}

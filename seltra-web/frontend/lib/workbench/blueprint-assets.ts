export type BlueprintVisualInput = { type: string; description: string; prompt: string }
export type BlueprintPhotoSlot = { slot: string; prompt: string }
export type BlueprintAssetContext = {
  appName?: string
  userPrompt?: string
  designDirection?: string
  primaryColor?: string
  questionnaireAnswers?: Array<{ question: string; answer: string }>
}
export type GeneratedBlueprintAsset = BlueprintPhotoSlot & { path?: string; status: 'generated' | 'fallback' | 'skipped' }
export type BlueprintAssetSource = { provider: 'pexels' | 'pixabay' | 'unsplash'; attribution: string }
const MAX_IMAGE_PROMPT_LENGTH = 2_000
const IMAGE_GENERATION_TIMEOUT_MS = 60_000
const IMAGE_GENERATION_RETRIES = 2
const IMAGE_GENERATION_CONCURRENCY = 3

export function blueprintPlaceholderDataUrl(slot: BlueprintPhotoSlot): string {
  const label = slot.slot.replace(/-/g, ' ').slice(0, 40)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f8f4ee"/><stop offset=".55" stop-color="#e8d8c2"/><stop offset="1" stop-color="#c5a77e"/></linearGradient></defs><rect width="1200" height="800" fill="url(#bg)"/><circle cx="600" cy="345" r="118" fill="#fff" fill-opacity=".26"/><path d="M0 620 310 380l220 170 205-220 465 340v130H0Z" fill="#fff" fill-opacity=".24"/><text x="600" y="730" text-anchor="middle" fill="#5f5143" font-family="Arial,sans-serif" font-size="30" letter-spacing="3">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function isValidAssetReference(path: string) {
  return /^public\/assets\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(path) ||
    /^data:image\/svg\+xml,%3Csvg(?:%20|%3E)/i.test(path)
}

function semanticAssetSlot(visual: BlueprintVisualInput): string {
  const content = `${visual.type} ${visual.description} ${visual.prompt}`.toLowerCase()
  if (/\b(hero|banner|cover|landing)\b/.test(content)) return 'hero'
  if (/\b(best[\s-]?sellers?|featured|popular|trending)\b/.test(content)) return 'best-sellers'
  if (/\bwomen(?:'s)?\b/.test(content)) return 'women'
  if (/\bmen(?:'s)?\b/.test(content)) return 'men'
  if (/\baccessor(?:y|ies)\b/.test(content)) return 'accessories'
  return visual.description.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'photo'
}

function contextualImagePrompt(visual: BlueprintVisualInput, context: BlueprintAssetContext): string {
  const prompt = visual.prompt.trim() || visual.description.trim()
  const preferences = context.questionnaireAnswers
    ?.filter((item) => item.answer.trim() && !/^skipped$/i.test(item.answer.trim()))
    .map((item) => `${item.question.trim()}: ${item.answer.trim()}`)
    .join('; ')
  const contextParts = [
    context.appName && `Brand/project: ${context.appName}.`,
    context.userPrompt && `Project brief: ${context.userPrompt.trim()}`,
    context.designDirection && `Art direction: ${context.designDirection.trim()}.`,
    context.primaryColor && `Brand palette anchor: ${context.primaryColor.trim()}.`,
    preferences && `User preferences: ${preferences}.`,
  ].filter(Boolean)
  const suffix = [
    'Compose as a square 1:1 image for a premium web page.',
    'No text, lettering, logos, labels, or watermarks.',
  ].join(' ')
  const promptBody = [`Visual brief: ${prompt}`, ...contextParts]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const maxBodyLength = MAX_IMAGE_PROMPT_LENGTH - suffix.length - 1
  return `${promptBody.slice(0, maxBodyLength).trim()} ${suffix}`
}

export function blueprintPhotoSlots(visuals: BlueprintVisualInput[], context: BlueprintAssetContext = {}): BlueprintPhotoSlot[] {
  const photos = visuals.filter((visual) => /photo|photograph|photography|editorial image|product image|hero image/i.test(`${visual.type} ${visual.description}`))
  const usedSlots = new Map<string, number>()
  return photos.map((visual) => {
    const baseSlot = semanticAssetSlot(visual)
    const duplicateIndex = (usedSlots.get(baseSlot) ?? 0) + 1
    usedSlots.set(baseSlot, duplicateIndex)
    const slot = duplicateIndex === 1 ? baseSlot : `${baseSlot}-${duplicateIndex}`
    return { slot: slot.slice(0, 64).replace(/-+$/g, ''), prompt: contextualImagePrompt(visual, context) }
  })
}

export function generatedAssetMarkup(prompt: string, path: string | undefined, status: 'pending' | 'finished' | 'failed'): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safePath = path ? ` path="${escape(path)}"` : ''
  return `<dyad-image-generation prompt="${escape(prompt)}" state="${status}"${safePath}>${escape(path ?? '')}</dyad-image-generation>`
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Image operation timed out.')), timeoutMs)
    work.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })
}

function isRetryableGenerationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const status = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1]
  if (/\bcancelled\b|\bcanceled\b|RUN_STOPPED/i.test(message)) return false
  return !status || !/^(?:400|401|403|404|402)$/.test(status)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function generateBlueprintPhotoAssets<TGenerated, TFallback>(
  visuals: BlueprintVisualInput[],
  options: {
    context?: BlueprintAssetContext
    generate: (slot: BlueprintPhotoSlot) => Promise<TGenerated>
    saveGenerated: (slot: BlueprintPhotoSlot, generated: TGenerated) => Promise<string>
    fallback?: (slot: BlueprintPhotoSlot) => Promise<TFallback>
    saveFallback?: (slot: BlueprintPhotoSlot, fallback: TFallback) => Promise<string>
    fallbackSource?: (fallback: TFallback) => BlueprintAssetSource | undefined
    onTransition?: (slot: BlueprintPhotoSlot, state: 'generating' | 'generated' | 'fallback' | 'skipped' | 'failed', path?: string, error?: string, source?: BlueprintAssetSource) => void
    onFailure?: (slot: BlueprintPhotoSlot, stage: 'image_generation' | 'stock_sourcing' | 'stock_saving', error: string) => void
    timeoutMs?: number
    retries?: number
    retryDelayMs?: number
    concurrency?: number
  },
): Promise<GeneratedBlueprintAsset[]> {
  const slots = blueprintPhotoSlots(visuals, options.context)
  const timeoutMs = Math.min(options.timeoutMs ?? IMAGE_GENERATION_TIMEOUT_MS, IMAGE_GENERATION_TIMEOUT_MS)
  const retries = Math.max(0, Math.min(options.retries ?? IMAGE_GENERATION_RETRIES, 2))
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250)
  const concurrency = Math.max(1, Math.min(options.concurrency ?? IMAGE_GENERATION_CONCURRENCY, IMAGE_GENERATION_CONCURRENCY))
  const results: GeneratedBlueprintAsset[] = new Array(slots.length)
  let nextSlot = 0

  const generateSlot = async (slot: BlueprintPhotoSlot): Promise<GeneratedBlueprintAsset> => {
    options.onTransition?.(slot, 'generating')
    let path: string | undefined
    let status: GeneratedBlueprintAsset['status'] = 'generated'
    let failureReason: unknown
    try {
      let generated: TGenerated | undefined
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          generated = await withTimeout(options.generate(slot), timeoutMs)
          break
        } catch (error) {
          failureReason = error
          if (attempt === retries || !isRetryableGenerationError(error)) throw error
          await delay(retryDelayMs * (attempt + 1))
        }
      }
      if (generated === undefined) throw failureReason ?? new Error('Image generation returned no result.')
      path = await withTimeout(options.saveGenerated(slot, generated), timeoutMs)
      if (!isValidAssetReference(path)) throw new Error('Generated image did not resolve to a public raster asset.')
    } catch (error) {
      failureReason = error
      const generationError = error instanceof Error ? error.message : String(error)
      options.onFailure?.(slot, 'image_generation', generationError)
      try {
        if (!options.fallback || !options.saveFallback) {
          path = blueprintPlaceholderDataUrl(slot)
          status = 'fallback'
        } else {
          const fallback = await withTimeout(options.fallback(slot), timeoutMs)
          path = await withTimeout(options.saveFallback(slot, fallback), timeoutMs)
          status = 'generated'
          options.onTransition?.(slot, status, path, undefined, options.fallbackSource?.(fallback))
        }
        if (!isValidAssetReference(path)) throw new Error('Fallback did not resolve to a supported image asset.')
      } catch (error) {
        const stockError = error instanceof Error ? error.message : String(error)
        const stage = path ? 'stock_saving' : 'stock_sourcing'
        options.onFailure?.(slot, stage, stockError)
        path = blueprintPlaceholderDataUrl(slot)
        status = 'fallback'
        failureReason = new Error(`${generationError} Stock fallback failed: ${stockError}`)
      }
    }
    const failureDetail = status === 'fallback'
      ? failureReason instanceof Error ? failureReason.message : String(failureReason)
      : undefined
    if (status === 'fallback') options.onTransition?.(slot, status, path, failureDetail)
    return { ...slot, path, status }
  }

  const worker = async () => {
    while (true) {
      const index = nextSlot++
      if (index >= slots.length) return
      results[index] = await generateSlot(slots[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, slots.length) }, () => worker()))
  return results
}

export async function generateBlueprintPhotoAssetsThen<TGenerated, TFallback, TResult>(
  visuals: BlueprintVisualInput[],
  options: Parameters<typeof generateBlueprintPhotoAssets<TGenerated, TFallback>>[1],
  continueBuild: (assets: GeneratedBlueprintAsset[]) => Promise<TResult>,
): Promise<{ assets: GeneratedBlueprintAsset[]; result: TResult }> {
  const assets = await generateBlueprintPhotoAssets<TGenerated, TFallback>(visuals, options)
  const result = await continueBuild(assets)
  return { assets, result }
}

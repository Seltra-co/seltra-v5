export type BlueprintVisualInput = { type: string; description: string; prompt: string }
export type BlueprintPhotoSlot = { slot: string; prompt: string }
export type GeneratedBlueprintAsset = BlueprintPhotoSlot & { path?: string; status: 'generated' | 'fallback' | 'skipped' }

export function blueprintPlaceholderDataUrl(slot: BlueprintPhotoSlot): string {
  const label = slot.slot.replace(/^photo-\d+-/, '').replace(/-/g, ' ').slice(0, 40)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f8f4ee"/><stop offset=".55" stop-color="#e8d8c2"/><stop offset="1" stop-color="#c5a77e"/></linearGradient></defs><rect width="1200" height="800" fill="url(#bg)"/><circle cx="600" cy="345" r="118" fill="#fff" fill-opacity=".26"/><path d="M0 620 310 380l220 170 205-220 465 340v130H0Z" fill="#fff" fill-opacity=".24"/><text x="600" y="730" text-anchor="middle" fill="#5f5143" font-family="Arial,sans-serif" font-size="30" letter-spacing="3">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function isValidAssetReference(path: string) {
  return /^public\/assets\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(path) ||
    /^data:image\/svg\+xml,%3Csvg(?:%20|%3E)/i.test(path)
}

export function blueprintPhotoSlots(visuals: BlueprintVisualInput[]): BlueprintPhotoSlot[] {
  const photos = visuals.filter((visual) => /photo|photograph|photography|editorial image|product image|hero image/i.test(`${visual.type} ${visual.description}`))
  return photos.map((visual, index) => {
    const slug = visual.description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'photo'
    return { slot: `photo-${index + 1}-${slug}`.slice(0, 64).replace(/-+$/g, ''), prompt: visual.prompt.trim() || visual.description.trim() }
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

export async function generateBlueprintPhotoAssets<TGenerated, TFallback>(
  visuals: BlueprintVisualInput[],
  options: {
    generate: (slot: BlueprintPhotoSlot) => Promise<TGenerated>
    saveGenerated: (slot: BlueprintPhotoSlot, generated: TGenerated) => Promise<string>
    fallback?: (slot: BlueprintPhotoSlot) => Promise<TFallback>
    saveFallback?: (slot: BlueprintPhotoSlot, fallback: TFallback) => Promise<string>
    onTransition?: (slot: BlueprintPhotoSlot, state: 'generating' | 'generated' | 'fallback' | 'skipped' | 'failed', path?: string, error?: string) => void
    timeoutMs?: number
  },
): Promise<GeneratedBlueprintAsset[]> {
  const slots = blueprintPhotoSlots(visuals)
  return Promise.all(slots.map(async (slot) => {
    options.onTransition?.(slot, 'generating')
    let path: string | undefined
    let status: GeneratedBlueprintAsset['status'] = 'generated'
    const timeoutMs = Math.min(options.timeoutMs ?? 30_000, 30_000)
    try {
      const generated = await withTimeout(options.generate(slot), timeoutMs)
      path = await withTimeout(options.saveGenerated(slot, generated), timeoutMs)
      if (!isValidAssetReference(path)) throw new Error('Generated image did not resolve to a public raster asset.')
    } catch (generationFailure) {
      status = 'fallback'
      try {
        if (!options.fallback || !options.saveFallback) {
          path = blueprintPlaceholderDataUrl(slot)
        } else {
          const fallback = await withTimeout(options.fallback(slot), timeoutMs)
          path = await withTimeout(options.saveFallback(slot, fallback), timeoutMs)
        }
        if (!isValidAssetReference(path)) throw new Error('Fallback did not resolve to a supported image asset.')
      } catch (error) {
        const generationReason = generationFailure instanceof Error ? generationFailure.message : String(generationFailure)
        const fallbackReason = error instanceof Error ? error.message : String(error)
        const detail = fallbackReason.startsWith('Image generation failed:')
          ? fallbackReason
          : `Image generation failed: ${generationReason}. Fallback failed: ${fallbackReason}`
        options.onTransition?.(slot, 'failed', undefined, detail)
        return { ...slot, status: 'skipped' as const }
      }
    }
    options.onTransition?.(slot, status, path)
    return { ...slot, path, status }
  }))
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

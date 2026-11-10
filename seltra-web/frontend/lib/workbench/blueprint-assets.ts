export type BlueprintVisualInput = { type: string; description: string; prompt: string }
export type BlueprintPhotoSlot = { slot: string; prompt: string }
export type GeneratedBlueprintAsset = BlueprintPhotoSlot & { path?: string; status: 'generated' | 'fallback' | 'skipped' }

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
      if (!/^public\/assets\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(path)) throw new Error('Generated image did not resolve to a public raster asset.')
    } catch {
      status = 'fallback'
      try {
        if (!options.fallback || !options.saveFallback) throw new Error('No fallback image source is configured.')
        const fallback = await withTimeout(options.fallback(slot), timeoutMs)
        path = await withTimeout(options.saveFallback(slot, fallback), timeoutMs)
        if (!/^public\/assets\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(path)) throw new Error('Fallback did not resolve to a public raster asset.')
      } catch (error) {
        options.onTransition?.(slot, 'failed', undefined, error instanceof Error ? error.message : String(error))
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

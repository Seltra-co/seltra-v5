import { describe, expect, it, vi } from 'vitest'
import { blueprintPhotoSlots, generateBlueprintPhotoAssets, generateBlueprintPhotoAssetsThen, generatedAssetMarkup } from '../../../frontend/lib/workbench/blueprint-assets'

const visuals = [
  { type: 'photo', description: 'Cafe hero photo', prompt: 'Warm editorial cafe photography' },
  { type: 'icon', description: 'Simple cart icon', prompt: 'Minimal cart icon' },
  { type: 'product image', description: 'Ceramic cup', prompt: 'Studio product photo of a ceramic cup' },
]

describe('blueprint photo assets', () => {
  it('uses semantic collision-safe slots and contextual square image prompts', () => {
    const slots = blueprintPhotoSlots([
      ...visuals,
      { type: 'photo', description: 'Best sellers campaign', prompt: 'Fashion products in studio' },
      { type: 'photo', description: 'Best sellers second image', prompt: 'New collection products' },
      { type: 'photo', description: 'Women collection', prompt: 'Editorial fashion portrait' },
      { type: 'photo', description: 'Men collection', prompt: 'Editorial menswear portrait' },
      { type: 'photo', description: 'Accessories collection', prompt: 'Leather bags and jewelry' },
    ], {
      appName: 'Atelier Noor',
      userPrompt: 'Premium independent fashion store',
      designDirection: 'Warm editorial photography',
      primaryColor: '#21352c',
      questionnaireAnswers: [{ question: 'Target audience?', answer: 'Premium buyers' }],
    })

    expect(slots.map((slot) => slot.slot)).toEqual([
      'hero',
      'ceramic-cup',
      'best-sellers',
      'best-sellers-2',
      'women',
      'men',
      'accessories',
    ])
    expect(slots[0].prompt).toContain('Atelier Noor')
    expect(slots[0].prompt).toContain('Premium buyers')
    expect(slots[0].prompt).toContain('square 1:1')
    expect(slots[0].prompt).toContain('No text')
  })

  it('selects photo slots and excludes vector decoration', () => {
    expect(blueprintPhotoSlots(visuals).map((slot) => slot.slot)).toEqual(['hero', 'ceramic-cup'])
  })

  it('generates and saves a real raster for every photo slot and streams existing markup', async () => {
    const generate = vi.fn(async (slot: { slot: string }) => ({ fileName: `${slot.slot}.png` }))
    const saveGenerated = vi.fn(async (slot: { slot: string }) => `public/assets/${slot.slot}.png`)
    const fallback = vi.fn(async () => ({ mimeType: 'image/webp' }))
    const saveFallback = vi.fn(async (slot: { slot: string }) => `public/assets/${slot.slot}.webp`)
    const transitions: Array<[string, string, string?]> = []
    const result = await generateBlueprintPhotoAssets(visuals, { generate, saveGenerated, fallback, saveFallback, onTransition: (slot, state, path) => transitions.push([slot.slot, state, path]) })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(saveGenerated).toHaveBeenCalledTimes(2)
    expect(fallback).not.toHaveBeenCalled()
    expect(result.map((asset) => asset.path)).toEqual(['public/assets/hero.png', 'public/assets/ceramic-cup.png'])
    expect(transitions).toContainEqual(['hero', 'generating', undefined])
    expect(generatedAssetMarkup('Cafe "hero"', result[0].path, 'finished')).toContain('state="finished" path="public/assets/hero.png"')
  })

  it('retries transient image generation twice before using a visible fallback', async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('Image generation failed (HTTP 503).'))
      .mockRejectedValueOnce(new Error('Image generation timed out.'))
      .mockResolvedValue({ image: 'ok' })
    const result = await generateBlueprintPhotoAssets([visuals[0]], {
      generate,
      saveGenerated: async () => 'public/assets/hero.png',
      retryDelayMs: 0,
    })
    expect(generate).toHaveBeenCalledTimes(3)
    expect(result[0]).toMatchObject({ status: 'generated', slot: 'hero' })
  })

  it('limits generation concurrency to three images', async () => {
    let active = 0
    let maximumActive = 0
    const multiplePhotos = Array.from({ length: 7 }, (_, index) => ({
      type: 'photo',
      description: `Editorial product ${index + 1}`,
      prompt: `Studio product ${index + 1}`,
    }))
    await generateBlueprintPhotoAssets(multiplePhotos, {
      generate: async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 0))
        active -= 1
        return {}
      },
      saveGenerated: async (slot) => `public/assets/${slot.slot}.png`,
    })
    expect(maximumActive).toBe(3)
  })

  it('uses a fallback when generation fails and skips the slot when no raster source succeeds', async () => {
    const slotVisual = [visuals[0]]
    const fallback = vi.fn(async () => ({ bytes: 'raster' }))
    const generated = await generateBlueprintPhotoAssets(slotVisual, {
      generate: async () => { throw new Error('provider unavailable') },
      saveGenerated: async () => { throw new Error('unreachable') },
      fallback,
      saveFallback: async (slot) => `public/assets/${slot.slot}.webp`,
    })
    expect(generated[0].status).toBe('fallback')
    const skipped = await generateBlueprintPhotoAssets(slotVisual, {
      generate: async () => { throw new Error('provider unavailable') },
      saveGenerated: async () => '', fallback: async () => ({}), saveFallback: async () => '',
    })
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ status: 'skipped' })
    expect(skipped[0].path).toBeUndefined()
  })

  it('continues the approved build after every image source fails', async () => {
    const continueBuild = vi.fn(async (assets: Array<{ status: string }>) => `started with ${assets.length} photo slot`)
    const result = await generateBlueprintPhotoAssetsThen(visuals, {
      generate: async () => { throw new Error('provider unavailable') },
      saveGenerated: async () => '',
    }, continueBuild)
    expect(result.result).toBe('started with 2 photo slot')
    expect(result.assets.every((asset) => asset.status === 'fallback')).toBe(true)
    expect(continueBuild).toHaveBeenCalledOnce()
  })

  it('caps generation and fallback work at 60 seconds and continues with the next slot', async () => {
    vi.useFakeTimers()
    const second = { type: 'photo', description: 'Second photo', prompt: 'Second photo' }
    const work = generateBlueprintPhotoAssets([visuals[0], second], {
      generate: async () => new Promise(() => {}),
      saveGenerated: async () => '',
      timeoutMs: 90_000,
      retries: 0,
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(work).resolves.toHaveLength(2)
    vi.useRealTimers()
  })
})

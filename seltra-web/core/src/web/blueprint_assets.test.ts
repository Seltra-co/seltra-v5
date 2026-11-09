import { describe, expect, it, vi } from 'vitest'
import { blueprintPhotoSlots, generateBlueprintPhotoAssets, generateBlueprintPhotoAssetsThen, generatedAssetMarkup } from '../../../frontend/lib/workbench/blueprint-assets'

const visuals = [
  { type: 'photo', description: 'Cafe hero photo', prompt: 'Warm editorial cafe photography' },
  { type: 'icon', description: 'Simple cart icon', prompt: 'Minimal cart icon' },
  { type: 'product image', description: 'Ceramic cup', prompt: 'Studio product photo of a ceramic cup' },
]

describe('blueprint photo assets', () => {
  it('selects photo slots and excludes vector decoration', () => {
    expect(blueprintPhotoSlots(visuals).map((slot) => slot.slot)).toEqual(['photo-1-cafe-hero-photo', 'photo-2-ceramic-cup'])
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
    expect(result.map((asset) => asset.path)).toEqual(['public/assets/photo-1-cafe-hero-photo.png', 'public/assets/photo-2-ceramic-cup.png'])
    expect(transitions).toContainEqual(['photo-1-cafe-hero-photo', 'generating', undefined])
    expect(generatedAssetMarkup('Cafe "hero"', result[0].path, 'finished')).toContain('state="finished" path="public/assets/photo-1-cafe-hero-photo.png"')
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
    expect(result.assets.every((asset) => asset.status === 'skipped')).toBe(true)
    expect(continueBuild).toHaveBeenCalledOnce()
  })

  it('caps generation and fallback work at 30 seconds and continues with the next slot', async () => {
    vi.useFakeTimers()
    const second = { type: 'photo', description: 'Second photo', prompt: 'Second photo' }
    const work = generateBlueprintPhotoAssets([visuals[0], second], {
      generate: async () => new Promise(() => {}),
      saveGenerated: async () => '',
      timeoutMs: 90_000,
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(work).resolves.toHaveLength(2)
    vi.useRealTimers()
  })
})


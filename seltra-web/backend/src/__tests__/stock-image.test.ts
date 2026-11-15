import { sourceStockImage } from '../builder/stock-image'

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(22 * 1024, 1),
])

describe('stock image sourcing', () => {
  const originalKeys = {
    pexels: process.env.PEXELS_API_KEY,
    pixabay: process.env.PIXABAY_API_KEY,
    unsplash: process.env.UNSPLASH_ACCESS_KEY,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries({
      PEXELS_API_KEY: originalKeys.pexels,
      PIXABAY_API_KEY: originalKeys.pixabay,
      UNSPLASH_ACCESS_KEY: originalKeys.unsplash,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('downloads and validates a raster result with provider attribution', async () => {
    process.env.PEXELS_API_KEY = 'test-key'
    delete process.env.PIXABAY_API_KEY
    delete process.env.UNSPLASH_ACCESS_KEY
    const fetcher = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        photos: [{ src: { large: 'https://images.pexels.com/photos/123/large.jpeg' }, photographer: 'Test Photographer', photographer_url: 'https://www.pexels.com/@test' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(png, { status: 200 }))

    await expect(sourceStockImage('editorial fashion image', fetcher)).resolves.toMatchObject({
      bytes: png,
      mimeType: 'image/png',
      provider: 'pexels',
      attribution: 'Photo by Test Photographer on Pexels — https://www.pexels.com/@test',
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error' })
  })

  it('reports absent credentials rather than returning an SVG-shaped success', async () => {
    delete process.env.PEXELS_API_KEY
    delete process.env.PIXABAY_API_KEY
    delete process.env.UNSPLASH_ACCESS_KEY

    await expect(sourceStockImage('editorial fashion image', jest.fn()))
      .rejects.toThrow('No stock image provider is configured.')
  })
})

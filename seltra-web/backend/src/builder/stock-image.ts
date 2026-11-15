type StockImage = {
  bytes: Buffer
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  provider: 'pexels' | 'pixabay' | 'unsplash'
  attribution: string
}

type Candidate = {
  provider: StockImage['provider']
  url?: string
  attribution?: string
  sourceUrl?: string
}

const MIN_STOCK_IMAGE_BYTES = 20 * 1024
const MAX_STOCK_IMAGE_BYTES = 2 * 1024 * 1024

function rasterMime(bytes: Buffer): StockImage['mimeType'] | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function safeImageUrl(value: unknown, allowedHosts: RegExp): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && allowedHosts.test(url.hostname) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

async function candidatesFor(query: string, fetcher: typeof fetch): Promise<{ candidates: Candidate[]; failures: string[] }> {
  const candidates: Candidate[] = []
  const failures: string[] = []
  const pexelsKey = process.env.PEXELS_API_KEY?.trim()
  const pixabayKey = process.env.PIXABAY_API_KEY?.trim()
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY?.trim()

  if (pexelsKey) {
    try {
      const response = await fetcher(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=square`, {
        headers: { Authorization: pexelsKey },
        signal: AbortSignal.timeout(8_000),
        redirect: 'error',
      })
      if (!response.ok) failures.push(`Pexels search returned HTTP ${response.status}.`)
      else {
        const body = await response.json() as { photos?: Array<{ src?: { large2x?: string; large?: string }; photographer?: string; photographer_url?: string }> }
        const photo = body.photos?.[0]
        const imageUrl = safeImageUrl(photo?.src?.large ?? photo?.src?.large2x, /^images\.pexels\.com$/i)
        if (imageUrl) candidates.push({
          provider: 'pexels',
          url: imageUrl,
          attribution: photo?.photographer ? `Photo by ${photo.photographer} on Pexels` : 'Pexels photo',
          sourceUrl: safeImageUrl(photo?.photographer_url, /^www\.pexels\.com$/i),
        })
        else failures.push('Pexels search returned no supported image.')
      }
    } catch (error) {
      failures.push(`Pexels search failed: ${error instanceof Error ? error.name : 'unknown error'}.`)
    }
  }

  if (pixabayKey) {
    try {
      const response = await fetcher(`https://pixabay.com/api/?key=${encodeURIComponent(pixabayKey)}&q=${encodeURIComponent(query)}&image_type=photo&safesearch=true&per_page=3`, {
        signal: AbortSignal.timeout(8_000),
        redirect: 'error',
      })
      if (!response.ok) failures.push(`Pixabay search returned HTTP ${response.status}.`)
      else {
        const body = await response.json() as { hits?: Array<{ largeImageURL?: string; webformatURL?: string; user?: string; pageURL?: string }> }
        const hit = body.hits?.[0]
        const imageUrl = safeImageUrl(hit?.largeImageURL ?? hit?.webformatURL, /^(?:cdn\.)?pixabay\.com$/i)
        if (imageUrl) candidates.push({
          provider: 'pixabay',
          url: imageUrl,
          attribution: hit?.user ? `Photo by ${hit.user} on Pixabay` : 'Pixabay photo',
          sourceUrl: safeImageUrl(hit?.pageURL, /^pixabay\.com$/i),
        })
        else failures.push('Pixabay search returned no supported image.')
      }
    } catch (error) {
      failures.push(`Pixabay search failed: ${error instanceof Error ? error.name : 'unknown error'}.`)
    }
  }

  if (unsplashKey) {
    try {
      const response = await fetcher(`https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=squarish&content_filter=high`, {
        headers: { Authorization: `Client-ID ${unsplashKey}`, 'Accept-Version': 'v1' },
        signal: AbortSignal.timeout(8_000),
        redirect: 'error',
      })
      if (!response.ok) failures.push(`Unsplash search returned HTTP ${response.status}.`)
      else {
        const body = await response.json() as { urls?: { regular?: string; small?: string }; user?: { name?: string; links?: { html?: string } } }
        const imageUrl = safeImageUrl(body.urls?.regular ?? body.urls?.small, /^images\.unsplash\.com$/i)
        if (imageUrl) candidates.push({
          provider: 'unsplash',
          url: imageUrl,
          attribution: body.user?.name ? `Photo by ${body.user.name} on Unsplash` : 'Unsplash photo',
          sourceUrl: safeImageUrl(body.user?.links?.html, /^unsplash\.com$/i),
        })
        else failures.push('Unsplash search returned no supported image.')
      }
    } catch (error) {
      failures.push(`Unsplash search failed: ${error instanceof Error ? error.name : 'unknown error'}.`)
    }
  }

  return { candidates, failures }
}

export async function sourceStockImage(query: string, fetcher: typeof fetch = fetch): Promise<StockImage> {
  const normalizedQuery = query.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!normalizedQuery) throw new Error('A descriptive stock image query is required.')

  const { candidates, failures } = await candidatesFor(normalizedQuery, fetcher)
  for (const candidate of candidates) {
    try {
      if (!candidate.url) {
        failures.push(`${candidate.provider} returned no image URL.`)
        continue
      }
      const response = await fetcher(candidate.url, { signal: AbortSignal.timeout(12_000), redirect: 'error' })
      if (!response.ok) {
        failures.push(`${candidate.provider} image download returned HTTP ${response.status}.`)
        continue
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length < MIN_STOCK_IMAGE_BYTES || bytes.length > MAX_STOCK_IMAGE_BYTES) {
        failures.push(`${candidate.provider} image size was outside the supported range.`)
        continue
      }
      const mimeType = rasterMime(bytes)
      if (!mimeType) {
        failures.push(`${candidate.provider} returned a non-raster image.`)
        continue
      }
      return {
        bytes,
        mimeType,
        provider: candidate.provider,
        attribution: [candidate.attribution, candidate.sourceUrl].filter(Boolean).join(' — '),
      }
    } catch (error) {
      failures.push(`${candidate.provider} image download failed: ${error instanceof Error ? error.name : 'unknown error'}.`)
    }
  }

  const detail = failures.length ? failures.join(' ') : 'No stock image provider is configured.'
  throw new Error(`Stock image sourcing failed. ${detail}`)
}

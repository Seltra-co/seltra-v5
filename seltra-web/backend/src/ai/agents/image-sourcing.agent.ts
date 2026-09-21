//ai/agents/image-sourcing.agent.ts
import type { StoreDNA } from '../../types/store-dna'
import { buildImagePromptPrefix } from './dna.agent'
import { generateProductImage } from '../providers/cloudflare-images'

async function fetchPexels(query: string): Promise<string | null> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=square`, {
      headers: { Authorization: key },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.photos?.[0]?.src?.large || null
  } catch { return null }
}

async function fetchPixabay(query: string): Promise<string | null> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&safesearch=true&per_page=3`)
    if (!res.ok) return null
    const data = await res.json()
    return data.hits?.[0]?.largeImageURL || null
  } catch { return null }
}

function cleanQuery(name: string, category: string): string {
  return [...new Set([...name.toLowerCase().split(/\s+/), category.toLowerCase()])]
    .filter(w => w.length > 2 && !/^(the|and|for|with|set|kit|pack)$/.test(w))
    .slice(0, 4)
    .join(' ')
}


//── Unsplash API — optional remote fetch, returns images.unsplash.com URLs (no CORS) ──

export default function productArtDataUrl(productName: string, category: string): string {
  const seed = [...`${productName}:${category}`].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const palettes = [
    ['#06110d', '#16c784', '#d7fff0'],
    ['#111827', '#38bdf8', '#e0f2fe'],
    ['#1f1303', '#f59e0b', '#fff7ed'],
    ['#2a1020', '#f472b6', '#fdf2f8'],
  ]
  const [bg, accent, text] = palettes[seed % palettes.length]
  const initials = productName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('') || 'S'
  const safeName = productName.replace(/[&<>"']/g, '')
  const safeCategory = category.replace(/[&<>"']/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="${bg}"/><path d="M0 430C110 370 180 470 300 410C420 350 500 250 600 300V600H0Z" fill="${accent}" opacity=".18"/><circle cx="470" cy="125" r="86" fill="${accent}" opacity=".16"/><rect x="70" y="82" width="460" height="436" rx="36" fill="#ffffff" opacity=".05" stroke="${accent}" stroke-opacity=".35"/><text x="300" y="268" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="92" font-weight="800" fill="${accent}">${initials}</text><text x="300" y="334" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="26" font-weight="700" fill="${text}">${safeName.slice(0, 26)}</text><text x="300" y="374" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="18" fill="${text}" opacity=".68">${safeCategory.slice(0, 30)}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

async function fetchUnsplashUrl(
  productName: string,
  category: string,
): Promise<string> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY

  const fallback = () => productArtDataUrl(productName, category)

  if (!accessKey || process.env.SELTRA_REMOTE_PRODUCT_IMAGES !== 'true') {
    return fallback()
  }

  try {
    const clean = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()

    const query = [
      ...clean(productName).split(' ').slice(0, 2),
      clean(category).split(' ')[0],
    ]
      .filter(Boolean)
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .join(' ')

    const res = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=squarish&content_filter=high`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
      }
    )

    if (!res.ok) {
      console.warn(`[Unsplash] ${res.status} for "${query}" — using fallback`)
      return fallback()
    }

    const data = await res.json()
    //Use the regular size — good quality, not too large
    return data.urls?.regular || data.urls?.small || fallback()
  } catch (err) {
    console.warn('[Unsplash] fetch failed — using fallback:', err)
    return fallback()
  }
}


// export async function sourceImage(name: string, category: string, fallbackSvg: () => string): Promise<string> {
//   const query = cleanQuery(name, category)
//   const url = (await fetchPexels(query)) || (await fetchPixabay(query))
//   return url || fallbackSvg()
// }
export async function sourceImage(
  name: string,
  category: string,
  dna?: StoreDNA,
): Promise<string> {
  if (process.env.SELTRA_IMAGE_PROVIDER === 'cloudflare' && dna) {
    const prompt = `${buildImagePromptPrefix(dna)}, ${name}, ${category}, product photography`
    const generated = await generateProductImage(prompt)
    if (generated) return generated
  }

  const query = cleanQuery(name, category)

  const pexels = await fetchPexels(query)
  if (pexels) return pexels

  const pixabay = await fetchPixabay(query)
  if (pixabay) return pixabay

  return fetchUnsplashUrl(name, category)
}
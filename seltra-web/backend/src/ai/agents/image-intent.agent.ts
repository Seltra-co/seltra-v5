//backend/src/ai/agents/image-intent.agent.ts
export interface ImageChangeIntent {
  target: 'hero' | 'product' | 'logo' | 'story' | 'unclear'
  productMatch?: { id: string; name: string }
  requestedUrl?: string
  stylePrompt?: string
}

const URL_REGEX = /https?:\/\/[^\s)\]]+/i
const LOGO_KEYWORDS = /\b(logo|brand mark|brandmark|store icon|store badge|company logo)\b/i
const STORY_KEYWORDS = /\b(our story|about us|about section|story section|brand story|founder story)\b/i

const NOISE_WORDS =
  /\b(generate|regenerate|change|update|new|make|create|use|set|swap|replace|please|can|you|for|the|a|an|to|my|image|photo|picture|hero|banner|logo|brand|mark|icon|badge|our|story|about|section|founder)\b/gi

export function parseImageChangeIntent(
  message: string,
  products: Array<{ id: string; name: string }>,
): ImageChangeIntent {
  const urlMatch = message.match(URL_REGEX)
  const requestedUrl = urlMatch?.[0]
  const lower = message.toLowerCase()

  const mentionsHero = /\bhero\b|\bbanner\b|\bmain image\b|\bcover\b|\bmain photo\b/.test(lower)

  // Longest matching product name wins, so "Signature Bundle 2" doesn't
  // get shadowed by a shorter partial match like "Bundle".
  let productMatch: { id: string; name: string } | undefined
  let bestLen = 0
  for (const p of products) {
    const name = p.name.toLowerCase()
    if (name.length > 2 && lower.includes(name) && name.length > bestLen) {
      productMatch = p
      bestLen = name.length
    }
  }

  const stylePrompt = message
    .replace(URL_REGEX, '')
    .replace(NOISE_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (LOGO_KEYWORDS.test(message)) {
    return { target: 'logo', requestedUrl, stylePrompt: stylePrompt || undefined }
  }
  if (STORY_KEYWORDS.test(message)) {
    return { target: 'story', requestedUrl, stylePrompt: stylePrompt || undefined }
  }
  if (productMatch) {
    return { target: 'product', productMatch, requestedUrl, stylePrompt: stylePrompt || undefined }
  }
  if (mentionsHero) {
    return { target: 'hero', requestedUrl, stylePrompt: stylePrompt || undefined }
  }
  // No hero keyword and no product match — ambiguous unless there's only
  // one sensible target (e.g. store has no products yet).
  return { target: products.length ? 'unclear' : 'hero', requestedUrl, stylePrompt: stylePrompt || undefined }
}

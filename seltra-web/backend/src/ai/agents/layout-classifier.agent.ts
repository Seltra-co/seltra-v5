//seltra-web/backend/src/ai/agents/layout-classifier.agent.ts

import type { CanonicalStore } from '../../types'

export type LayoutVariant = 'editorial' | 'grid' | 'bold'

export interface ColorScheme {
  bg: string; surface: string; accent: string; accentFg: string
  text: string; muted: string; border: string
}

const COLOR_SCHEMES: Record<LayoutVariant, ColorScheme> = {
  editorial: { bg: '#faf9f7', surface: '#ffffff', accent: '#b8860b', accentFg: '#ffffff', text: '#1a1a1a', muted: '#6b6b6b', border: '#e8e4df' },
  grid:      { bg: '#0a0a0a', surface: '#111111', accent: '#00A86B', accentFg: '#000000', text: '#e5e7eb', muted: '#6b7280', border: '#1f1f1f' },
  bold:      { bg: '#0d0d0d', surface: '#141414', accent: '#ff3c00', accentFg: '#ffffff', text: '#f0f0f0', muted: '#888888', border: '#222222' },
}

const TYPOGRAPHY: Record<LayoutVariant, { heading: string; body: string }> = {
  editorial: { heading: 'DM Serif Display', body: 'DM Sans' },
  grid:      { heading: 'Syne',             body: 'Inter' },
  bold:      { heading: 'Bebas Neue',       body: 'Inter' },
}

const EDITORIAL_KEYWORDS = [
  'beauty', 'skincare', 'cosmetic', 'luxury', 'jewelry', 'jewellery',
  'perfume', 'fragrance', 'wellness', 'candle', 'handmade', 'artisan',
  'boutique', 'floral', 'spa', 'organic', 'natural', 'serum', 'lotion',
]

const BOLD_KEYWORDS = [
  'streetwear', 'sneaker', 'footwear', 'sport', 'gym', 'fitness',
  'gaming', 'tech', 'hype', 'urban', 'apparel', 'men', 'shoe',
  'trainer', 'jersey', 'athletic', 'hoodie', 'drip',
]

function scoreKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase()
  return keywords.filter(k => lower.includes(k)).length
}

//Pure rule-based — no LLM call, no tokens, no rate limits
export async function classifyLayout(canonical: CanonicalStore): Promise<{
  variant: LayoutVariant
  colorScheme: ColorScheme
  typography: { heading: string; body: string }
}> {
  const corpus = [
    canonical.businessName,
    canonical.businessType,
    canonical.targetAudience,
    ...(canonical.productCategories || []),
  ].join(' ')

  const editorialScore = scoreKeywords(corpus, EDITORIAL_KEYWORDS)
  const boldScore = scoreKeywords(corpus, BOLD_KEYWORDS)

  let variant: LayoutVariant = 'grid'
  if (editorialScore > boldScore && editorialScore > 0) variant = 'editorial'
  else if (boldScore > editorialScore && boldScore > 0) variant = 'bold'

  return {
    variant,
    colorScheme: COLOR_SCHEMES[variant],
    typography: TYPOGRAPHY[variant],
  }
}

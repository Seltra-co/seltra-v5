//seltra-web/backend/src/ai/agents/dna.agent.ts
// Extracts StoreDNA from a merchant prompt — rule-based first, zero LLM tokens.
// The LLM enrichment path is kept for future use but is opt-in via env flag.

import { detectIndustry, resolveComposition } from './composition-rules'
import type { StoreDNA, Industry, BrandPersonality } from '../../types/store-dna'

// Palette map — mirrors themes/index.ts on the frontend
const PALETTE_MAP: Record<string, StoreDNA['palette']> = {
  luxury: { bg: '#faf9f7', surface: '#ffffff', border: '#e8e4df', text: '#1a1a1a', muted: '#7a7060', accent: '#b8860b', accentText: '#ffffff', accentSoft: '#fdf5e4' },
  'bold-dark': { bg: '#0d0d0d', surface: '#141414', border: '#2a2a2a', text: '#f0f0f0', muted: '#888888', accent: '#ff3c00', accentText: '#ffffff', accentSoft: '#1f1008' },
  'minimal-light': { bg: '#fafafa', surface: '#ffffff', border: '#e5e5e5', text: '#1a1a1a', muted: '#717171', accent: '#2563eb', accentText: '#ffffff', accentSoft: '#eff6ff' },
  editorial: { bg: '#f8f6f3', surface: '#ffffff', border: '#e0d8ce', text: '#1c1815', muted: '#8c7b6b', accent: '#c4622d', accentText: '#ffffff', accentSoft: '#f9ede8' },
  'warm-earth': { bg: '#faf7f2', surface: '#ffffff', border: '#e8dfd0', text: '#2d2419', muted: '#8a7560', accent: '#c4622d', accentText: '#ffffff', accentSoft: '#f5ece6' },
  'cool-modern': { bg: '#f0f4f8', surface: '#ffffff', border: '#dde3ea', text: '#0f1923', muted: '#627282', accent: '#0070f3', accentText: '#ffffff', accentSoft: '#e8f0fe' },
  vibrant: { bg: '#0a0a0a', surface: '#111111', border: '#1f1f1f', text: '#ffffff', muted: '#888888', accent: '#00e676', accentText: '#000000', accentSoft: '#00e67615' },
}

const TYPOGRAPHY_MAP: Record<string, StoreDNA['typography']> = {
  luxury: { headingFont: 'Playfair Display', bodyFont: 'DM Sans' },
  'bold-dark': { headingFont: 'Bebas Neue', bodyFont: 'Inter' },
  'minimal-light': { headingFont: 'Syne', bodyFont: 'Inter' },
  editorial: { headingFont: 'Fraunces', bodyFont: 'DM Sans' },
  'warm-earth': { headingFont: 'Fraunces', bodyFont: 'DM Sans' },
  'cool-modern': { headingFont: 'Inter', bodyFont: 'Inter' },
  vibrant: { headingFont: 'Syne', bodyFont: 'Inter' },
}

const VISUAL_STYLE_MAP: Record<string, Pick<StoreDNA, 'lighting' | 'cameraStyle' | 'backgroundStyle'>> = {
  luxury: { lighting: 'studio-softbox', cameraStyle: '85mm-editorial', backgroundStyle: 'warm-neutral' },
  'bold-dark': { lighting: 'moody-dramatic', cameraStyle: 'lifestyle-context', backgroundStyle: 'dark-studio' },
  'minimal-light': { lighting: 'soft-daylight', cameraStyle: 'flatlay-overhead', backgroundStyle: 'pure-white' },
  editorial: { lighting: 'soft-daylight', cameraStyle: '85mm-editorial', backgroundStyle: 'warm-neutral' },
  'warm-earth': { lighting: 'soft-daylight', cameraStyle: 'lifestyle-context', backgroundStyle: 'textured-surface' },
  'cool-modern': { lighting: 'bright-flatlay', cameraStyle: 'flatlay-overhead', backgroundStyle: 'pure-white' },
  vibrant: { lighting: 'studio-softbox', cameraStyle: 'macro-detail', backgroundStyle: 'pure-white' },
}

const PERSONALITY_BY_INDUSTRY: Record<string, BrandPersonality> = {
  beauty: 'luxury',
  skincare: 'luxury',
  jewelry: 'luxury',
  candles: 'artisan',
  wellness: 'premium',
  food: 'artisan',
  restaurant: 'artisan',
  streetwear: 'bold',
  fashion: 'modern',
  apparel: 'minimal',
  electronics: 'modern',
  tech: 'modern',
  artisan: 'artisan',
  general: 'minimal',
}

export function extractDNA(prompt: string, businessType?: string, targetAudience?: string): StoreDNA {
  const corpus = [prompt, businessType ?? '', targetAudience ?? ''].join(' ')
  const industry = detectIndustry(corpus) as Industry
  const composition = resolveComposition(industry)
  const themeKey = composition.theme

  const palette = PALETTE_MAP[themeKey] ?? PALETTE_MAP['minimal-light']
  const typography = TYPOGRAPHY_MAP[themeKey] ?? TYPOGRAPHY_MAP['minimal-light']
  const visualStyle = VISUAL_STYLE_MAP[themeKey] ?? VISUAL_STYLE_MAP['minimal-light']

  // Detect visual density from keywords
  const lower = corpus.toLowerCase()
  const visualDensity: StoreDNA['visualDensity'] =
    /minimal|clean|simple|sleek/.test(lower) ? 'minimal' :
    /rich|full|detailed|premium/.test(lower) ? 'rich' : 'balanced'

  const colorMood: StoreDNA['colorMood'] =
    themeKey === 'bold-dark' || themeKey === 'vibrant' ? 'dark' :
    themeKey === 'warm-earth' || themeKey === 'editorial' ? 'warm' :
    themeKey === 'cool-modern' ? 'cool' :
    themeKey === 'luxury' ? 'neutral' : 'neutral'

  const heroStyle: StoreDNA['heroStyle'] =
    composition.layout === 'showcase' ? 'fullbleed' :
    composition.layout === 'storytelling' ? 'split' :
    composition.layout === 'editorial' ? 'editorial' :
    composition.layout === 'catalog' ? 'minimal' : 'centered'

  return {
    industry,
    brandPersonality: PERSONALITY_BY_INDUSTRY[industry] ?? 'minimal',
    audience: targetAudience ?? 'modern shoppers',
    conversionGoal: composition.layout === 'catalog' ? 'catalog_browse' :
      composition.layout === 'storytelling' ? 'lead_generation' : 'direct_sales',
    visualDensity,
    colorMood,
    animationLevel: themeKey === 'bold-dark' ? 'dynamic' : 'subtle',
    heroStyle,
    productDisplay: composition.layout === 'showcase' ? 'featured' : 'grid',
    palette,
    typography,
    lighting: visualStyle.lighting,
    cameraStyle: visualStyle.cameraStyle,
    backgroundStyle: visualStyle.backgroundStyle,
  }
}

export function buildImagePromptPrefix(dna: StoreDNA): string {
  const lightingLabel = dna.lighting === 'studio-softbox' ? 'studio softbox lighting' :
    dna.lighting === 'moody-dramatic' ? 'moody dramatic lighting' :
    dna.lighting === 'bright-flatlay' ? 'bright flatlay lighting' : 'soft daylight lighting'

  const cameraLabel = dna.cameraStyle === '85mm-editorial' ? '85mm editorial lens' :
    dna.cameraStyle === 'flatlay-overhead' ? 'flatlay overhead composition' :
    dna.cameraStyle === 'macro-detail' ? 'macro detail lens' : 'lifestyle context composition'

  const backgroundLabel = dna.backgroundStyle === 'warm-neutral' ? 'warm neutral backdrop' :
    dna.backgroundStyle === 'pure-white' ? 'pure white backdrop' :
    dna.backgroundStyle === 'dark-studio' ? 'dark studio backdrop' : 'textured surface backdrop'

  return `editorial studio photograph, ${lightingLabel}, ${backgroundLabel}, ${cameraLabel}, minimal shadow, premium commercial aesthetic`
}
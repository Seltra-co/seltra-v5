//seltra-web/backend/src/ai/agents/manifest.agent.ts
import { chat } from '../client'
import type { CanonicalStore } from '../../types'
import { detectIndustry, resolveComposition, type LayoutKey } from './composition-rules'
import { runCritic, type ManifestForCritic } from './critic.agent'
import { refineManifest } from './refinement.engine'
import { THEME_PALETTES, THEME_TYPOGRAPHY, type StorePalette, type StoreTypography } from '../design-system/theme'

export type { StorePalette, StoreTypography } from '../design-system/theme'
export interface StoreManifest { sections: ManifestSection[]; palette: StorePalette; typography: StoreTypography }

export type ManifestPatch = {
  upsertSection?: { index?: number; section: ManifestSection }
  removeSection?: { type?: ManifestSection['type']; index?: number }
  reorderSections?: Array<ManifestSection['type']>
  updateSectionFields?: { type: ManifestSection['type']; fields: Record<string, unknown> }
  updatePalette?: Partial<StorePalette>
  updateTypography?: Partial<StoreTypography>
}

export interface ManifestPatchResult {
  applied: boolean
  reason?: string
  before?: StoreManifest
  after?: StoreManifest
}

export interface ManifestBuildHooks {
  onCritiqueStart?: () => void
  onCritiqueEnd?: (score: number, fixesApplied: number) => void
}

type ManifestSection =
  | { type: 'announcement-bar'; message: string }
  | { type: 'featured-drop'; badge: string; headline: string; subtext: string; showCountdown?: boolean }
  | { type: 'product-grid'; columns: 2 | 3 | 4; style: string; limit?: number; showCategory?: boolean; sectionLabel?: string }
  | { type: 'product-shelf'; headline: string; subtext?: string; limit?: number }
  | { type: 'brand-story'; headline: string; body: string; stat?: string; statLabel?: string; layout: 'text-left' | 'text-center'; imageUrl?: string }
  | { type: 'category-strip'; headline?: string }
  | { type: 'social-proof'; style: 'marquee' | 'grid' | 'cards'; headline?: string; subtext?: string }
  | { type: 'trust-bar'; items: string[] }
  | { type: 'newsletter'; headline: string; subtext: string; placeholder?: string }
  | { type: 'faq'; headline?: string; items?: Array<{ question: string; answer: string }> }

type ProductSample = Array<{ name: string; category?: string | null; price?: string | number }>


function displayName(blueprint: CanonicalStore): string {
  const brandName = (blueprint as unknown as { brandName?: string }).brandName
  if (brandName && brandName.trim().split(/\s+/).length <= 4) return brandName.trim()
  const words = (blueprint.businessName || 'Store').trim().split(/\s+/)
  return words.length > 3 ? words.slice(0, 2).join(' ') : words.join(' ')
}

function cleanJSON(raw: string): string {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  return cleaned.trim()
}

function repairTruncatedJSON(raw: string): string {
  let s = raw.trim().replace(/,\s*$/, '')
  const quotePositions: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) quotePositions.push(i)
  }
  if (quotePositions.length % 2 !== 0) s += '"'
  s = s.replace(/,\s*"?\s*$/, '')
  const arrays = (s.match(/\[/g) ?? []).length - (s.match(/\]/g) ?? []).length
  const objects = (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length
  return s + ']'.repeat(Math.max(0, arrays)) + '}'.repeat(Math.max(0, objects))
}

function sectionsForLayout(layout: LayoutKey, blueprint: CanonicalStore): ManifestSection[] {
  const name = displayName(blueprint)
  const trust = (blueprint.storeFeatures ?? []).slice(0, 4)
  const trustBar: ManifestSection = { type: 'trust-bar', items: trust.length ? trust : ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support'] }
  const productGrid: ManifestSection = { type: 'product-grid', columns: 3, style: layout === 'showcase' ? 'dense' : layout === 'editorial' ? 'magazine' : 'uniform', showCategory: true, sectionLabel: `${name} collection`, limit: 9 }
  const story: ManifestSection = { type: 'brand-story', headline: 'Why we exist', body: `${name} was built for ${blueprint.targetAudience ?? 'people who care about quality'}. Every detail is selected to make shopping simple and trustworthy.`, layout: 'text-left' }
  const newsletter: ManifestSection = { type: 'newsletter', headline: 'Stay in the loop', subtext: 'Get updates and exclusive offers.', placeholder: 'Enter your email' }
  const shelf: ManifestSection = { type: 'product-shelf', headline: 'Best Sellers', subtext: 'Our most loved products', limit: 6 }
  const announcement: ManifestSection = { type: 'announcement-bar', message: `Shop ${name} with fast delivery and secure checkout.` }
  const featured: ManifestSection = { type: 'featured-drop', badge: 'NEW DROP', headline: 'Just landed.', subtext: 'Fresh picks from the collection.', showCountdown: true }

  switch (layout) {
    case 'editorial': return [trustBar, shelf, story, productGrid, newsletter]
    case 'conversion': return [announcement, trustBar, productGrid, newsletter]
    case 'storytelling': return [story, shelf, trustBar, productGrid, newsletter]
    case 'showcase': return [announcement, featured, productGrid, trustBar]
    case 'catalog':
    default: return [trustBar, productGrid]
  }
}

export function deriveManifest(blueprint: CanonicalStore): StoreManifest {
  const corpus = [blueprint.businessName, blueprint.businessType ?? '', ...(blueprint.productCategories ?? [])].join(' ')
  const industry = detectIndustry(corpus)
  const composition = resolveComposition(industry)
  const themeKey = composition.theme
  return {
    sections: sectionsForLayout(composition.layout, blueprint),
    palette: THEME_PALETTES[themeKey] ?? THEME_PALETTES['minimal-light'],
    typography: THEME_TYPOGRAPHY[themeKey] ?? THEME_TYPOGRAPHY['minimal-light'],
  }
}

function sanitizeManifest(raw: Partial<StoreManifest>, blueprint: CanonicalStore): StoreManifest {
  const fallback = deriveManifest(blueprint)
  const allowed = new Set(['announcement-bar', 'featured-drop', 'product-grid', 'product-shelf', 'brand-story', 'category-strip', 'trust-bar', 'newsletter', 'faq'])
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter((s): s is ManifestSection => Boolean(s && allowed.has((s as { type?: string }).type ?? '')))
    .slice(0, 8)
  return {
    sections: sections.length ? sections : fallback.sections,
    palette: { ...fallback.palette, ...(raw.palette ?? {}) },
    typography: { ...fallback.typography, ...(raw.typography ?? {}) },
  }
}

export async function generateManifest(
  blueprint: CanonicalStore,
  dna: unknown,
  products: ProductSample,
  hooks?: ManifestBuildHooks,
): Promise<{ manifest: StoreManifest; provider: string; error: string | null }> {
  const fallback = deriveManifest(blueprint)
  const prompt = `Return ONLY strict JSON for a storefront manifest. Do not include hero or nav sections.
Use this exact top-level shape: {"sections":[],"palette":{},"typography":{}}
Allowed section types: trust-bar, category-strip, product-grid, product-shelf, featured-drop, brand-story, newsletter, faq, announcement-bar.
Keep output under 500 tokens.
Blueprint: ${JSON.stringify(blueprint)}
DNA: ${JSON.stringify(dna)}
Products: ${JSON.stringify(products.slice(0, 6))}`

  let manifest: StoreManifest
  let provider: string
  let error: string | null = null

  try {
    const result = await chat([{ role: 'user', content: prompt }], { maxTokens: 650, temperature: 0.2 })
    const cleaned = cleanJSON(result.content)
    try {
      manifest = sanitizeManifest(JSON.parse(cleaned), blueprint)
      provider = result.provider
    } catch {
      try {
        manifest = sanitizeManifest(JSON.parse(repairTruncatedJSON(cleaned)), blueprint)
        provider = `${result.provider}:json-repaired`
      } catch {
        manifest = fallback
        provider = 'fallback:deriveManifest'
      }
    }
  } catch (err) {
    manifest = fallback
    provider = 'fallback:deriveManifest'
    error = err instanceof Error ? err.message : String(err)
  }

  // P0.1 — this is the manifest StorefrontCanvas actually renders, so the
  // critic/refinement loop needs to run here, not in the unused HTML codegen path.
  hooks?.onCritiqueStart?.()
  const { manifest: refined, fixesApplied, finalReport } = await refineManifest(
    manifest as unknown as ManifestForCritic,
    blueprint,
    { expectHero: false },
  )
  hooks?.onCritiqueEnd?.(finalReport.score, fixesApplied.length)

  return { manifest: refined as unknown as StoreManifest, provider, error }
}

export function applyManifestPatch(manifest: StoreManifest, patch: ManifestPatch): ManifestPatchResult {
  let mutated = false
  const next = JSON.parse(JSON.stringify(manifest)) as StoreManifest

  // upsertSection: insert or replace a section at a given index
  if (patch.upsertSection) {
    const { index, section } = patch.upsertSection
    if (index !== undefined && index >= 0 && index < next.sections.length) {
      next.sections[index] = section
    } else {
      next.sections.push(section)
    }
    mutated = true
  }

  // removeSection: remove by type and/or index
  if (patch.removeSection) {
    const { type, index } = patch.removeSection
    if (index !== undefined && index >= 0 && index < next.sections.length) {
      next.sections.splice(index, 1)
      mutated = true
    } else if (type) {
      const original = next.sections.length
      next.sections = next.sections.filter((s) => s.type !== type)
      if (next.sections.length < original) mutated = true
    }
  }

  // reorderSections: sort by type order
  if (patch.reorderSections && patch.reorderSections.length > 0) {
    const typeOrder = new Map(patch.reorderSections.map((type, idx) => [type, idx]))
    const reordered = [...next.sections].sort((a, b) => {
      const aIdx = typeOrder.has(a.type) ? typeOrder.get(a.type)! : Infinity
      const bIdx = typeOrder.has(b.type) ? typeOrder.get(b.type)! : Infinity
      return aIdx - bIdx
    })
    if (JSON.stringify(reordered) !== JSON.stringify(next.sections)) {
      next.sections = reordered
      mutated = true
    }
  }

  // updateSectionFields: shallow merge fields into matching section(s) by type
  if (patch.updateSectionFields) {
    const { type, fields } = patch.updateSectionFields
    const target = next.sections.find((s) => s.type === type)
    if (target) {
      Object.assign(target, fields)
      mutated = true
    }
  }

  // updatePalette: merge into palette with contrast validation
  if (patch.updatePalette) {
    const merged = { ...next.palette, ...patch.updatePalette }
    
    // Check contrast ratios for critical color pairs
    const minContrastRatio = 4.5
    if (merged.bg && merged.text && getContrastRatio(merged.bg, merged.text) < minContrastRatio) {
      merged.text = getRelativeLuminance(merged.bg) > 0.5 ? '#111111' : '#f8fafc'
      merged.muted = getRelativeLuminance(merged.bg) > 0.5 ? '#6b6d72' : '#a1a1aa'
    }
    
    if (merged.bg && merged.surface && merged.bg.toLowerCase() === merged.surface.toLowerCase()) {
      merged.surface = getRelativeLuminance(merged.bg) > 0.5 ? '#ffffff' : '#111111'
      merged.border = getRelativeLuminance(merged.bg) > 0.5 ? '#e7e7e5' : '#26262a'
    }
    
    next.palette = merged
    mutated = true
  }

  // updateTypography: merge into typography
  if (patch.updateTypography) {
    next.typography = { ...next.typography, ...patch.updateTypography }
    mutated = true
  }

  if (!mutated) {
    return { applied: false, reason: 'No changes matched the patch instruction' }
  }

  return { applied: true, before: manifest, after: next }
}

/**
 * Calculate relative luminance of a hex color.
 * Used for WCAG contrast ratio calculation.
 */
function getRelativeLuminance(hex: string): number {
  const rgb = parseInt(hex.slice(1), 16)
  const r = (rgb >> 16) & 255
  const g = (rgb >> 8) & 255
  const b = rgb & 255
  
  const [rs, gs, bs] = [r, g, b].map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Calculate WCAG contrast ratio between two hex colors.
 * Returns ratio between 1:1 and 21:1.
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1)
  const lum2 = getRelativeLuminance(hex2)
  const lighter = Math.max(lum1, lum2)
  const darker = Math.min(lum1, lum2)
  return (lighter + 0.05) / (darker + 0.05)
}

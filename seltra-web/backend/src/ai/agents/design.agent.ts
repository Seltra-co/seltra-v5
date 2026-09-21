//ai/agents/design.agent.ts
import { callCloudflare, CF_MODELS, isModelAvailable } from '../../providers/cloudflare'
import { chat } from '../client'
import type { CanonicalStore } from '../../types'
import type { StoreDNA } from '../../types/store-dna'
import { type HeroDesignSpec, type HeroSecondaryCardSpec, type NavDesignSpec } from '../design-system/contracts'
import { isFabricationGuarded, PAYMENT_PROVIDER_MENTION } from '../design-system/guards'

const DESIGN_SYSTEM_PROMPT = `You are Seltra's Design Agent. Creator: Seltra Inc. You do NOT write code. You decide ONE hero
layout archetype for this specific brand and return strict JSON only, matching:
{"archetype": "...", "dominantElement": "...", "imageTreatment": "...", "headline": "...", "tagline": "...", "secondaryCard": {"kind":"none","position":"float-below","fields":{}}, "ctaLabel": "...", "secondaryCtaLabel": "...", "spacingRhythm": "...", "trustBadges": ["...", "..."], "rationale": "..."}

Respond with ONLY the JSON object. Do not think step by step, do not explain your reasoning, do not
write anything before or after the JSON. Output the JSON object as your very first characters.

Rules:
- Pick the archetype that best fits THIS brand's industry and voice — do not default to centered-stacked
  unless it's genuinely the best fit. Vary it: split layouts suit stores with a strong hero product photo;
  fullbleed suits streetwear/bold brands; minimal-typographic suits premium/editorial brands with no photo;
  editorial-commerce suits polished DTC brands (skincare, food, home goods) that want a framed product
  panel plus a row of credibility chips beneath the CTAs, similar to premium subscription/DTC landing pages.
- ctaLabel must be 1-3 words in the brand's voice, never generic "Shop Now" unless the brand voice is
  literally plain/direct.
- Do not reuse raw productCategories or category names in the headline, tagline, or CTA text. A hero
  headline like "Shirts Polo Knitted Casual" is invalid.
- headline must be a benefit statement or brand promise in the brand's voice, 3-7 words, never a
  business-type description.
- tagline must be one supporting sentence, never a generic "The best of X." template.
- secondaryCard: choose a non-"none" card only when you have real evidence to support it. For pricing-tile, require a real base price or price range. For subscribe-offer, only if the store clearly implies recurring purchase behavior (food/wellness or subscription-like product patterns). For frequently-bought, only if there are at least 3 products in the featured product category. For review-snippet, never use it for a new store because reviews are unavailable.
- trustBadges: 0-3 short chips built ONLY from real facts you're given (fulfillment mode, product count,
  categories) — e.g. "Delivery across Accra & Lagos", "50+ items in stock". Do not use payment-provider
  names as trust badges, even if they are available in the store data. NEVER invent star ratings, review
  counts, customer numbers, or webpage section names such as "Full-width hero banner", "Featured
  Collections", "Customer Reviews", or "Newsletter signup" — this store has no real review history yet
  and meta labels are not shopper-facing trust facts. Return [] if no real facts are available.
- HARD RULE, no exceptions: do not return, suggest, or imply any star rating, "X reviews", "loved by
  customers", "trusted by", testimonial, or social-proof badge of any kind. trustBadges may ONLY contain
  the factual chip types described above. A brand-new store has zero review history — inventing one is a
  deceptive UI element, not a design choice.
- rationale is one sentence explaining the choice — for logging only, never shown to the merchant.`

function cleanJSON(raw: string): string {
  let s = raw.trim()
  if (s.startsWith('```json')) s = s.slice(7)
  else if (s.startsWith('```')) s = s.slice(3)
  if (s.endsWith('```')) s = s.slice(0, -3)
  return s.trim()
}

type DesignProductLike = {
  id?: string
  name?: string | null
  price?: string | number | null
  currency?: string
  category?: string | null
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/)
    if (match) return Number(match[0])
  }
  return null
}

function isProductCategoryHeadline(value: string, blueprint: CanonicalStore): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  const categories = (blueprint.productCategories ?? [])
    .map((category) => category.trim().toLowerCase())
    .filter(Boolean)
  if (categories.length === 0) return false

  const joinedSpace = categories.join(' ')
  const joinedComma = categories.join(', ')
  if (joinedSpace && normalized === joinedSpace) return true
  if (joinedComma && normalized === joinedComma) return true

  const matches = categories.filter((category) => category.length > 2 && normalized.includes(category))
  return matches.length >= Math.min(2, categories.length)
}

function isGenericHeroTagline(value: string, blueprint: CanonicalStore): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  if (/^(the best of|discover our|welcome to|shop the collection|browse our|explore our)/.test(normalized)) return true
  return isProductCategoryHeadline(normalized, blueprint)
}

function isGenericCtaLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return [
    'learn more',
    'browse products',
    'explore collection',
    'view collection',
    'discover more',
    'see more',
    'see what\'s inside',
    'see whats inside',
  ].includes(normalized)
}

function hasRecurringSignal(blueprint: CanonicalStore): boolean {
  const haystack = `${blueprint.businessType ?? ''} ${(blueprint.storeFeatures ?? []).join(' ')}`.toLowerCase()
  return /(subscription|recurring|monthly|weekly|food|wellness|delivery)/i.test(haystack)
}

function extractDiscountPercent(values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (!value) continue
    const match = value.match(/(\d{1,2})\s*%/) ?? value.match(/(\d{1,2})\s*percent/i)
    if (match) return `${match[1]}%`
  }
  return null
}

export function deriveHeroSecondaryCardSpec(
  blueprint: CanonicalStore,
  products: DesignProductLike[] = [],
  archetype?: HeroDesignSpec['archetype'],
): HeroSecondaryCardSpec {
  if (archetype === 'minimal-typographic' || archetype === 'fullbleed-bottom-text') {
    return { kind: 'none', position: 'float-below', fields: {} }
  }

  const pricedProducts = products
    .map((product) => ({ value: parsePrice(product.price), product }))
    .filter((item): item is { value: number; product: DesignProductLike } => item.value !== null)

  if (pricedProducts.length > 0) {
    const { value, product } = pricedProducts[0]
    const currency = typeof product.currency === 'string' && product.currency.trim().length > 0 ? `${product.currency.trim()} ` : ''
    return {
      kind: 'pricing-tile',
      position: 'float-right',
      fields: {
        price: `${currency}${value}`,
        unit: 'from',
      },
    }
  }

  if (hasRecurringSignal(blueprint)) {
    const discountPercent = extractDiscountPercent([...(blueprint.storeFeatures ?? []), ...(blueprint.productCategories ?? [])])
    return {
      kind: 'subscribe-offer',
      position: 'overlap-bottom-left',
      fields: {
        offer: 'subscription',
        ...(discountPercent ? { discountPercent } : {}),
      },
    }
  }

  const firstCategory = products.find((product) => product.category)?.category
  if (firstCategory) {
    const categoryMatches = products.filter((product) => product.category?.toLowerCase() === firstCategory.toLowerCase())
    const names = categoryMatches.map((product) => product.name ?? '').filter((name) => name.trim().length > 0)
    if (names.length >= 3) {
      return {
        kind: 'frequently-bought',
        position: 'overlap-bottom-right',
        fields: { items: names.slice(0, 3).join(', ') },
      }
    }
  }

  return { kind: 'none', position: 'float-below', fields: {} }
}

function fallbackSpec(dna?: StoreDNA | null): HeroDesignSpec {
  const archetype: HeroDesignSpec['archetype'] =
    dna?.heroStyle === 'split' ? 'split-image-right' :
    dna?.heroStyle === 'fullbleed' ? 'fullbleed-bottom-text' :
    dna?.heroStyle === 'minimal' ? 'minimal-typographic' : 'centered-stacked'
  return {
    archetype, dominantElement: archetype === 'minimal-typographic' ? 'headline' : 'image',
    imageTreatment: archetype === 'minimal-typographic' ? 'none' : 'scrim-gradient',
    headline: 'Elevated essentials',
    tagline: 'Thoughtfully crafted for modern routines',
    layers: [
      { role: 'background', position: 'full-bleed', zIndex: 1 },
      { role: 'framed-panel', position: 'inline', zIndex: 2 },
      { role: 'floating-card', position: 'float-right', zIndex: 3 },
    ],
    secondaryCard: { kind: 'none', position: 'float-below', fields: {} },
    motionProfile: 'staggered-reveal',
    ctaLabel: 'Shop now', secondaryCtaLabel: 'Browse all',
    spacingRhythm: 'generous', trustBadges: [], rationale: 'deterministic fallback',
  }
}

function cleanTrustBadges(badges: unknown): string[] {
  if (!Array.isArray(badges)) return []
  const categoryCountPattern = /^\d+\s+(?:product\s+)?categories?\b/i
  return badges
    .filter((badge): badge is string => typeof badge === 'string')
    .map((badge) => badge.trim())
    .filter((badge) => badge.length > 0 && isFabricationGuarded(badge) && !PAYMENT_PROVIDER_MENTION.test(badge))
    .filter((badge) => !categoryCountPattern.test(badge))
    .slice(0, 3)
}

export function normalizeHeroDesignSpec(parsed: HeroDesignSpec, blueprint: CanonicalStore, products: DesignProductLike[]): HeroDesignSpec {
  const fallback = fallbackSpec(null)
  const archetypes = new Set<HeroDesignSpec['archetype']>([
    'centered-stacked',
    'split-image-right',
    'split-image-left',
    'fullbleed-bottom-text',
    'minimal-typographic',
    'editorial-commerce',
    'product-spotlight-floating',
    'marketplace-grid-hero',
    'lifestyle-scrim-cart',
  ])
  const dominantElements = new Set<HeroDesignSpec['dominantElement']>(['headline', 'image', 'product-grid'])
  const imageTreatments = new Set<HeroDesignSpec['imageTreatment']>(['none', 'scrim-gradient', 'framed-panel', 'fullbleed'])
  const motionProfiles = new Set<HeroDesignSpec['motionProfile']>(['static', 'staggered-reveal', 'parallax-safe'])
  const spacingRhythms = new Set<HeroDesignSpec['spacingRhythm']>(['tight', 'generous', 'editorial'])

  const archetype = archetypes.has(parsed.archetype) ? parsed.archetype : fallback.archetype
  const headline = typeof parsed.headline === 'string' && parsed.headline.trim().length > 0 && !isProductCategoryHeadline(parsed.headline, blueprint)
    ? parsed.headline.trim()
    : fallback.headline
  const tagline = typeof parsed.tagline === 'string' && parsed.tagline.trim().length > 0 && !isGenericHeroTagline(parsed.tagline, blueprint)
    ? parsed.tagline.trim()
    : fallback.tagline
  const ctaLabel = typeof parsed.ctaLabel === 'string' && parsed.ctaLabel.trim().length > 0 && !isGenericCtaLabel(parsed.ctaLabel)
    ? parsed.ctaLabel.trim()
    : fallback.ctaLabel
  const secondaryCtaLabel = typeof parsed.secondaryCtaLabel === 'string' && parsed.secondaryCtaLabel.trim().length > 0 && !isGenericCtaLabel(parsed.secondaryCtaLabel)
    ? parsed.secondaryCtaLabel.trim()
    : fallback.secondaryCtaLabel

  return {
    ...fallback,
    ...parsed,
    archetype,
    dominantElement: dominantElements.has(parsed.dominantElement) ? parsed.dominantElement : fallback.dominantElement,
    imageTreatment: imageTreatments.has(parsed.imageTreatment) ? parsed.imageTreatment : fallback.imageTreatment,
    headline,
    tagline,
    layers: Array.isArray(parsed.layers) ? parsed.layers : fallback.layers,
    secondaryCard: deriveHeroSecondaryCardSpec(blueprint, products, archetype),
    motionProfile: motionProfiles.has(parsed.motionProfile) ? parsed.motionProfile : fallback.motionProfile,
    ctaLabel,
    secondaryCtaLabel,
    spacingRhythm: spacingRhythms.has(parsed.spacingRhythm) ? parsed.spacingRhythm : fallback.spacingRhythm,
    trustBadges: cleanTrustBadges(parsed.trustBadges),
    rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim().length > 0 ? parsed.rationale.trim() : fallback.rationale,
  }
}

export function getDesignModelCandidates(role: 'hero' | 'nav'): string[] {
  return role === 'nav'
    ? [CF_MODELS.NAV_DESIGN_FAST, CF_MODELS.NAV_DESIGN_FALLBACK, CF_MODELS.CHAT_FAST]
    : [CF_MODELS.DESIGN_PRIMARY, CF_MODELS.DESIGN_REASONING, CF_MODELS.DESIGN_FALLBACK, CF_MODELS.CHAT_FAST]
}

export async function designHero(
  blueprint: CanonicalStore,
  dna: StoreDNA | null,
  products: DesignProductLike[] = [],
): Promise<HeroDesignSpec> {
  const facts = {
    paymentGateways: blueprint.recommendedTechStack?.paymentGateways ?? [],
    productCategories: blueprint.productCategories ?? [],
  }
  const prompt = `${DESIGN_SYSTEM_PROMPT}\n\nBrand: ${JSON.stringify({ name: blueprint.brandName, businessType: blueprint.businessType, targetAudience: blueprint.targetAudience, brandVoice: blueprint.brandVoice, industry: dna?.industry, brandPersonality: dna?.brandPersonality })}\n\nReal facts available for trustBadges (use only these, or none): ${JSON.stringify(facts)}`

  // Try the design roster before using the deterministic fallback.
  for (const model of getDesignModelCandidates('hero')) {
    if (!isModelAvailable(model)) continue
    try {
      const result = await callCloudflare([{ role: 'user', content: prompt }], { model, maxTokens: 1800, temperature: 0.6 })
      const parsed = JSON.parse(cleanJSON(result.content)) as HeroDesignSpec
      if (parsed.archetype && parsed.ctaLabel) {
        return normalizeHeroDesignSpec(parsed, blueprint, products)
      }
    } catch { /* try next model */ }
  }

  // Cloudflare exhausted, so use the deterministic fallback.
  try {
    const result = await chat([{ role: 'user', content: prompt }], { maxTokens: 1800 })
    const parsed = JSON.parse(cleanJSON(result.content)) as HeroDesignSpec
    if (parsed.archetype && parsed.ctaLabel) {
      return normalizeHeroDesignSpec(parsed, blueprint, products)
    }
  } catch { /* fall through */ }

  return fallbackSpec(dna)
}

export async function designNav(blueprint: CanonicalStore, dna: StoreDNA | null): Promise<NavDesignSpec> {
  const prompt = `${DESIGN_SYSTEM_PROMPT}\n\nBrand: ${JSON.stringify({ name: blueprint.brandName, businessType: blueprint.businessType, targetAudience: blueprint.targetAudience, brandVoice: blueprint.brandVoice, industry: dna?.industry, brandPersonality: dna?.brandPersonality })}\n\nReturn only a JSON object shaped like {"style":"flat"|"mega-dropdown","dropdownGroups":[{"label":"...","items":["..."]}]}.`

  for (const model of getDesignModelCandidates('nav')) {
    if (!isModelAvailable(model)) continue
    try {
      const result = await callCloudflare([{ role: 'user', content: prompt }], { model, maxTokens: 500, temperature: 0.2 })
      const parsed = JSON.parse(cleanJSON(result.content)) as NavDesignSpec
      if (parsed.style === 'flat' || parsed.style === 'mega-dropdown') {
        return {
          style: parsed.style,
          dropdownGroups: Array.isArray(parsed.dropdownGroups) ? parsed.dropdownGroups.slice(0, 3) : undefined,
        }
      }
    } catch { /* try next model */ }
  }

  try {
    const result = await chat([{ role: 'user', content: prompt }], { maxTokens: 500 })
    const parsed = JSON.parse(cleanJSON(result.content)) as NavDesignSpec
    if (parsed.style === 'flat' || parsed.style === 'mega-dropdown') {
      return {
        style: parsed.style,
        dropdownGroups: Array.isArray(parsed.dropdownGroups) ? parsed.dropdownGroups.slice(0, 3) : undefined,
      }
    }
  } catch { /* fall through */ }

  return { style: 'flat' }
}

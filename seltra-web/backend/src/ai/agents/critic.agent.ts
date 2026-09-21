//seltra-web/backend/src/ai/agents/critic.agent.ts

// Seltra Storefront Critic — evaluates a manifest before rendering.
// Pure deterministic logic. Zero LLM calls. Returns scored issues
// that the refinement engine uses to patch the manifest.

import type { CanonicalStore } from '../../types'
import { type HeroDesignSpec } from '../design-system/contracts'
import { isResponsiveHeroPattern, isResponsiveNavPattern } from '../design-system/guards'

export type CriticDimension = 'business' | 'design' | 'content'
export type CriticSeverity  = 'critical' | 'warning' | 'suggestion'

export interface CriticIssue {
  id:        string
  dimension: CriticDimension
  severity:  CriticSeverity
  section?:  string
  message:   string
  fix:       string   // machine-readable fix instruction
}

export interface CriticReport {
  score:        number   // 0–100
  issues:       CriticIssue[]
  passed:       boolean  // true if score >= PASS_THRESHOLD
  criticalCount: number
  warningCount:  number
}

const PASS_THRESHOLD = 72

export const VALID_FONTS = [
  'Playfair Display','DM Sans','Syne','Inter','Fraunces','Bebas Neue',
  'Cormorant Garamond','Montserrat','Lora','Raleway','Poppins','Nunito',
  'Work Sans','Space Grotesk','DM Serif Display','Libre Baskerville',
]

// ── Section type helpers ──────────────────────────────────────────────────────
type Section = { type: string; [key: string]: unknown }

function hasSection(sections: Section[], ...types: string[]): boolean {
  return types.some(t => sections.some(s => s.type === t))
}
function getSection<T extends { type: string; [key: string]: unknown }>(sections: Section[], type: string): T | undefined {
  return sections.find(s => s.type === type) as T | undefined
}
function countSections(sections: Section[], type: string): number {
  return sections.filter(s => s.type === type).length
}

// ── Individual checks ─────────────────────────────────────────────────────────

function checkHero(sections: Section[], blueprint: CanonicalStore): CriticIssue[] {
  const issues: CriticIssue[] = []
  const heroTypes = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
  const heroCount = heroTypes.reduce((n, t) => n + countSections(sections, t), 0)

  if (heroCount === 0) {
    issues.push({
      id: 'hero-missing',
      dimension: 'business',
      severity: 'critical',
      section: 'hero',
      message: 'No hero section. Merchants lose the first impression moment.',
      fix: 'INSERT_HERO:hero-centered',
    })
  }

  if (heroCount > 1) {
    issues.push({
      id: 'hero-duplicate',
      dimension: 'design',
      severity: 'critical',
      section: 'hero',
      message: 'Multiple hero sections create visual confusion.',
      fix: 'DEDUPLICATE_HERO',
    })
  }

  const hero = sections.find(s => heroTypes.includes(s.type))
  if (hero) {
    const headline = hero.headline as string | undefined
    // Detect when headline is the raw business name prompt (too long)
    if (headline && headline.split(' ').length > 4) {
      issues.push({
        id: 'hero-headline-too-long',
        dimension: 'content',
        severity: 'warning',
        section: hero.type,
        message: `Hero headline "${headline.slice(0,40)}..." reads like a description, not a brand name.`,
        fix: `SHORTEN_HERO_HEADLINE:${blueprint.businessName}`,
      })
    }
    // Detect generic taglines
    const tagline = hero.tagline as string | undefined
    const GENERIC_TAGLINES = ['shop the collection', 'the best of', 'discover our', 'welcome to']
    if (tagline && GENERIC_TAGLINES.some(g => tagline.toLowerCase().includes(g))) {
      issues.push({
        id: 'hero-generic-tagline',
        dimension: 'content',
        severity: 'warning',
        section: hero.type,
        message: `Tagline "${tagline}" is generic. Should reference the industry or audience.`,
        fix: `IMPROVE_HERO_TAGLINE:${blueprint.businessType}:${blueprint.targetAudience}`,
      })
    }
  }

  return issues
}

function checkHeroLayering(source: string, spec?: Partial<HeroDesignSpec>): CriticIssue[] {
  const issues: CriticIssue[] = []
  if (!spec) return issues
  const layeredArchetypes = ['editorial-commerce', 'product-spotlight-floating', 'lifestyle-scrim-cart']
  const impliesLayering = layeredArchetypes.includes(spec.archetype ?? '')
  if (!impliesLayering) return issues
  const hasLayeringHooks = /seltra-hero-secondary|z-index|zIndex|data-position/i.test(source)
  if (!hasLayeringHooks) {
    issues.push({
      id: 'hero-missing-layering',
      dimension: 'design',
      severity: 'critical',
      section: 'hero',
      message: 'Layered hero archetypes need explicit secondary card or z-index structure to preserve the intended composition.',
      fix: 'RETRY_CODING_AGENT:ADD_LAYERING',
    })
  }
  return issues
}

function checkHeroMotionProfile(source: string, spec?: Partial<HeroDesignSpec>): CriticIssue[] {
  const issues: CriticIssue[] = []
  if (!spec) return issues
  if (spec.motionProfile !== 'staggered-reveal') return issues
  const hasMotionPattern = /motion\.div|motionDiv|stagger|container|item/i.test(source)
  if (!hasMotionPattern) {
    issues.push({
      id: 'hero-missing-motion-profile',
      dimension: 'design',
      severity: 'warning',
      section: 'hero',
      message: 'Staggered reveal hero motion was requested, but the source does not show the expected motion pattern.',
      fix: 'RETRY_CODING_AGENT:ADD_MOTION_PATTERN',
    })
  }
  return issues
}

function checkResponsiveHero(source: string, spec?: Partial<HeroDesignSpec>): CriticIssue[] {
  const issues: CriticIssue[] = []
  if (!spec) return issues
  const shouldCheck = (spec.archetype === 'centered-stacked' || spec.archetype === 'editorial-commerce') &&
    (spec.imageTreatment === 'framed-panel' || spec.imageTreatment === 'scrim-gradient')
  if (!shouldCheck) return issues
  if (!isResponsiveHeroPattern(source)) {
    issues.push({
      id: 'hero-no-responsive-rule',
      dimension: 'design',
      severity: 'warning',
      section: 'hero',
      message: 'Hero layout lacks a mobile responsive breakpoint for stacked framing or scrim treatment.',
      fix: 'ADD_HERO_MOBILE_BREAKPOINT',
    })
  }
  return issues
}

function checkResponsiveNav(source: string): CriticIssue[] {
  const issues: CriticIssue[] = []
  if (!source) return issues
  if (!isResponsiveNavPattern(source)) {
    issues.push({
      id: 'nav-no-responsive-pattern',
      dimension: 'design',
      severity: 'warning',
      section: 'nav',
      message: 'Navigation lacks the responsive hamburger/desktop-category pattern required for mobile and desktop layouts.',
      fix: 'ADD_NAV_RESPONSIVE_PATTERN',
    })
  }
  return issues
}

function checkProductGrid(sections: Section[], blueprint: CanonicalStore): CriticIssue[] {
  const issues: CriticIssue[] = []
  const grid = getSection<{ type: string; sectionLabel?: string; columns?: number; style?: string }>(sections, 'product-grid')

  if (!grid) {
    issues.push({
      id: 'product-grid-missing',
      dimension: 'business',
      severity: 'critical',
      message: 'No product grid. Merchants cannot sell without a catalog.',
      fix: 'INSERT_PRODUCT_GRID',
    })
    return issues
  }

  // Detect generic section label
  const label = grid.sectionLabel ?? ''
  if (!label || label.toLowerCase() === 'products' || label.toLowerCase() === 'the collection') {
    const primaryCategory = blueprint.productCategories?.[0]
    const betterLabel = primaryCategory
      ? `${primaryCategory} collection`
      : `${blueprint.businessName} collection`
    issues.push({
      id: 'product-grid-generic-label',
      dimension: 'content',
      severity: 'suggestion',
      section: 'product-grid',
      message: `Section label "${label}" is generic.`,
      fix: `SET_PRODUCT_GRID_LABEL:${betterLabel}`,
    })
  }

  return issues
}

function checkTrustSignals(sections: Section[], blueprint: CanonicalStore): CriticIssue[] {
  const issues: CriticIssue[] = []

  if (!hasSection(sections, 'trust-bar')) {
    issues.push({
      id: 'trust-bar-missing',
      dimension: 'business',
      severity: 'warning',
      message: 'No trust bar. Conversion research shows trust signals improve checkout rate significantly.',
      fix: 'INSERT_TRUST_BAR',
    })
  } else {
    const tb = getSection<{ type: string; items?: string[] }>(sections, 'trust-bar')
    const items = tb?.items ?? []
    const rawFeatures = (blueprint.storeFeatures ?? []).map(f => f.toLowerCase().trim())
    const itemsMatchRawFeatures = items.length > 0 && items.every(item =>
      rawFeatures.includes(item.toLowerCase().trim())
    )

    const WEAK_ITEMS = ['secure checkout', 'fast delivery', 'easy returns', 'local support']
    const allGeneric = items.length > 0 && items.every(item =>
      WEAK_ITEMS.some(w => item.toLowerCase().includes(w))
    )

    if ((itemsMatchRawFeatures || allGeneric) && items.length > 0) {
      issues.push({
        id: 'trust-bar-generic',
        dimension: 'content',
        severity: 'suggestion',
        section: 'trust-bar',
        message: itemsMatchRawFeatures
          ? 'Trust bar items are the raw storeFeatures array, unedited for the storefront.'
          : 'Trust bar items are all generic defaults. Industry-specific signals convert better.',
        fix: 'IMPROVE_TRUST_BAR_ITEMS',
      })
    }
  }

  return issues
}

function checkSocialProof(sections: Section[]): CriticIssue[] {
  const issues: CriticIssue[] = []

  if (!hasSection(sections, 'social-proof')) {
    issues.push({
      id: 'social-proof-missing',
      dimension: 'business',
      severity: 'warning',
      message: 'No social proof. Reviews are among the highest-converting elements on e-commerce pages.',
      fix: 'INSERT_SOCIAL_PROOF:marquee',
    })
  }

  return issues
}

function checkSectionOrder(sections: Section[]): CriticIssue[] {
  const issues: CriticIssue[] = []
  const heroTypes  = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
  const heroIdx    = sections.findIndex(s => heroTypes.includes(s.type))
  const gridIdx    = sections.findIndex(s => s.type === 'product-grid')
  const trustIdx   = sections.findIndex(s => s.type === 'trust-bar')
  const nlIdx      = sections.findIndex(s => s.type === 'newsletter')

  // Hero must be first (or second after announcement bar)
  if (heroIdx > 1) {
    issues.push({
      id: 'hero-not-first',
      dimension: 'design',
      severity: 'critical',
      section: 'hero',
      message: `Hero is at position ${heroIdx + 1}. It must be the first visible section.`,
      fix: 'MOVE_HERO_TO_TOP',
    })
  }

  // Newsletter should be near the bottom
  if (nlIdx !== -1 && gridIdx !== -1 && nlIdx < gridIdx) {
    issues.push({
      id: 'newsletter-before-products',
      dimension: 'design',
      severity: 'warning',
      section: 'newsletter',
      message: 'Newsletter appears before the product grid. Merchants miss the sell-first principle.',
      fix: 'MOVE_NEWSLETTER_TO_BOTTOM',
    })
  }

  // Trust bar should be near the top, before the grid
  if (trustIdx !== -1 && gridIdx !== -1 && trustIdx > gridIdx) {
    issues.push({
      id: 'trust-after-products',
      dimension: 'design',
      severity: 'warning',
      section: 'trust-bar',
      message: 'Trust bar appears after the product grid. Trust signals should precede purchase decisions.',
      fix: 'MOVE_TRUST_BAR_BEFORE_GRID',
    })
  }

  return issues
}

function checkSectionCount(sections: Section[]): CriticIssue[] {
  const issues: CriticIssue[] = []

  if (sections.length < 3) {
    issues.push({
      id: 'too-few-sections',
      dimension: 'design',
      severity: 'critical',
      message: `Only ${sections.length} sections. A minimum of 4 creates enough page depth to feel like a real store.`,
      fix: 'ADD_MINIMUM_SECTIONS',
    })
  }

  if (sections.length > 10) {
    issues.push({
      id: 'too-many-sections',
      dimension: 'design',
      severity: 'suggestion',
      message: `${sections.length} sections. Over 10 sections can overwhelm. Consider consolidating.`,
      fix: 'TRIM_EXCESS_SECTIONS',
    })
  }

  return issues
}

function checkBrandStory(sections: Section[]): CriticIssue[] {
  const issues: CriticIssue[] = []
  const story = getSection<{ type: string; body?: string; headline?: string }>(sections, 'brand-story')

  if (story) {
    const body = story.body ?? ''
    // Detect the generic fallback body copy
    if (body.includes('We believe in quality, craft, and honesty') || body.length < 60) {
      issues.push({
        id: 'brand-story-generic',
        dimension: 'content',
        severity: 'warning',
        section: 'brand-story',
        message: 'Brand story body is generic fallback copy. Should be industry-specific.',
        fix: 'IMPROVE_BRAND_STORY_BODY',
      })
    }
  }

  return issues
}

function checkPalette(palette: Record<string, string>): CriticIssue[] {
  const issues: CriticIssue[] = []

  // Check contrast: accent on accentSoft should be legible
  // Simple check: if bg and surface are identical, sections won't alternate
  if (palette.bg === palette.surface) {
    issues.push({
      id: 'palette-no-surface-contrast',
      dimension: 'design',
      severity: 'suggestion',
      message: 'Background and surface colors are identical. Section alternation will not be visible.',
      fix: 'ADJUST_SURFACE_COLOR',
    })
  }

  // Check accentSoft exists
  if (!palette.accentSoft || palette.accentSoft === palette.bg) {
    issues.push({
      id: 'palette-missing-accent-soft',
      dimension: 'design',
      severity: 'suggestion',
      message: 'accentSoft is missing or identical to bg. Featured sections will not stand out.',
      fix: 'DERIVE_ACCENT_SOFT',
    })
  }

  return issues
}

function checkTypography(typography: { headingFont: string; bodyFont: string }): CriticIssue[] {
  const issues: CriticIssue[] = []

  if (!VALID_FONTS.includes(typography.headingFont)) {
    issues.push({
      id: 'invalid-heading-font',
      dimension: 'design',
      severity: 'warning',
      message: `Heading font "${typography.headingFont}" may not load from Google Fonts.`,
      fix: 'RESET_HEADING_FONT:Playfair Display',
    })
  }

  if (typography.headingFont === typography.bodyFont) {
    issues.push({
      id: 'same-heading-body-font',
      dimension: 'design',
      severity: 'suggestion',
      message: 'Heading and body use the same font. A display/body pairing creates better hierarchy.',
      fix: 'DIFFERENTIATE_BODY_FONT',
    })
  }

  return issues
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function scoreIssues(issues: CriticIssue[]): number {
  const PENALTY: Record<CriticSeverity, number> = {
    critical:   25,
    warning:    8,
    suggestion: 2,
  }
  const totalPenalty = issues.reduce((sum, issue) => sum + PENALTY[issue.severity], 0)
  return Math.max(0, 100 - totalPenalty)
}

// ── Main export ───────────────────────────────────────────────────────────────
export interface ManifestForCritic {
  sections: Array<{ type: string; [key: string]: unknown }>
  palette:  Record<string, string>
  typography: { headingFont: string; bodyFont: string }
  heroSpec?: Partial<HeroDesignSpec>
  heroSource?: string
  navSource?: string
}

export interface CriticRunOptions {
  expectHero?: boolean
}

export function runCritic(
  manifest: ManifestForCritic,
  blueprint: CanonicalStore,
  options: CriticRunOptions = {},
): CriticReport {
  const { sections, palette, typography } = manifest
  const expectHero = options.expectHero ?? true

  const issues: CriticIssue[] = [
    ...(expectHero ? checkHero(sections, blueprint) : []),
    ...checkHeroLayering(manifest.heroSource ?? '', manifest.heroSpec),
    ...checkHeroMotionProfile(manifest.heroSource ?? '', manifest.heroSpec),
    ...checkResponsiveHero(manifest.heroSource ?? '', manifest.heroSpec),
    ...checkResponsiveNav(manifest.navSource ?? ''),
    ...checkProductGrid(sections, blueprint),
    ...checkTrustSignals(sections, blueprint),
    ...checkSocialProof(sections),
    ...checkSectionOrder(sections),
    ...checkSectionCount(sections),
    ...checkBrandStory(sections),
    ...checkPalette(palette),
    ...checkTypography(typography),
  ]

  const score        = scoreIssues(issues)
  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const warningCount  = issues.filter(i => i.severity === 'warning').length

  return {
    score,
    issues,
    passed: score >= PASS_THRESHOLD && criticalCount === 0,
    criticalCount,
    warningCount,
  }
}

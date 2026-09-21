//seltra-web/backend/src/ai/agents/refinement.engine.ts

// Seltra Refinement Engine — applies deterministic fixes for critic issues.
// Runs the critic → fixes → re-runs critic. Max 2 iterations.
// Zero LLM tokens for structural fixes; optional LLM for copy enrichment.

import { runCritic, type ManifestForCritic, type CriticIssue, type CriticReport } from './critic.agent'
import type { CanonicalStore } from '../../types'

const MAX_ITERATIONS = 3

export interface RefinementResult {
  manifest:     ManifestForCritic
  initialReport: CriticReport
  finalReport:  CriticReport
  iterations:   number
  fixesApplied: string[]
}

export interface RefinementOptions {
  expectHero?: boolean
}

// ── Fix implementations ───────────────────────────────────────────────────────

type Section = { type: string; [key: string]: unknown }

function applyFix(
  manifest: ManifestForCritic,
  issue: CriticIssue,
  blueprint: CanonicalStore,
): ManifestForCritic {
  const sections = [...manifest.sections] as Section[]
  const [fixType, ...fixArgs] = issue.fix.split(':')

  switch (fixType) {

    case 'INSERT_HERO': {
      const heroType = fixArgs[0] ?? 'hero-centered'
      const displayName = blueprint.brandName?.trim() || blueprint.businessName.split(' ').slice(0, 2).join(' ')
      sections.unshift({
        type: heroType,
        headline: displayName,
        tagline: `${blueprint.businessType ? `The best of ${blueprint.businessType}` : 'Shop the collection'}.`,
        subtext: blueprint.targetAudience
          ? `Designed for ${blueprint.targetAudience}.`
          : 'Discover our collection.',
        eyebrow: blueprint.businessType ?? '',
      })
      return { ...manifest, sections }
    }

    case 'DEDUPLICATE_HERO': {
      const heroTypes = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
      let found = false
      const deduped = sections.filter(s => {
        if (!heroTypes.includes(s.type)) return true
        if (!found) { found = true; return true }
        return false
      })
      return { ...manifest, sections: deduped }
    }

    case 'SHORTEN_HERO_HEADLINE': {
      // Use brandName if available, otherwise take first 2 words of businessName
      const shortName = blueprint.brandName?.trim() || blueprint.businessName.split(' ').slice(0, 2).join(' ')
      const updated = sections.map(s => {
        const heroTypes = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
        if (!heroTypes.includes(s.type)) return s
        return { ...s, headline: shortName }
      })
      return { ...manifest, sections: updated }
    }

    case 'IMPROVE_HERO_TAGLINE': {
      const [businessType, targetAudience] = fixArgs
      const taglines: Record<string, string> = {
        'food':       `Fresh from our kitchen to yours.`,
        'beauty':     `Clean beauty, real results.`,
        'skincare':   `Science-backed skincare that works.`,
        'streetwear': `Limited drops. Zero restocks.`,
        'fashion':    `Wear what moves you.`,
        'jewelry':    `Crafted to be worn forever.`,
        'wellness':   `Feel better, every day.`,
        'electronics': `Tech that keeps up with you.`,
      }
      const corpus = [businessType ?? '', targetAudience ?? ''].join(' ').toLowerCase()
      const match  = Object.keys(taglines).find(k => corpus.includes(k))
      const newTagline = match
        ? taglines[match]
        : targetAudience
          ? `Built for ${targetAudience}.`
          : `The collection you've been waiting for.`

      const updated = sections.map(s => {
        const heroTypes = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
        if (!heroTypes.includes(s.type)) return s
        return { ...s, tagline: newTagline }
      })
      return { ...manifest, sections: updated }
    }

    case 'INSERT_PRODUCT_GRID': {
      const primaryCategory = blueprint.productCategories?.[0]
      const label = primaryCategory
        ? `${primaryCategory} collection`
        : `${blueprint.businessName} collection`

      // Insert before newsletter or social-proof if present, else append
      const insertBefore = ['newsletter', 'social-proof']
      const insertIdx    = sections.findIndex(s => insertBefore.includes(s.type))
      const grid: Section = { type: 'product-grid', columns: 3, style: 'uniform', showCategory: true, sectionLabel: label, limit: 9 }
      if (insertIdx === -1) sections.push(grid)
      else sections.splice(insertIdx, 0, grid)
      return { ...manifest, sections }
    }

    case 'SET_PRODUCT_GRID_LABEL': {
      const newLabel = fixArgs.join(':')
      const updated = sections.map(s =>
        s.type === 'product-grid' ? { ...s, sectionLabel: newLabel } : s
      )
      return { ...manifest, sections: updated }
    }

    case 'INSERT_TRUST_BAR': {
      const items = (blueprint.storeFeatures ?? []).slice(0, 4).length > 0
        ? (blueprint.storeFeatures ?? []).slice(0, 4)
        : ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support']

      // Insert after hero
      const heroTypes = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
      const heroIdx   = sections.findIndex(s => heroTypes.includes(s.type))
      const tb: Section = { type: 'trust-bar', items }
      if (heroIdx === -1) sections.unshift(tb)
      else sections.splice(heroIdx + 1, 0, tb)
      return { ...manifest, sections }
    }

    case 'IMPROVE_TRUST_BAR_ITEMS': {
      // Derive industry-specific trust items from blueprint
      const corpus = [
        blueprint.businessName,
        blueprint.businessType ?? '',
        ...(blueprint.productCategories ?? []),
      ].join(' ').toLowerCase()

      const trustSets: Record<string, string[]> = {
        food:        ['Fresh daily', 'Same-day delivery', 'No preservatives', 'Local sourcing'],
        skincare:    ['Dermatologist tested', 'No harsh chemicals', 'Small batch', 'Cruelty free'],
        beauty:      ['Clean ingredients', 'Cruelty free', 'Dermatologist tested', 'Vegan formula'],
        jewelry:     ['Certified gold', 'Hallmarked', 'Lifetime warranty', 'Handcrafted'],
        streetwear:  ['Limited drops', 'Ships in 24h', 'Authentic gear', 'Secure checkout'],
        electronics: ['1-year warranty', 'Genuine parts', 'Fast shipping', 'Secure checkout'],
        wellness:    ['Natural formulas', 'Lab certified', 'No GMOs', 'Ethically sourced'],
        artisan:     ['Handcrafted', 'Small batch', 'Natural materials', 'Made to order'],
        fashion:     ['Ethically made', 'Premium materials', 'Easy returns', 'Free shipping'],
      }

      const match = Object.keys(trustSets).find(k => corpus.includes(k))
      const items = match
        ? trustSets[match]
        : ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support']

      const updated = sections.map(s =>
        s.type === 'trust-bar' ? { ...s, items } : s
      )
      return { ...manifest, sections: updated }
    }

    case 'INSERT_SOCIAL_PROOF': {
      const style = fixArgs[0] ?? 'marquee'
      // Insert before newsletter, after product-grid
      const insertBefore = ['newsletter']
      const insertIdx    = sections.findIndex(s => insertBefore.includes(s.type))
      const sp: Section  = { type: 'social-proof', style, headline: 'Loved by customers' }
      if (insertIdx === -1) sections.push(sp)
      else sections.splice(insertIdx, 0, sp)
      return { ...manifest, sections }
    }

    case 'MOVE_HERO_TO_TOP': {
      const heroTypes = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
      const heroIdx   = sections.findIndex(s => heroTypes.includes(s.type))
      if (heroIdx <= 1) return manifest
      const hero = sections.splice(heroIdx, 1)[0]
      // Keep announcement-bar before hero if present
      const hasAnnouncement = sections[0]?.type === 'announcement-bar'
      sections.splice(hasAnnouncement ? 1 : 0, 0, hero)
      return { ...manifest, sections }
    }

    case 'MOVE_NEWSLETTER_TO_BOTTOM': {
      const nlIdx = sections.findIndex(s => s.type === 'newsletter')
      if (nlIdx === -1) return manifest
      const nl = sections.splice(nlIdx, 1)[0]
      sections.push(nl)
      return { ...manifest, sections }
    }

    case 'MOVE_TRUST_BAR_BEFORE_GRID': {
      const trustIdx = sections.findIndex(s => s.type === 'trust-bar')
      const gridIdx  = sections.findIndex(s => s.type === 'product-grid')
      if (trustIdx === -1 || gridIdx === -1 || trustIdx < gridIdx) return manifest
      const tb = sections.splice(trustIdx, 1)[0]
      // Re-find grid index after splice
      const newGridIdx = sections.findIndex(s => s.type === 'product-grid')
      sections.splice(newGridIdx, 0, tb)
      return { ...manifest, sections }
    }

    case 'ADD_MINIMUM_SECTIONS': {
      // Add the minimum viable missing sections
      if (!sections.some(s => s.type === 'trust-bar')) {
        const heroTypes = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
        const heroIdx = sections.findIndex(s => heroTypes.includes(s.type))
        sections.splice(heroIdx + 1, 0, {
          type: 'trust-bar',
          items: ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support'],
        })
      }
      if (!sections.some(s => s.type === 'product-grid')) {
        sections.push({ type: 'product-grid', columns: 3, style: 'uniform', showCategory: true, sectionLabel: 'Products', limit: 9 })
      }
      if (!sections.some(s => s.type === 'social-proof')) {
        sections.push({ type: 'social-proof', style: 'marquee', headline: 'Loved by customers' })
      }
      return { ...manifest, sections }
    }

    case 'TRIM_EXCESS_SECTIONS': {
      // Remove duplicate section types, keeping first occurrence
      const seen = new Set<string>()
      // Types that can legitimately repeat
      const REPEATABLE = new Set(['announcement-bar'])
      const deduped = sections.filter(s => {
        if (REPEATABLE.has(s.type)) return true
        if (seen.has(s.type)) return false
        seen.add(s.type); return true
      })
      return { ...manifest, sections: deduped }
    }

    case 'IMPROVE_BRAND_STORY_BODY': {
      const displayName = blueprint.brandName?.trim() || blueprint.businessName.split(' ').slice(0, 2).join(' ')
      const audience   = blueprint.targetAudience ?? 'people who care about quality'
      const bizType    = blueprint.businessType ?? 'our products'
      const body = `${displayName} was created for ${audience}. Every product reflects our commitment to ${bizType} — built with care, delivered with pride, and designed to make a real difference in your daily life.`

      const updated = sections.map(s =>
        s.type === 'brand-story' ? { ...s, body } : s
      )
      return { ...manifest, sections: updated }
    }

    case 'RESET_HEADING_FONT': {
      const font = fixArgs[0] ?? 'Playfair Display'
      return { ...manifest, typography: { ...manifest.typography, headingFont: font } }
    }

    case 'DIFFERENTIATE_BODY_FONT': {
      // If heading is serif, use sans for body and vice versa
      const heading = manifest.typography.headingFont
      const SERIF_FONTS = ['Playfair Display','Fraunces','Cormorant Garamond','Lora','DM Serif Display','Libre Baskerville']
      const newBodyFont = SERIF_FONTS.includes(heading) ? 'DM Sans' : 'Inter'
      return { ...manifest, typography: { ...manifest.typography, bodyFont: newBodyFont } }
    }

    case 'DERIVE_ACCENT_SOFT': {
      // Derive accentSoft as 12% opacity blend of accent on bg
      // We encode this as a fixed 15% opacity hex approximation
      const accent = manifest.palette.accent ?? '#2563eb'
      const hex    = accent.replace('#', '')
      const r      = parseInt(hex.slice(0, 2), 16)
      const g      = parseInt(hex.slice(2, 4), 16)
      const b      = parseInt(hex.slice(4, 6), 16)
      // Blend with white at 12% opacity
      const blend  = (c: number) => Math.round(c * 0.12 + 255 * 0.88)
        .toString(16).padStart(2, '0')
      const accentSoft = `#${blend(r)}${blend(g)}${blend(b)}`
      return { ...manifest, palette: { ...manifest.palette, accentSoft } }
    }

    case 'ADJUST_SURFACE_COLOR': {
      // Make surface slightly lighter than bg for perceptible alternation
      const bg = manifest.palette.bg
      const newSurface = bg === '#fafafa' ? '#ffffff'
        : bg === '#faf9f7' ? '#ffffff'
        : bg === '#0d0d0d' ? '#141414'
        : '#ffffff'
      return { ...manifest, palette: { ...manifest.palette, surface: newSurface } }
    }

    default:
      return manifest
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function refineManifest(
  manifest: ManifestForCritic,
  blueprint: CanonicalStore,
  options: RefinementOptions = {},
): Promise<RefinementResult> {
  const initialReport = runCritic(manifest, blueprint, options)
  const fixesApplied:  string[] = []
  let   current  = manifest
  let   report   = initialReport
  let   iteration = 0

  // Only iterate if there are issues worth fixing
  while (!report.passed && iteration < MAX_ITERATIONS) {
    iteration++

    // Process issues in severity order: critical first, then warnings, then suggestions
    const orderedIssues = [...report.issues].sort((a, b) => {
      const ORDER = { critical: 0, warning: 1, suggestion: 2 }
      return ORDER[a.severity] - ORDER[b.severity]
    })

    for (const issue of orderedIssues) {
      // Skip suggestions on iteration 2 to avoid over-engineering
      if (iteration === 2 && issue.severity === 'suggestion') continue

      const before = current
      current = applyFix(current, issue, blueprint)
      if (JSON.stringify(current) !== JSON.stringify(before)) {
        fixesApplied.push(`[iter${iteration}] ${issue.id}: ${issue.fix}`)
      }
    }

    // Re-evaluate after fixes
    report = runCritic(current, blueprint, options)
  }

  if (fixesApplied.length > 0) {
    console.log(`[Refinement] ${iteration} iteration(s), ${fixesApplied.length} fixes:`)
    fixesApplied.forEach(f => console.log(`  ${f}`))
    console.log(`[Refinement] Score: ${initialReport.score} → ${report.score}`)
  } else {
    console.log(`[Refinement] Score ${initialReport.score}/100 — no fixes needed`)
  }

  return {
    manifest:      current,
    initialReport,
    finalReport:   report,
    iterations:    iteration,
    fixesApplied,
  }
}
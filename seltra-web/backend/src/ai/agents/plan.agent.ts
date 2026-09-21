//backend/src/ai/agents/plan.agent.ts
// Seltra Plan Agent — derives a merchant-specific build checklist from the
// blueprint + DNA that already exist by this point in the pipeline. Zero LLM
// tokens: this is presentation of data you already computed, not generation.

import type { CanonicalStore } from '../../types'
import type { StoreDNA } from '../../types/store-dna'
import { resolveComposition } from './composition-rules'

export interface PlanItem {
  label: string
  detail: string
}

const HERO_STYLE_LABEL: Record<string, string> = {
  editorial: 'Editorial hero — full-width statement imagery',
  centered: 'Centered hero — bold headline, single focal point',
  split: 'Split hero — story on one side, imagery on the other',
  fullbleed: 'Full-bleed hero — immersive edge-to-edge visual',
  minimal: 'Minimal hero — clean, typography-led opener',
}

export function buildPlan(blueprint: CanonicalStore, dna: StoreDNA, productCount: number): PlanItem[] {
  const composition = resolveComposition(dna.industry)
  const displayName = blueprint.brandName?.trim() || blueprint.businessName
  const items: PlanItem[] = []

  items.push({
    label: `Hero for ${displayName}`,
    detail: HERO_STYLE_LABEL[dna.heroStyle] ?? HERO_STYLE_LABEL.centered,
  })

  items.push({
    label: 'Trust bar',
    detail: `${Math.min(blueprint.storeFeatures?.length || 4, 4)} signals matched to ${dna.industry}`,
  })

  items.push({
    label: 'Product grid',
    detail: `${productCount} products generated`,
  })

  if (composition.includeSections?.includes('featured-drop')) {
    items.push({ label: 'Featured drop', detail: 'Countdown banner + spotlight product' })
  }
  if (composition.includeSections?.includes('faq')) {
    items.push({ label: 'FAQ', detail: 'Delivery, returns, and order questions' })
  }
  if (composition.includeSections?.includes('brand-story') || composition.includeSections?.includes('founder-story')) {
    items.push({ label: 'Brand story', detail: blueprint.brandVoice ? `Voice: ${blueprint.brandVoice}` : 'Default tone' })
  }

  items.push({
    label: 'Checkout',
    detail: (blueprint.recommendedTechStack?.paymentGateways ?? ['Moolre']).join(' · '),
  })

  return items
}
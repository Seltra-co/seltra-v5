//design-system/contracts.ts
export interface HeroSecondaryCardSpec {
  kind: 'pricing-tile' | 'subscribe-offer' | 'frequently-bought' | 'review-snippet' | 'none'
  position: 'overlap-bottom-left' | 'overlap-bottom-right' | 'float-right' | 'float-below'
  fields: Record<string, string>
}

export interface HeroLayerSpec {
  role: 'background' | 'framed-panel' | 'floating-card' | 'cart-preview' | 'progress-indicator'
  position: 'full-bleed' | 'overlap-bottom-right' | 'overlap-bottom-left' | 'float-right' | 'inline'
  zIndex: 1 | 2 | 3 | 4
}

export interface HeroDesignSpec {
  archetype: 'centered-stacked' | 'split-image-right' | 'split-image-left' | 'fullbleed-bottom-text' | 'minimal-typographic' | 'editorial-commerce' | 'product-spotlight-floating' | 'marketplace-grid-hero' | 'lifestyle-scrim-cart'
  dominantElement: 'headline' | 'image' | 'product-grid'
  imageTreatment: 'none' | 'scrim-gradient' | 'framed-panel' | 'fullbleed'
  headline: string
  tagline: string
  layers: HeroLayerSpec[]
  secondaryCard: HeroSecondaryCardSpec
  motionProfile: 'static' | 'staggered-reveal' | 'parallax-safe'
  ctaLabel: string
  secondaryCtaLabel: string | null
  spacingRhythm: 'tight' | 'generous' | 'editorial'
  trustBadges: string[]
  rationale: string
}

export interface NavDesignSpec {
  style: 'flat' | 'mega-dropdown'
  dropdownGroups?: Array<{ label: string; items: string[] }>
}

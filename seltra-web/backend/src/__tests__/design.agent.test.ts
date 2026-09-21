import { normalizeHeroDesignSpec } from '../ai/agents/design.agent'

describe('design.agent normalizeHeroDesignSpec', () => {
  const blueprint = {
    productCategories: ['Shirts', 'Polo', 'Knitted', 'Casual'],
    storeFeatures: [],
    businessType: 'Apparel',
  } as any

  it('falls back when the headline is a direct product category list', () => {
    const parsed = {
      archetype: 'centered-stacked',
      dominantElement: 'image',
      imageTreatment: 'scrim-gradient',
      headline: 'Shirts Polo Knitted Casual',
      tagline: 'Premium looks for every day',
      layers: [],
      secondaryCard: { kind: 'none', position: 'float-below', fields: {} },
      motionProfile: 'staggered-reveal',
      ctaLabel: 'Shop now',
      secondaryCtaLabel: 'Browse all',
      spacingRhythm: 'generous',
      trustBadges: [],
      rationale: 'test',
    } as any

    const result = normalizeHeroDesignSpec(parsed, blueprint, [])

    expect(result.headline).not.toBe('Shirts Polo Knitted Casual')
    expect(result.headline).toBe('Elevated essentials')
  })

  it('falls back when the CTA label is generic', () => {
    const parsed = {
      archetype: 'centered-stacked',
      dominantElement: 'image',
      imageTreatment: 'scrim-gradient',
      headline: 'Distinctive everyday essentials',
      tagline: 'Premium pieces built for modern routines',
      layers: [],
      secondaryCard: { kind: 'none', position: 'float-below', fields: {} },
      motionProfile: 'staggered-reveal',
      ctaLabel: 'Learn More',
      secondaryCtaLabel: 'View collection',
      spacingRhythm: 'generous',
      trustBadges: [],
      rationale: 'test',
    } as any

    const result = normalizeHeroDesignSpec(parsed, blueprint, [])

    expect(result.ctaLabel).not.toBe('Learn More')
    expect(result.ctaLabel).toBe('Shop now')
  })
})

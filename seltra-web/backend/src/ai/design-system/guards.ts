//design-system/guards.ts
export const FAKE_SOCIAL_PROOF = /★|⭐|\brating\b|\breview(s|ed)?\b|\bstars?\b|\btrusted by\b|\bloved by\b|\d\.\d\s*\(\s*\d/i
export const PAYMENT_PROVIDER_MENTION = /\b(moolre|paystack|pay with)\b/i
export const META_SECTION_LABEL = /\b(hero banner|full[-\s]?width hero|featured collections?|newsletter signup|customer reviews?)\b/i
export function isFabricationGuarded(value: string): boolean {
  return !FAKE_SOCIAL_PROOF.test(value) && !META_SECTION_LABEL.test(value)
}

export function isResponsiveHeroPattern(source: string): boolean {
  return /seltra-hero-media/i.test(source)
}

export function isResponsiveNavPattern(source: string): boolean {
  return /seltra-hamburger/i.test(source) && /seltra-desktop-cats/i.test(source)
}

export function isHeroTextOverridable(source: string): boolean {
  // Check if hero uses props.headline, props.tagline, props.ctaLabel pattern
  return /props\.headline\s*\|\|/i.test(source) && /props\.tagline\s*\|\|/i.test(source)
}

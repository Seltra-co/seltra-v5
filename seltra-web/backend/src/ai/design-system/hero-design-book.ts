//seltra-web/backend/src/ai/design-system/hero-design-book.ts
export const SPACING_SCALE = {
  tight: { section: '2rem', stack: '0.75rem', cta: '0.75rem' },
  generous: { section: '4rem', stack: '1.25rem', cta: '1rem' },
  editorial: { section: '6rem', stack: '1.5rem', cta: '1rem' },
} as const

export const MEDIA_TREATMENT = {
  'framed-panel': {
    radius: 'var(--store-radius-media, 1.5rem)',
    shadow: 'var(--store-shadow-hero, 0 24px 60px -20px rgba(0,0,0,0.25))',
    inset: '1.5rem',
    aspectRatio: '4 / 5',
  },
  'scrim-gradient': {
    radius: '0',
    shadow: 'none',
    inset: '0',
    aspectRatio: 'auto',
  },
  fullbleed: {
    radius: '0',
    shadow: 'none',
    inset: '0',
    aspectRatio: 'auto',
  },
  none: { radius: '0', shadow: 'none', inset: '0', aspectRatio: 'auto' },
} as const

export const HERO_TYPE_SCALE = {
  headline: {
    size: 'clamp(2.75rem, 5.5vw, 4.5rem)',
    lineHeight: '1.0',
    letterSpacing: '-0.02em',
    weight: '600',
    maxWidth: '14ch',
  },
  tagline: {
    size: 'clamp(1.05rem, 1.6vw, 1.25rem)',
    lineHeight: '1.5',
    weight: '400',
    maxWidth: '38ch',
    opacity: '0.75',
  },
  brandLabel: {
    size: '0.75rem',
    letterSpacing: '0.12em',
    weight: '600',
    textTransform: 'uppercase',
  },
} as const

export const CTA_CLASSES = {
  primary: 'seltra-hero-cta-primary',
  secondary: 'seltra-hero-cta-secondary',
} as const

export const CONTENT_STACK_ORDER = [
  'brandLabel',
  'headline',
  'tagline',
  'actions',
  'trustBadges',
] as const

export function buildDesignBookPromptBlock(
  spacingRhythm: keyof typeof SPACING_SCALE,
  imageTreatment: keyof typeof MEDIA_TREATMENT,
): string {
  const spacing = SPACING_SCALE[spacingRhythm] ?? SPACING_SCALE.generous
  const media = MEDIA_TREATMENT[imageTreatment] ?? MEDIA_TREATMENT['scrim-gradient']
  return `
HERO DESIGN BOOK — these are exact values, not suggestions. Do not substitute your own numbers.

CONTENT COLUMN VERTICAL RHYTHM (apply as marginBottom via className, never inline style):
- Brand label → 0.75rem gap below
- Headline → 1rem gap below
- Tagline → ${spacing.stack} gap below
- CTA row → ${spacing.stack} gap below
- Trust badges → last element, no gap needed
Section padding (top/bottom of the whole seltra-hero-content block): ${spacing.section}.

TYPOGRAPHY — exact values, do not invent your own font-size:
- Headline (<h1>): font-size ${HERO_TYPE_SCALE.headline.size}, line-height ${HERO_TYPE_SCALE.headline.lineHeight}, letter-spacing ${HERO_TYPE_SCALE.headline.letterSpacing}, font-weight ${HERO_TYPE_SCALE.headline.weight}, max-width ${HERO_TYPE_SCALE.headline.maxWidth}. This must be the single largest text element in the entire hero.
- Tagline (<p>): font-size ${HERO_TYPE_SCALE.tagline.size}, line-height ${HERO_TYPE_SCALE.tagline.lineHeight}, max-width ${HERO_TYPE_SCALE.tagline.maxWidth}, opacity ${HERO_TYPE_SCALE.tagline.opacity}.
- Brand label: font-size ${HERO_TYPE_SCALE.brandLabel.size}, letter-spacing ${HERO_TYPE_SCALE.brandLabel.letterSpacing}, font-weight ${HERO_TYPE_SCALE.brandLabel.weight}, text-transform uppercase.
Apply these via a className on each element (e.g. "seltra-hero-headline"), never as an inline style object — the shared stylesheet already has matching rules for these exact class names, so if you use them, styling is automatic. Do not invent alternate class names for these elements.

CTA BUTTONS — mandatory exact class names, this is non-negotiable:
Primary button className MUST be exactly "${CTA_CLASSES.primary}". Secondary button className MUST be exactly "${CTA_CLASSES.secondary}" (only if a secondary CTA is specified). The shared stylesheet has real button styling (background, padding, border-radius, hover state) ONLY for these two exact class names — any other class name on the button means it renders with zero visual styling, just bare text. Do not add your own descriptive class name instead of or in addition to these.

MEDIA PANEL — if imageTreatment is not "none":
- border-radius: ${media.radius}
- box-shadow: ${media.shadow}
- The media element must sit inset from the outer hero container edge by ${media.inset} on all sides it doesn't touch the viewport edge on (i.e. it should look like a floating panel, not a flush corner-to-corner image) — UNLESS imageTreatment is "fullbleed", in which case it intentionally spans edge-to-edge with zero radius.
- Preferred aspect-ratio for the image/gradient element: ${media.aspectRatio === 'auto' ? 'natural, no forced ratio' : media.aspectRatio}.
Apply radius/shadow/inset via className, never inline style — this is enforced by the existing "no inline position/radius" rule.`
}

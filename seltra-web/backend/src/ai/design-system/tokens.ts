//design-system/tokens.ts
export const STORE_CSS_VARS = [
  '--store-bg',
  '--store-surface',
  '--store-text',
  '--store-muted',
  '--store-accent',
  '--store-accent-text',
  '--store-border',
  '--store-radius-card',
  '--store-radius-full',
  '--store-radius-media',
  '--store-shadow-hero',
] as const

export const STORE_CSS_VAR_CONTRACT = {
  background: '--store-bg',
  surface: '--store-surface',
  text: '--store-text',
  muted: '--store-muted',
  accent: '--store-accent',
  accentText: '--store-accent-text',
  border: '--store-border',
  radiusCard: '--store-radius-card',
  radiusFull: '--store-radius-full',
  radiusMedia: '--store-radius-media',
  shadowHero: '--store-shadow-hero',
} as const

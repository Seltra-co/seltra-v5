//seltra-web/frontend/components/storefront/themes/index.ts
export type ThemeKey = 'luxury' | 'bold-dark' | 'minimal-light' | 'editorial' | 'warm-earth' | 'cool-modern' | 'vibrant'
export type RadiusKey = 'sharp' | 'rounded' | 'pill'
export type ShadowKey = 'none' | 'subtle' | 'elevated' | 'glow'

export interface DesignTokens {
  primaryColor: string; surfaceColor: string; borderColor: string; textColor: string
  mutedColor: string; accentColor: string; accentTextColor: string; accentSoftColor: string
  accentSecondaryColor: string
  headingFont: string; bodyFont: string
  borderRadius: RadiusKey
  spacing: 'compact' | 'comfortable' | 'spacious'
  shadow: ShadowKey
  heroTreatment: 'mesh' | 'gradient-card' | 'solid-editorial'
}

// Modern, smooth radius scale. The old scale topped out at 0.75rem — "barely
// rounded" reads dated next to Lovable/v0-class references. This is the
// single source of truth; StorefrontCanvas derives --store-radius from it
// instead of keeping its own separate hardcoded map (that divergence was the
// actual P0.3 bug).
export const RADIUS_SCALE: Record<RadiusKey, string> = {
  sharp: '0.5rem',
  rounded: '1.25rem',
  pill: '9999px',
}

export const SPACING_SCALE: Record<DesignTokens['spacing'], string> = {
  compact: '3.5rem',
  comfortable: '5rem',
  spacious: '6.5rem',
}

export function shadowFor(tokens: Pick<DesignTokens, 'shadow' | 'accentColor'>): string {
  switch (tokens.shadow) {
    case 'none': return 'none'
    case 'subtle': return '0 2px 14px rgba(15,15,15,0.06)'
    case 'elevated': return '0 16px 48px -12px rgba(15,15,15,0.16), 0 2px 8px rgba(15,15,15,0.05)'
    case 'glow': return `0 20px 60px -16px color-mix(in srgb, ${tokens.accentColor} 45%, transparent), 0 2px 10px rgba(0,0,0,0.12)`
  }
}

export const THEMES: Record<ThemeKey, DesignTokens> = {
  luxury: {
    primaryColor: '#faf8f5', surfaceColor: '#ffffff', borderColor: '#eae3d8', textColor: '#1a1712',
    mutedColor: '#7d7263', accentColor: '#b8863f', accentTextColor: '#ffffff', accentSoftColor: '#f7ecd9',
    accentSecondaryColor: '#2f2a22',
    headingFont: 'Playfair Display', bodyFont: 'DM Sans',
    borderRadius: 'rounded', spacing: 'spacious', shadow: 'elevated', heroTreatment: 'gradient-card',
  },
  'bold-dark': {
    primaryColor: '#0a0a0b', surfaceColor: '#151517', borderColor: '#26262a', textColor: '#f5f5f4',
    mutedColor: '#9a9a9e', accentColor: '#ff4d1c', accentTextColor: '#ffffff', accentSoftColor: '#2a140b',
    accentSecondaryColor: '#ffb020',
    headingFont: 'Bebas Neue', bodyFont: 'Inter',
    borderRadius: 'sharp', spacing: 'compact', shadow: 'glow', heroTreatment: 'mesh',
  },
  'minimal-light': {
    primaryColor: '#fbfbfa', surfaceColor: '#ffffff', borderColor: '#e7e7e5', textColor: '#17181a',
    mutedColor: '#6b6d72', accentColor: '#3b5bfd', accentTextColor: '#ffffff', accentSoftColor: '#ecf0ff',
    accentSecondaryColor: '#00c2b8',
    headingFont: 'Syne', bodyFont: 'Inter',
    borderRadius: 'rounded', spacing: 'comfortable', shadow: 'subtle', heroTreatment: 'gradient-card',
  },
  editorial: {
    primaryColor: '#f9f6f1', surfaceColor: '#ffffff', borderColor: '#e6dccb', textColor: '#211c15',
    mutedColor: '#8a7b64', accentColor: '#c8582c', accentTextColor: '#ffffff', accentSoftColor: '#fbe9de',
    accentSecondaryColor: '#8a5cf6',
    headingFont: 'Fraunces', bodyFont: 'DM Sans',
    borderRadius: 'rounded', spacing: 'spacious', shadow: 'subtle', heroTreatment: 'solid-editorial',
  },
  'warm-earth': {
    primaryColor: '#faf6ef', surfaceColor: '#ffffff', borderColor: '#ecdfc9', textColor: '#2c2214',
    mutedColor: '#8d7554', accentColor: '#d17a3d', accentTextColor: '#ffffff', accentSoftColor: '#f7e6d5',
    accentSecondaryColor: '#4f7a5c',
    headingFont: 'Fraunces', bodyFont: 'DM Sans',
    borderRadius: 'pill', spacing: 'comfortable', shadow: 'subtle', heroTreatment: 'gradient-card',
  },
  'cool-modern': {
    primaryColor: '#f2f5fb', surfaceColor: '#ffffff', borderColor: '#dde4f2', textColor: '#0e1526',
    mutedColor: '#5c6b8a', accentColor: '#3d6bff', accentTextColor: '#ffffff', accentSoftColor: '#e6ecff',
    accentSecondaryColor: '#22d3c5',
    headingFont: 'Inter', bodyFont: 'Inter',
    borderRadius: 'rounded', spacing: 'comfortable', shadow: 'elevated', heroTreatment: 'gradient-card',
  },
  vibrant: {
    primaryColor: '#08080a', surfaceColor: '#121214', borderColor: '#232327', textColor: '#fbfbfb',
    mutedColor: '#98989e', accentColor: '#00e68a', accentTextColor: '#00230f', accentSoftColor: '#0d2b1d',
    accentSecondaryColor: '#7c5cff',
    headingFont: 'Syne', bodyFont: 'Inter',
    borderRadius: 'rounded', spacing: 'compact', shadow: 'glow', heroTreatment: 'mesh',
  },
}

export function getTheme(key: ThemeKey): DesignTokens { return THEMES[key] ?? THEMES['minimal-light'] }

export function tokensToPalette(t: DesignTokens) {
  return {
    bg: t.primaryColor, surface: t.surfaceColor, border: t.borderColor, text: t.textColor,
    muted: t.mutedColor, accent: t.accentColor, accentText: t.accentTextColor, accentSoft: t.accentSoftColor,
  }
}
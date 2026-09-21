//design-system/theme.ts
export interface StorePalette {
  bg: string
  surface: string
  border: string
  text: string
  muted: string
  accent: string
  accentText: string
  accentSoft: string
}

export interface StoreTypography {
  headingFont: string
  bodyFont: string
}

export const THEME_PALETTES: Record<string, StorePalette> = {
  luxury:          { bg: '#faf8f5', surface: '#ffffff', border: '#eae3d8', text: '#1a1712', muted: '#7d7263', accent: '#b8863f', accentText: '#ffffff', accentSoft: '#f7ecd9' },
  'bold-dark':     { bg: '#0a0a0b', surface: '#151517', border: '#26262a', text: '#f5f5f4', muted: '#9a9a9e', accent: '#ff4d1c', accentText: '#ffffff', accentSoft: '#2a140b' },
  'minimal-light': { bg: '#fbfbfa', surface: '#ffffff', border: '#e7e7e5', text: '#17181a', muted: '#6b6d72', accent: '#3b5bfd', accentText: '#ffffff', accentSoft: '#ecf0ff' },
  editorial:       { bg: '#f9f6f1', surface: '#ffffff', border: '#e6dccb', text: '#211c15', muted: '#8a7b64', accent: '#c8582c', accentText: '#ffffff', accentSoft: '#fbe9de' },
  'warm-earth':    { bg: '#faf6ef', surface: '#ffffff', border: '#ecdfc9', text: '#2c2214', muted: '#8d7554', accent: '#d17a3d', accentText: '#ffffff', accentSoft: '#f7e6d5' },
  'cool-modern':   { bg: '#f2f5fb', surface: '#ffffff', border: '#dde4f2', text: '#0e1526', muted: '#5c6b8a', accent: '#3d6bff', accentText: '#ffffff', accentSoft: '#e6ecff' },
  vibrant:         { bg: '#08080a', surface: '#121214', border: '#232327', text: '#fbfbfb', muted: '#98989e', accent: '#00e68a', accentText: '#00230f', accentSoft: '#0d2b1d' },
}

export const THEME_TYPOGRAPHY: Record<string, StoreTypography> = {
  luxury:          { headingFont: 'Playfair Display', bodyFont: 'DM Sans' },
  'bold-dark':     { headingFont: 'Bebas Neue',       bodyFont: 'Inter' },
  'minimal-light': { headingFont: 'Syne',             bodyFont: 'Inter' },
  editorial:       { headingFont: 'Fraunces',         bodyFont: 'DM Sans' },
  'warm-earth':    { headingFont: 'Fraunces',         bodyFont: 'DM Sans' },
  'cool-modern':   { headingFont: 'Inter',            bodyFont: 'Inter' },
  vibrant:         { headingFont: 'Syne',             bodyFont: 'Inter' },
}

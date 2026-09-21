//seltra-web/backend/src/types/store-dna.ts
import type { StorePalette, StoreTypography }  from './storefront-types'

export type Industry =
  | 'beauty'
  | 'fashion'
  | 'food'
  | 'electronics'
  | 'streetwear'
  | 'jewelry'
  | 'wellness'
  | 'general'

export type BrandPersonality =
  | 'luxury'
  | 'bold'
  | 'minimal'
  | 'playful'
  | 'premium'
  | 'artisan'
  | 'modern'

export interface StoreDNA {
  // Derived from merchant prompt
  industry: Industry
  brandPersonality: BrandPersonality
  audience: string
  conversionGoal: 'direct_sales' | 'lead_generation' | 'catalog_browse'

  // Visual system
  visualDensity: 'minimal' | 'balanced' | 'rich'
  colorMood: 'warm' | 'cool' | 'dark' | 'neutral' | 'vibrant'
  animationLevel: 'none' | 'subtle' | 'dynamic'

  // Layout preferences
  heroStyle: 'editorial' | 'centered' | 'split' | 'fullbleed' | 'minimal'
  productDisplay: 'grid' | 'shelf' | 'masonry' | 'featured'

  // Derived tokens — same shape as existing types.ts
  palette: StorePalette
  typography: StoreTypography

  // Visual brief for image generation
  lighting: 'soft-daylight' | 'studio-softbox' | 'moody-dramatic' | 'bright-flatlay'
  cameraStyle: '85mm-editorial' | 'flatlay-overhead' | 'lifestyle-context' | 'macro-detail'
  backgroundStyle: 'warm-neutral' | 'pure-white' | 'dark-studio' | 'textured-surface'
}
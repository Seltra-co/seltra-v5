//seltra-web/frontend/components/storefront/sections/types.ts
export interface StorePalette {
  bg: string; surface: string; border: string; text: string
  muted: string; accent: string; accentText: string; accentSoft: string
}
export interface StoreTypography { headingFont: string; bodyFont: string }
export interface StoreProduct {
  id: string; name: string; description?: string | null
  price: string | number; currency: string; category?: string | null
  images?: Array<{ url: string; isPrimary?: boolean }>
  variants?: Array<{ name: string; value: string }>
}
export type SelectedVariants = Record<string, string>
export interface DeliveryTier {
  id: string
  label: string
  description: string
  priceFrom: number
  currency: string
  areas?: string[]
  etaLabel?: string
}
export interface StoreManifest { sections: ManifestSection[]; palette: StorePalette; typography: StoreTypography }
export type ManifestSection =
  | { type: 'hero-centered';   headline: string; tagline: string; subtext: string; eyebrow?: string; ctaLabel?: string }
  | { type: 'hero-split';      headline: string; tagline: string; subtext: string; eyebrow?: string; ctaLabel?: string }
  | { type: 'hero-editorial';  headline: string; tagline: string; subtext: string; eyebrow?: string; ctaLabel?: string }
  | { type: 'hero-fullbleed';  headline: string; tagline: string; subtext: string; eyebrow?: string; ctaLabel?: string }
  | { type: 'hero-minimal';    headline: string; subtext?: string; eyebrow?: string; ctaLabel?: string }
  | { type: 'announcement-bar';  message: string }
  | { type: 'featured-drop';     badge: string; headline: string; subtext: string; showCountdown?: boolean }
  | { type: 'product-grid';      columns: 2 | 3 | 4; style: string; limit?: number; showCategory?: boolean; sectionLabel?: string }
  | { type: 'product-shelf';     headline: string; subtext?: string; limit?: number }
  | { type: 'brand-story';       headline: string; body: string; stat?: string; statLabel?: string; layout: 'text-left' | 'text-center'; imageUrl?: string }
  | { type: 'category-strip';    headline?: string }
  | { type: 'social-proof';      style: 'marquee' | 'grid' | 'cards'; headline?: string; subtext?: string }
  | { type: 'trust-bar';         items: string[] }
  | { type: 'newsletter';        headline: string; subtext: string; placeholder?: string }
  | { type: 'faq';               headline?: string; items?: Array<{ question: string; answer: string }> }
  | { type: 'countdown-banner';  message?: string }
  | { type: 'before-after';      headline?: string; beforeLabel?: string; afterLabel?: string; variant?: 'split' | 'cards' }
  | { type: 'founder-story';     founderName?: string; story?: string; variant?: 'portrait-left' | 'portrait-right' | 'minimal' }
  | { type: 'ingredients-list';  headline?: string; items?: Array<{ name: string; benefit: string }>; variant?: 'grid' | 'horizontal' }
  | { type: 'lookbook-grid';     headline?: string; images?: Array<{ url: string; caption?: string }>; variant?: 'masonry' | 'editorial' | 'uniform' }
  | { type: 'team-profiles';     headline?: string; members?: Array<{ name: string; role: string; bio?: string; photoUrl?: string }> }

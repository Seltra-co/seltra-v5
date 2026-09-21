//seltra-web/frontend/components/storefront/StorefrontCanvas.tsx
'use client'
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { ShoppingBag } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { AnnouncementBar }    from './sections/AnnouncementBar'
import { HeroSection }        from './sections/HeroSection'
import { TrustBar }           from './sections/TrustBar'
import { CategoryStrip }      from './sections/CategoryStrip'
import { ProductGrid }        from './sections/ProductGrid'
import { ProductShelf }       from './sections/ProductShelf'
import { BrandStory }         from './sections/BrandStory'
import { SocialProof }        from './sections/SocialProof'
import { Newsletter }         from './sections/Newsletter'
import { FeaturedDrop }       from './sections/FeaturedDrop'
import { FAQSection }         from './sections/FAQSection'
import { CountdownBanner }    from './sections/CountdownBanner'
import { BeforeAfter }        from './sections/BeforeAfter'
import { FounderStory }       from './sections/FounderStory'
import { IngredientsList }    from './sections/IngredientsList'
import { LookbookGrid }       from './sections/LookbookGrid'
import { CartDrawer }         from './sections/CartDrawer'
import { ProductDetailModal } from './sections/ProductDetailModal'
import type {
  StoreProduct, StoreManifest, ManifestSection, StorePalette, StoreTypography,
  DeliveryTier, SelectedVariants,
} from './sections/types'
import { THEMES, RADIUS_SCALE, SPACING_SCALE, shadowFor, type ThemeKey } from './themes'


function StyleInjector({ fontParam, themeVars }: { fontParam: string; themeVars: string }) {
  useEffect(() => {
    const id = `seltra-font-${fontParam.slice(0, 40).replace(/[^a-z0-9]/gi, '')}`
    if (!document.getElementById(id)) {
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = `https://fonts.googleapis.com/css2?${fontParam}&display=swap`
      document.head.appendChild(link)
    }
  }, [fontParam])
  return <style suppressHydrationWarning>{`.seltra-storefront{${themeVars}}`}</style>
}

export interface CartItem { key: string; product: StoreProduct; quantity: number; selectedVariants?: SelectedVariants }

export interface StoreData {
  id?: string; name: string; slug: string; businessType?: string; targetAudience?: string
  brandName?: string
  heroTitle?: string; heroSubtitle?: string
  canonical?: {
    brandName?: string; businessName?: string
    storeFeatures?: string[]; productCategories?: string[]; layoutVariant?: string
    recommendedTechStack?: { paymentGateways?: string[] }
    heroImageUrl?: string; storyImageUrl?: string
    logoUrl?: string
    shippingZones?: Array<{ name: string; metadata?: { content?: string } | null }>
    heroSpec?: { imageTreatment?: string }
    heroOverride?: { eyebrow?: string; headline?: string; tagline?: string; subtext?: string; ctaLabel?: string; secondaryCtaLabel?: string }
    navOverride?: { items?: string[]; style?: 'flat' | 'mega-dropdown' }
    ctaOverrides?: Record<string, { color?: string; textColor?: string; label?: string }>
  }
  storeDNA?: { brandPersonality?: string; industry?: string }
  products?: Array<{
    id: string; name: string; description?: string | null
    price: string | number; currency?: string; category?: string | null
    images?: Array<{ url: string; isPrimary?: boolean }>
    variants?: Array<{ name: string; value: string }>
  }>
  manifest?: StoreManifest | null
  heroSource?: string | null
  navSource?: string | null
  storefrontCode?: string | null; storefrontVersion?: number
  fulfillmentMode?: 'delivery' | 'pickup' | 'both' | null
  contactPhone?: string | null
  pickupAddress?: string | null
  pickupInstructions?: string | null
  deliveryDays?: string | null
  deliveryEstimate?: string | null
  deliveryFeeNote?: string | null
  deliveryTiers?: DeliveryTier[] | null
  shippingZones?: Array<{ name: string; metadata?: { content?: string } | null }>
}

function hasVariantChoices(product: StoreProduct): boolean {
  return Boolean(product.variants?.some((variant) => variant.name && variant.value))
}

function stableVariantKey(selectedVariants?: SelectedVariants): string {
  if (!selectedVariants) return ''
  return Object.keys(selectedVariants)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}:${selectedVariants[key]}`)
    .join('|')
}

function cartLineKey(product: StoreProduct, selectedVariants?: SelectedVariants): string {
  const variantKey = stableVariantKey(selectedVariants)
  return variantKey ? `${product.id}::${variantKey}` : product.id
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value))
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return null
  const parsed = Number.parseInt(normalized, 16)
  if (Number.isNaN(parsed)) return null
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) => clampChannel(v).toString(16).padStart(2, '0'))
    .join('')}`
}

function mixHex(hexA: string, hexB: string, weight = 0.5): string {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return hexA
  const w = Math.max(0, Math.min(1, weight))
  const r = Math.round(a.r * (1 - w) + b.r * w)
  const g = Math.round(a.g * (1 - w) + b.g * w)
  const bVal = Math.round(a.b * (1 - w) + b.b * w)
  return rgbToHex(r, g, bVal)
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

function contrastRatio(a: string, b: string): number {
  const lumA = relativeLuminance(a)
  const lumB = relativeLuminance(b)
  const light = Math.max(lumA, lumB)
  const dark = Math.min(lumA, lumB)
  return (light + 0.05) / (dark + 0.05)
}

function ensureReadableContrast(palette: StorePalette, themeKey: string): StorePalette {
  const textOnBg = contrastRatio(palette.text, palette.bg)
  const accentOnBg = contrastRatio(palette.accent, palette.bg)
  const accentTextOnAccent = contrastRatio(palette.accentText, palette.accent)

  const next = { ...palette }
  if (textOnBg < 4.5) {
    next.text = relativeLuminance(next.bg) > 0.5 ? '#111111' : '#f8f8f8'
  }
  if (accentOnBg < 3) {
    next.accent = mixHex(next.accent, relativeLuminance(next.bg) > 0.5 ? '#111111' : '#f8f8f8', 0.2)
  }
  if (accentTextOnAccent < 4.5) {
    next.accentText = relativeLuminance(next.accent) > 0.5 ? '#111111' : '#ffffff'
  }
  if (contrastRatio(next.accent, next.accentSoft) < 2.2) {
    next.accentSoft = mixHex(next.accentSoft, next.bg, 0.28)
  }
  const tokens = THEMES[themeKey as ThemeKey] ?? THEMES['minimal-light']
  next.border = mixHex(next.border, tokens.borderColor, 0.15)
  next.muted = mixHex(next.muted, next.text, 0.24)
  return next
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function resolveStoreTheme(store: StoreData, fallbackThemeKey: string): { palette: StorePalette; typography: StoreTypography } {
  const baseThemeKey = fallbackThemeKey || 'minimal-light'
  const tokens = THEMES[baseThemeKey as ThemeKey] ?? THEMES['minimal-light']
  const seed = hashString([
    store.name,
    store.brandName ?? '',
    store.businessType ?? '',
    store.storeDNA?.industry ?? '',
    store.storeDNA?.brandPersonality ?? '',
    store.targetAudience ?? '',
  ].join('|'))

  const accentShift = 0.04 + (seed % 10) / 80
  const surfaceShift = 0.06 + (seed % 7) / 90
  const fontBias = ['Fraunces', 'Inter', 'Playfair Display', 'Syne', 'DM Sans'][seed % 5]

  const paletteSeed: StorePalette = {
    bg: tokens.primaryColor,
    surface: tokens.surfaceColor,
    border: tokens.borderColor,
    text: tokens.textColor,
    muted: tokens.mutedColor,
    accent: tokens.accentColor,
    accentText: tokens.accentTextColor,
    accentSoft: tokens.accentSoftColor,
  }

  const palette = ensureReadableContrast({
    ...paletteSeed,
    accent: mixHex(tokens.accentColor, store.storeDNA?.brandPersonality === 'luxury' ? '#b8863f' : store.storeDNA?.brandPersonality === 'playful' ? '#f97316' : tokens.accentColor, accentShift),
    accentSoft: mixHex(tokens.accentSoftColor, store.storeDNA?.industry === 'beauty' ? '#fdf4e5' : store.storeDNA?.industry === 'food' ? '#fff4eb' : tokens.accentSoftColor, surfaceShift),
    surface: mixHex(tokens.surfaceColor, store.storeDNA?.industry === 'beauty' ? '#fffdfb' : '#ffffff', 0.08),
    border: mixHex(tokens.borderColor, '#d1d5db', 0.14),
  }, baseThemeKey)

  const typography = {
    headingFont: fontBias,
    bodyFont: tokens.bodyFont,
  }

  return { palette, typography }
}

function buildThemeVars(p: StorePalette, t: StoreTypography, themeKey: string, ctaOverrides?: Record<string, { color?: string; textColor?: string; label?: string }>): string {
  const tokens = THEMES[themeKey as ThemeKey] ?? THEMES['minimal-light']
  const radius = RADIUS_SCALE[tokens.borderRadius]
  const cardRadius = tokens.borderRadius === 'pill' ? '1.5rem' : radius
  const spacing = SPACING_SCALE[tokens.spacing]
  const shadow = shadowFor({ shadow: tokens.shadow, accentColor: p.accent })
  const mediaRadius = '1.5rem'
  const mediaShadow = '0 24px 60px -20px rgba(0,0,0,0.25)'
  const globalCta = ctaOverrides?.global
  const ctaVars = [
    ['hero-primary', ctaOverrides?.hero_primary ?? globalCta],
    ['hero-secondary', ctaOverrides?.hero_secondary ?? globalCta],
    ['add-to-cart', ctaOverrides?.add_to_cart ?? globalCta],
    ['checkout', ctaOverrides?.checkout ?? globalCta],
    ['newsletter', ctaOverrides?.newsletter ?? globalCta],
  ].map(([name, override]) => {
    const cta = override as { color?: string; textColor?: string } | undefined
    return `--store-cta-${name}-bg:${cta?.color ?? p.accent};--store-cta-${name}-text:${cta?.textColor ?? p.accentText};`
  }).join('')
  return `--store-bg:${p.bg};--store-surface:${p.surface};--store-border:${p.border};--store-text:${p.text};--store-muted:${p.muted};--store-accent:${p.accent};--store-accent-text:${p.accentText};--store-accent-soft:${p.accentSoft};--store-accent-secondary:${tokens.accentSecondaryColor};--store-heading-font:'${t.headingFont}';--store-body-font:'${t.bodyFont}';--store-radius:${radius};--store-radius-card:${cardRadius};--store-radius-media:${mediaRadius};--store-section-spacing:${spacing};--store-shadow:${shadow};--store-shadow-hero:${mediaShadow};${ctaVars}`
}

function applyMerchantOverrides(manifest: StoreManifest, store: StoreData): StoreManifest {
  const canonical = store.canonical as Record<string, unknown> | undefined
  const testimonials = canonical?.testimonials as Array<{ text?: string; author?: string }> | undefined
  let sections = manifest.sections.filter((section) => section.type !== 'social-proof' || (Array.isArray(testimonials) && testimonials.length > 0))

  if (!canonical) return { ...manifest, sections }

  const about = canonical.aboutOverride as { headline?: string; body?: string } | undefined
  if (about?.body) {
    sections = sections.map((s) => {
      if (s.type !== 'brand-story') return s
      const existing = s as { headline?: string; body?: string }
      return {
        ...s,
        headline: about.headline ?? existing.headline ?? 'Our story',
        body: about.body ?? existing.body ?? '',
      }
    })
  }

  const faqItems = canonical.faqItems as Array<{ question: string; answer: string }> | undefined
  if (Array.isArray(faqItems) && faqItems.length > 0) {
    const hasFaq = sections.some((s) => s.type === 'faq')
    if (hasFaq) {
      sections = sections.map((s) => (s.type === 'faq' ? { ...s, items: faqItems } : s))
    } else {
      const newsletterIdx = sections.findIndex((s) => s.type === 'newsletter')
      const faqSection = { type: 'faq', headline: 'Questions customers ask', items: faqItems } as ManifestSection
      sections = newsletterIdx === -1
        ? [...sections, faqSection]
        : [...sections.slice(0, newsletterIdx), faqSection, ...sections.slice(newsletterIdx)]
    }
  }

  return { ...manifest, sections }
}

const GENERIC_BUSINESS_TYPE = /^(e-?commerce|online)\s+(store|shop|brand|business)$/i

function humanizedEyebrow(store: StoreData): string {
  const bt = (store.businessType ?? '').trim()
  if (!bt || GENERIC_BUSINESS_TYPE.test(bt)) {
    const industry = store.storeDNA?.industry
    const personality = store.storeDNA?.brandPersonality
    if (industry && personality) return `${personality} ${industry}`.replace(/^\w/, (c) => c.toUpperCase())
    if (industry) return industry.replace(/^\w/, (c) => c.toUpperCase())
    return ''
  }
  return bt
}

function deriveManifest(store: StoreData): StoreManifest {
  const c = [store.name, store.businessType ?? '', store.targetAudience ?? ''].join(' ').toLowerCase()
  const isFood   = /food|restaurant|cafe|snack|drink/.test(c)
  const isBeauty = /beauty|skincare|cosmetic|luxury|jewelry|wellness|serum/.test(c)
  const isBold   = /streetwear|sneaker|sport|gym|gaming|tech|hype/.test(c)
  const palette: StorePalette = isFood
    ? { bg:'#faf7f2',surface:'#ffffff',border:'#e8dfd0',text:'#2d2419',muted:'#8a7560',accent:'#c4622d',accentText:'#ffffff',accentSoft:'#f5ece6' }
    : isBeauty
    ? { bg:'#faf9f7',surface:'#ffffff',border:'#e8e4df',text:'#1a1a1a',muted:'#7a7060',accent:'#b8860b',accentText:'#ffffff',accentSoft:'#fdf5e4' }
    : isBold
    ? { bg:'#0d0d0d',surface:'#141414',border:'#2a2a2a',text:'#f0f0f0',muted:'#888888',accent:'#ff3c00',accentText:'#ffffff',accentSoft:'#1f1008' }
    : { bg:'#fafafa',surface:'#ffffff',border:'#e5e5e5',text:'#1a1a1a',muted:'#717171',accent:'#2563eb',accentText:'#ffffff',accentSoft:'#eff6ff' }
  const typography: StoreTypography = isFood
    ? { headingFont:'Fraunces', bodyFont:'DM Sans' }
    : isBeauty
    ? { headingFont:'Playfair Display', bodyFont:'DM Sans' }
    : isBold
    ? { headingFont:'Bebas Neue', bodyFont:'Inter' }
    : { headingFont:'Syne', bodyFont:'Inter' }
  const displayName = resolveDisplayName(store)
  return {
    sections: [
      { type:'hero-centered', headline:displayName, tagline:store.heroSubtitle??'Shop the collection.', subtext:`For ${store.targetAudience??'your customers'}.`, eyebrow:humanizedEyebrow(store) },
      { type:'trust-bar', items:store.canonical?.storeFeatures?.slice(0,4)??['Secure checkout','Fast delivery','Easy returns','Local support'] },
      { type:'product-grid', columns:3, style:'uniform', showCategory:true, sectionLabel:'Products' },
      { type:'social-proof', style:'marquee' },
      { type:'newsletter', headline:'Stay in the loop', subtext:'Get updates and exclusive offers.' },
    ],
    palette, typography,
  }
}

// Resolve display name: brandName > short businessName
function resolveDisplayName(store: StoreData): string {
  const approvedBrand = store.brandName ?? store.canonical?.brandName
  if (approvedBrand && approvedBrand.trim().split(/\s+/).length <= 4) return approvedBrand.trim()
  const approvedBusiness = store.canonical?.businessName ?? store.name
  const words = approvedBusiness.trim().split(/\s+/)
  if (words.length > 3) return words.slice(0, 2).join(' ')
  return approvedBusiness
}

function normalizeHeroHeadline(headline: string, store: StoreData): string | null {
  const normalized = headline.trim().toLowerCase()
  if (!normalized) return null
  const categories = [
    ...(store.canonical?.productCategories ?? []),
    ...(store.products?.map((p) => p.category).filter(Boolean) as string[]),
  ]
    .map((category) => category.trim().toLowerCase())
    .filter(Boolean)
  if (categories.length === 0) return headline.trim()

  const joinedSpace = categories.join(' ')
  const joinedComma = categories.join(', ')
  if (normalized === joinedSpace || normalized === joinedComma) return null

  const matches = categories.filter((category) => category.length > 2 && normalized.includes(category))
  if (matches.length >= Math.min(2, categories.length)) return null

  return headline.trim()
}

function isGenericHeroTagline(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return /^(the best of|discover our|welcome to|shop the collection|browse our|explore our)/.test(normalized)
}

function isGenericHeroCtaLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return [
    'learn more',
    'browse products',
    'explore collection',
    'view collection',
    'discover more',
    'see more',
    'see what\'s inside',
    'see whats inside',
  ].includes(normalized)
}

type HeroSectionManifest = Extract<ManifestSection, { type: 'hero-centered' | 'hero-split' | 'hero-editorial' | 'hero-fullbleed' | 'hero-minimal' }>

function heroSectionFromSpec(store: StoreData): HeroSectionManifest | null {
  const canonical = store.canonical as Record<string, unknown> | undefined
  const spec = canonical?.heroSpec as {
    archetype?: string
    headline?: string
    tagline?: string
    ctaLabel?: string
  } | undefined
  if (!spec?.headline) return null

  const normalizedHeadline = normalizeHeroHeadline(spec.headline, store)
  const normalizedTagline = spec.tagline && !isGenericHeroTagline(spec.tagline) ? spec.tagline.trim() : null
  const normalizedCtaLabel = spec.ctaLabel && !isGenericHeroCtaLabel(spec.ctaLabel) ? spec.ctaLabel.trim() : null
  if (!normalizedHeadline) return null

  const typeMap: Record<string, ManifestSection['type']> = {
    'centered-stacked': 'hero-centered',
    'split-image-right': 'hero-split',
    'split-image-left': 'hero-split',
    'fullbleed-bottom-text': 'hero-fullbleed',
    'minimal-typographic': 'hero-minimal',
    'editorial-commerce': 'hero-editorial',
    'product-spotlight-floating': 'hero-split',
    'marketplace-grid-hero': 'hero-editorial',
    'lifestyle-scrim-cart': 'hero-editorial',
  }
  return {
    type: typeMap[spec.archetype ?? ''] ?? 'hero-centered',
    headline: normalizedHeadline,
    tagline: normalizedTagline ?? store.heroSubtitle ?? 'Shop the collection.',
    subtext: `For ${store.targetAudience ?? 'your customers'}.`,
    eyebrow: humanizedEyebrow(store),
    ctaLabel: normalizedCtaLabel ?? 'Shop now',
  } as Extract<ManifestSection, { type: 'hero-centered' | 'hero-split' | 'hero-editorial' | 'hero-fullbleed' | 'hero-minimal' }>
}

function resolveHeroSection(store: StoreData, manifest: StoreManifest): HeroSectionManifest {
  const heroSection = manifest.sections.find(isHeroSection) ?? heroSectionFromSpec(store) ?? deriveManifest(store).sections.find(isHeroSection)!
  const heroOverride = (store.canonical as Record<string, unknown> | undefined)?.heroOverride as { eyebrow?: string; headline?: string; tagline?: string; subtext?: string; ctaLabel?: string; secondaryCtaLabel?: string } | undefined
  
  // Apply heroOverride if present
  if (heroOverride) {
    const current = heroSection as HeroSectionManifest & { tagline?: string; ctaLabel?: string }
    return {
      ...current,
      eyebrow: heroOverride.eyebrow ?? current.eyebrow,
      headline: heroOverride.headline ?? current.headline,
      tagline: heroOverride.tagline ?? current.tagline,
      subtext: heroOverride.subtext ?? current.subtext,
      ctaLabel: heroOverride.ctaLabel ?? current.ctaLabel,
      secondaryCtaLabel: heroOverride.secondaryCtaLabel ?? (current as { secondaryCtaLabel?: string }).secondaryCtaLabel,
    } as unknown as HeroSectionManifest
  }
  
  return heroSection as HeroSectionManifest
}

const SectionFade = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, y: 24 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-60px' }}
    transition={{ duration: 0.5, delay: 0.04, ease: [0.4, 0, 0.2, 1] }}
  >
    {children}
  </motion.div>
)

function renderSection(
  section: ManifestSection,
  i: number,
  props: {
    products: StoreProduct[]
    features: string[]
    categories: string[]
    activeCategory: string
    onCategoryChange: (category: string) => void
    onAddToCart: (p: StoreProduct, selectedVariants?: SelectedVariants) => void
    storeName: string
    onViewDetail?: (p: StoreProduct) => void
    industry?: string
    storyImageUrl?: string
    testimonials?: Array<{ text: string; author: string }>
    addToCartLabel?: string
    newsletterLabel?: string
    shippingZones?: Array<{ name: string; metadata?: { content?: string } | null }>
  },
) {
  const W = ({ children }: { children: React.ReactNode }) => <SectionFade>{children}</SectionFade>
  const {
    products,
    features,
    categories,
    activeCategory,
    onCategoryChange,
    onAddToCart,
    storeName,
    onViewDetail,
    industry,
    storyImageUrl,
    testimonials,
    addToCartLabel,
    newsletterLabel,
    shippingZones,
  } = props

  switch (section.type) {
    case 'announcement-bar': return <AnnouncementBar key={i} message={section.message} />
    case 'countdown-banner': return <W key={i}><CountdownBanner message={(section as { message?: string }).message} /></W>
    case 'hero-centered': case 'hero-split': case 'hero-editorial': case 'hero-fullbleed': case 'hero-minimal':
      return <HeroSection key={i} section={section} products={products} features={features} storeName={storeName} />
    case 'trust-bar':
      return <W key={i}><TrustBar items={section.items} industry={industry} /></W>
    case 'category-strip':
      return <W key={i}><CategoryStrip categories={categories} activeCategory={activeCategory} onCategoryChange={onCategoryChange} headline={section.headline} /></W>
    case 'featured-drop':
      return <W key={i}><FeaturedDrop section={section} products={products} onAddToCart={onAddToCart} onViewDetail={onViewDetail} addToCartLabel={addToCartLabel} /></W>
    case 'product-grid':
      return <W key={i}><ProductGrid section={section} products={products} categories={categories} activeCategory={activeCategory} onCategoryChange={onCategoryChange} onAddToCart={onAddToCart} onViewDetail={onViewDetail} addToCartLabel={addToCartLabel} /></W>
    case 'product-shelf':
      return <W key={i}><ProductShelf section={section} products={products} onAddToCart={onAddToCart} storeName={storeName} onViewDetail={onViewDetail} addToCartLabel={addToCartLabel} /></W>
   case 'brand-story':
    return (
        <W key={i}>
            <BrandStory
                {...section}
              imageUrl={section.imageUrl ?? storyImageUrl}
            />
        </W>
    )
  case 'social-proof':
      return <W key={i}><SocialProof style={section.style} headline={section.headline} subtext={section.subtext} reviews={testimonials} /></W>
    case 'newsletter':
      return <W key={i}><Newsletter headline={section.headline} subtext={section.subtext} placeholder={section.placeholder} buttonLabel={newsletterLabel} /></W>
    case 'faq':
      return <W key={i}><FAQSection items={(section as { items?: Array<{ question: string; answer: string }> }).items?.map((item) => {
        const zone = /return|refund/i.test(item.question) ? 'Returns' : /deliver|ship/i.test(item.question) ? 'Shipping' : null
        const live = zone && shippingZones?.find((candidate) => candidate.name.toLowerCase() === zone.toLowerCase())?.metadata?.content
        return live ? { ...item, answer: live } : item
      })} headline={(section as { headline?: string }).headline} /></W>
    case 'before-after':
      return <W key={i}><BeforeAfter headline={(section as { headline?: string }).headline} beforeLabel={(section as { beforeLabel?: string }).beforeLabel} afterLabel={(section as { afterLabel?: string }).afterLabel} /></W>
    case 'founder-story':
      return <W key={i}><FounderStory founderName={(section as { founderName?: string }).founderName} story={(section as { story?: string }).story} storeName={storeName} /></W>
    case 'ingredients-list':
      return <W key={i}><IngredientsList headline={(section as { headline?: string }).headline} items={(section as { items?: Array<{ name: string; benefit: string }> }).items} /></W>
    case 'lookbook-grid':
      return <W key={i}><LookbookGrid headline={(section as { headline?: string }).headline} images={(section as { images?: Array<{ url: string; caption?: string }> }).images} products={products} onAddToCart={onAddToCart} /></W>
    default: return null
  }
}

interface CanvasProps { store: StoreData; storeSlug: string; minHeightClass?: string; themeKey?: string }

export function StorefrontCanvas({ store, storeSlug, minHeightClass = 'min-h-[560px]', themeKey = 'minimal-light' }: CanvasProps) {
  const manifest = applyMerchantOverrides(store.manifest ?? deriveManifest(store), store)
  const testimonials = (store.canonical as Record<string, unknown> | undefined)?.testimonials as
    | Array<{ text: string; author: string }>
    | undefined
  const displayName = resolveDisplayName(store)
  const industry = store.storeDNA?.industry
  const base = resolveStoreTheme(store, themeKey)
  const mergedPalette = { ...base.palette, ...(store.manifest?.palette ?? {}) }
  const palette = ensureReadableContrast(mergedPalette, themeKey)
  const typography = { ...base.typography, ...(store.manifest?.typography ?? {}) }

  const products: StoreProduct[] = (store.products ?? []).map((p) => ({
    id: p.id ?? '', name: p.name ?? '', description: p.description,
    price: p.price, currency: p.currency ?? 'GHS', category: p.category,
    images: p.images as Array<{ url: string; isPrimary?: boolean }>,
    variants: p.variants as Array<{ name: string; value: string }>,
  }))

  const heroImageUrlCandidate = store.canonical?.heroImageUrl as string | undefined
  const heroSection = resolveHeroSection(store, manifest)
  const canUseProductHeroImages = heroSection.type === 'hero-split' || heroSection.type === 'hero-editorial'
  const heroImageUrlsCandidate = heroImageUrlCandidate
    ? [heroImageUrlCandidate]
    : canUseProductHeroImages
      ? products.flatMap((product) => product.images?.map((image) => image.url).filter(Boolean) ?? []).slice(0, 5) as string[]
      : []
  const storyImageUrl = store.canonical?.storyImageUrl as string | undefined
  const bodySections = manifest.sections.filter((section) => !isHeroSection(section))
  const ctaOverrides = store.canonical?.ctaOverrides
  const showDebugBadge = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1'

  const features   = store.canonical?.storeFeatures ?? []
  const productCategories = [...new Set((products.map((p) => p.category).filter(Boolean) as string[]))]
  const categories = store.canonical?.navOverride?.items?.length
    ? store.canonical.navOverride.items
    : [...new Set([...(store.canonical?.productCategories ?? []), ...productCategories])]
  const currency   = products[0]?.currency ?? 'GHS'
  const CART_KEY   = `seltra:cart:${storeSlug}`

 const [cart, setCart] = useState<CartItem[]>([])

  // Rehydrate cart from localStorage after mount only (avoids SSR mismatch)
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(CART_KEY)
      if (s) {
        const parsed = JSON.parse(s) as Array<Partial<CartItem> & { product: StoreProduct; quantity: number }>
        setCart(parsed.map((item) => ({
          key: item.key ?? cartLineKey(item.product, item.selectedVariants),
          product: item.product,
          quantity: item.quantity,
          selectedVariants: item.selectedVariants,
        })))
      }
    } catch {}
  }, [CART_KEY])
  const [cartOpen, setCartOpen]           = useState(false)
  const [detailProduct, setDetailProduct] = useState<StoreProduct | null>(null)
  const [mounted, setMounted]             = useState(false)
  const [heroRenderMode, setHeroRenderMode] = useState<'ai' | 'fallback' | 'unknown'>('unknown')
  const [navRenderMode, setNavRenderMode] = useState<'ai' | 'fallback' | 'unknown'>('unknown')
  // Mobile nav drawer state now lives here, in the parent, so it works
  // consistently whether the rendered nav is the AI-generated StorefrontNav
  // (via MicroComponentRenderer) or the DefaultNav fallback.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(cart)) } catch {}
  }, [cart, CART_KEY])

  const addToCart = useCallback((product: StoreProduct, selectedVariants?: SelectedVariants) => {
    if (hasVariantChoices(product) && !selectedVariants) {
      setDetailProduct(product)
      toast.message('Select options to add to cart', { duration: 1600 })
      return
    }
    const key = cartLineKey(product, selectedVariants)
    setCart((prev) => {
      const ex = prev.find((i) => i.key === key)
      if (ex) return prev.map((i) => i.key === key ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { key, product, quantity: 1, selectedVariants }]
    })
    toast.success(`${product.name} added`, { duration: 1400 })
    setCartOpen(true)
  }, [])

  const updateQty = useCallback((key: string, delta: number) => {
    setCart((prev) => prev.map((i) => i.key === key ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i).filter((i) => i.quantity > 0))
  }, [])

  // Smooth scroll to a section by its data-section attribute
  const scrollToSection = useCallback((sectionType: string) => {
    const el = document.querySelector(`[data-section="${sectionType}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)
  const fonts     = [...new Set([typography.headingFont, typography.bodyFont])]
  const fontParam = fonts.map((f) => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700;800;900`).join('&')
  const [activeCategory, setActiveCategory] = useState('All')

  const sectionProps = {
    products, features, categories,
    activeCategory,
    onCategoryChange: setActiveCategory,
    onAddToCart: addToCart,
    addToCartLabel: ctaOverrides?.add_to_cart?.label,
    newsletterLabel: ctaOverrides?.newsletter?.label,
    storeName: displayName,
    onViewDetail: (p: StoreProduct) => setDetailProduct(p),
    industry,
    storyImageUrl,
    testimonials,
    shippingZones: store.shippingZones,
  }

  const handleCategoryClick = useCallback((category: string) => {
    setMobileMenuOpen(false)
    setActiveCategory(category)
    scrollToSection('product-grid')
  }, [scrollToSection])

  const heroOverride = (store.canonical as Record<string, unknown> | undefined)?.heroOverride as { eyebrow?: string; headline?: string; tagline?: string; subtext?: string; ctaLabel?: string; secondaryCtaLabel?: string } | undefined
  const heroFallback = (
  <HeroSection
    section={{ ...heroSection, ctaLabel: ctaOverrides?.hero_primary?.label ?? heroSection.ctaLabel }}
    products={products}
    features={features}
    storeName={displayName}
    heroImageUrl={heroImageUrlCandidate}
    heroImageUrls={heroImageUrlsCandidate}
    onShopNow={() => scrollToSection('product-grid')}
    onOpenCart={() => setCartOpen(true)}
  />
)
  const heroProps = {
    store: {
      id: store.id,
      name: heroSection.headline,
      displayName,
      businessType: humanizedEyebrow(store),
      targetAudience: store.targetAudience,
      brandName: store.brandName ?? store.canonical?.brandName,
    },
    products,
    features,
    onShopNow: () => scrollToSection('product-grid'),
    onOpenCart: () => setCartOpen(true),
    headline: heroSection.headline,
    tagline: (heroSection as { tagline?: string }).tagline,
    eyebrow: heroSection.eyebrow,
    subtext: heroSection.subtext,
    primaryCtaLabel: heroSection.ctaLabel,
    secondaryCtaLabel: (heroSection as { secondaryCtaLabel?: string }).secondaryCtaLabel,
    ctaLabel: heroSection.ctaLabel,
    heroOverride: heroOverride || ctaOverrides?.hero_primary?.label ? {
      headline: heroOverride?.headline,
      tagline: heroOverride?.tagline,
      ctaLabel: ctaOverrides?.hero_primary?.label ?? heroOverride?.ctaLabel,
    } : undefined,
  }
  const navProps = {
    displayName,
    logoUrl: store.canonical?.logoUrl ?? null,
    businessType: humanizedEyebrow(store),
    categories,
    cartCount: cartCount > 0 ? cartCount : '',
    CartIcon: SafeCartIcon,
    onOpenCart: () => setCartOpen(true),
    onCategoryClick: handleCategoryClick,
    onLogoClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    onToggleMenu: () => setMobileMenuOpen((v) => !v),
    menuOpen: mobileMenuOpen,
  }

  return (
    <div className={`seltra-storefront relative w-full overflow-x-hidden ${minHeightClass}`}>
      <StyleInjector fontParam={fontParam} themeVars={buildThemeVars(palette, typography, themeKey, ctaOverrides)} />
      {showDebugBadge && (
        <div className="pointer-events-none fixed right-4 top-16 z-50 rounded-full border border-[rgba(0,0,0,0.08)] bg-white/90 px-3 py-1 text-[0.7rem] font-medium text-slate-700 shadow-lg shadow-slate-200/70">
              Hero: {heroRenderMode === 'ai' ? 'AI' : 'Fallback'}
          {' · '}
          Nav: {navRenderMode === 'ai' ? 'AI' : 'Fallback'}
        </div>
      )}

      {/* Nav shell — owns the mobile drawer so it renders identically
         regardless of whether the AI-generated StorefrontNav or the
         DefaultNav fallback is what actually rendered above it. */}
      <div className="sticky top-0 z-30">
        <MicroComponentRenderer
          source={store.navSource}
          componentName="StorefrontNav"
          props={navProps}
          fallback={null}
          onStatusChange={(status) => setNavRenderMode(status)}
        />
        <AnimatePresence>
          {mobileMenuOpen && categories.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden border-b md:hidden"
              style={{ borderColor: 'var(--store-border)', background: 'var(--store-bg)' }}
            >
                      <div className="flex flex-col gap-0.5 p-2">
                {['All', ...categories].slice(0, 8).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => handleCategoryClick(cat)}
                    className="rounded-lg px-3 py-2.5 text-left text-sm font-medium"
                    style={{ color: 'var(--store-text)' }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div data-section="hero">
        <MicroComponentRenderer
          source={store.heroSource}
          componentName="StorefrontHero"
          props={{
            ...heroProps,
            heroImageUrl: heroImageUrlCandidate,
          }}
          requiresHeroImage={Boolean(store.canonical?.heroSpec?.imageTreatment) && store.canonical?.heroSpec?.imageTreatment !== 'none'}
          fallback={heroFallback}
          onStatusChange={(status) => setHeroRenderMode(status)}
        />
      </div>

      {/* ── Sections — each gets a data-section attribute for scroll targeting ── */}
      {bodySections.map((section, i) => (
        <div key={i} data-section={section.type}>
          {renderSection(section, i, sectionProps)}
        </div>
      ))}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t" style={{ borderColor: 'var(--store-border)', background: 'var(--store-bg)' }}>
        <div className="mx-auto grid max-w-7xl gap-10 px-8 py-12 md:grid-cols-[1fr_auto]">
          <div className="max-w-sm">
            <div className="mb-4 flex items-center gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold"
                style={{ background: 'var(--store-accent)', color: 'var(--store-accent-text)', fontFamily: `'${typography.headingFont}', serif` }}
              >
                {displayName.charAt(0).toUpperCase()}
              </span>
              <span
                className="store-heading text-xl font-bold"
                style={{ fontFamily: `'${typography.headingFont}', serif` }}
              >
                {displayName}
              </span>
            </div>
            {store.targetAudience && (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--store-muted)' }}>
                For {store.targetAudience}.
              </p>
            )}
            <p className="mt-3 text-xs" style={{ color: 'var(--store-muted)' }}>
              Powered by <strong style={{ color: 'var(--store-text)' }}>Seltra</strong>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-8 text-xs sm:gap-12">
            {[
              { label: 'Shop', links: store.canonical?.productCategories?.slice(0, 4) ?? ['All products'] },
              { label: 'Support', links: ['FAQ', 'Track order', 'Returns', 'Contact'] },
              { label: 'Legal',   links: ['Privacy policy', 'Terms', 'Refunds'] },
            ].map(({ label, links }) => (
              <div key={label} className="flex flex-col gap-3">
                <span className="store-eyebrow font-semibold" style={{ color: 'var(--store-text)' }}>{label}</span>
                {links.map((l) => (
                  <span key={l} className="cursor-default" style={{ color: 'var(--store-muted)' }}>{l}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-center border-t px-8 py-4" style={{ borderColor: 'var(--store-border)' }}>
          <p className="text-center text-[0.68rem]" style={{ color: 'var(--store-muted)' }}>
            &copy; {new Date().getFullYear()} {displayName}. All rights reserved.
          </p>
        </div>
      </footer>

      <ProductDetailModal product={detailProduct} onClose={() => setDetailProduct(null)} onAddToCart={addToCart} inCart={cart.some((i) => i.product.id === detailProduct?.id)} addToCartLabel={ctaOverrides?.add_to_cart?.label} />
      <CartDrawer
        open={cartOpen}
        items={cart}
        currency={currency}
        storeSlug={storeSlug}
        storeId={store.id}
        onClose={() => setCartOpen(false)}
        onUpdateQty={updateQty}
        fulfillmentMode={store.fulfillmentMode}
        contactPhone={store.contactPhone}
        pickupAddress={store.pickupAddress}
        pickupInstructions={store.pickupInstructions}
        deliveryDays={store.deliveryDays}
        deliveryEstimate={store.deliveryEstimate}
        deliveryFeeNote={store.deliveryFeeNote}
        deliveryTiers={store.deliveryTiers}
        checkoutLabel={ctaOverrides?.checkout?.label}
      />
    </div>
  )
}

class MicroErrorBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.warn('[StorefrontCanvas] Micro component failed:', error) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function visibleDisplayNameRenderCount(source: string): number {
  const propAliasDeclarations = (source.match(/\b(?:const|let|var)\s+displayName\s*=\s*props(?:\.store)?\.displayName\b/g) ?? []).length
  const destructureDeclarations = (source.match(/\b(?:const|let|var)\s*\{\s*displayName(?:\s*=\s*[^,}]*)?\s*\}\s*=\s*props(?:\.store)?\b/g) ?? []).length
  const visibleSource = source.replace(/\b(?:alt|title|ariaLabel|aria-label)\s*:\s*[^,}]*\bdisplayName\b[^,}]*/g, '')
  const visibleMentions = (visibleSource.match(/\bdisplayName\b/g) ?? []).length
  return Math.max(0, visibleMentions - propAliasDeclarations * 2 - destructureDeclarations)
}

function navLeaksPropsToCartIcon(source: string): boolean {
  return /React\.createElement\(\s*(?:props\.)?CartIcon\s*,\s*(?:props|navProps)\b/.test(source) ||
    /\b(?:props\.)?CartIcon\s*\(\s*(?:props|navProps)\b/.test(source) ||
    /React\.createElement\(\s*(?:props\.)?CartIcon\s*,\s*\{[^}]*\bcartCount\s*:/.test(source) ||
    /\b(?:props\.)?CartIcon\s*\(\s*\{[^}]*\bcartCount\s*:/.test(source)
}

function navMissingMobileControl(source: string): boolean {
  return !/className\s*:\s*['"][^'"]*seltra-hamburger\b/i.test(source) ||
    !/onToggleMenu/.test(source)
}

function SafeCartIcon(rawProps: Record<string, unknown>) {
  const className = typeof rawProps.className === 'string' ? rawProps.className : undefined
  const style = rawProps.style && typeof rawProps.style === 'object' ? rawProps.style as React.CSSProperties : undefined
  const size = typeof rawProps.size === 'number' || typeof rawProps.size === 'string' ? rawProps.size : undefined
  const width = typeof rawProps.width === 'number' || typeof rawProps.width === 'string' ? rawProps.width : size
  const height = typeof rawProps.height === 'number' || typeof rawProps.height === 'string' ? rawProps.height : size
  const color = typeof rawProps.color === 'string' ? rawProps.color : undefined
  const strokeWidth = typeof rawProps.strokeWidth === 'number' || typeof rawProps.strokeWidth === 'string' ? rawProps.strokeWidth : undefined

  return (
    <ShoppingBag
      className={className}
      style={style}
      width={width}
      height={height}
      color={color}
      strokeWidth={strokeWidth}
      aria-hidden="true"
    />
  )
}

function MicroComponentRenderer({
  source,
  componentName,
  props,
  requiresHeroImage,
  fallback,
  onStatusChange,
}: {
  source?: string | null
  componentName: 'StorefrontHero' | 'StorefrontNav'
  props: Record<string, unknown>
  requiresHeroImage?: boolean
  fallback: React.ReactNode
  onStatusChange?: (status: 'ai' | 'fallback') => void
}) {
  const lastStatus = useRef<'ai' | 'fallback' | null>(null)
  const rejectionReason = useMemo(() => {
    if (!source) return 'no source'
    if (componentName === 'StorefrontHero' && visibleDisplayNameRenderCount(source) > 1) return 'duplicate displayName render'
    if (componentName === 'StorefrontNav' && navLeaksPropsToCartIcon(source)) return 'CartIcon received parent props'
    if (componentName === 'StorefrontNav' && navMissingMobileControl(source)) return 'missing mobile hamburger control'
    return null
  }, [source, componentName])

  const Component = useMemo(() => {
    if (!source) return null
    if (rejectionReason) {
      console.warn(`[StorefrontCanvas] Rejecting ${componentName} source: ${rejectionReason}; using fallback`)
      return null
    }
    if (componentName === 'StorefrontHero' && visibleDisplayNameRenderCount(source) > 1) {
      console.warn('[StorefrontCanvas] Rejecting hero source with duplicate displayName render; using fallback')
      return null
    }
    if (componentName === 'StorefrontNav' && navMissingMobileControl(source)) {
      console.warn('[StorefrontCanvas] Rejecting nav source without mobile hamburger; using fallback')
      return null
    }
    // Generated hero code is untrusted and older persisted sources may contain
    // list-rendering patterns that compile successfully but trigger React key warnings.
    const usesListRendering = componentName === 'StorefrontHero' && (
      /\b(?:map|flatMap)\s*\(/.test(source) ||
      /Array\.from\s*\(/.test(source) ||
      /React\.Children\.toArray/.test(source)
    )

    if (usesListRendering) {
      console.warn('[StorefrontCanvas] Rejecting hero source with list rendering; using keyed fallback')
      return null
    }

    const ignoresHeroImage = componentName === 'StorefrontHero' &&
      requiresHeroImage &&
      !/(?:props\.)?heroImageUrl\b/.test(source)
    if (ignoresHeroImage) {
      console.warn('[StorefrontCanvas] Rejecting hero source that ignores heroImageUrl prop; using keyed fallback')
      return null
    }

    try {
      const factory = new Function('React', `${source}; return typeof ${componentName} === "function" ? ${componentName} : null;`)
      return factory(React) as React.ComponentType<Record<string, unknown>> | null
    } catch (error) {
      console.warn(`[StorefrontCanvas] Could not construct ${componentName}:`, error)
      return null
    }
  }, [source, componentName, requiresHeroImage, rejectionReason])

  useEffect(() => {
    if (!onStatusChange) return
    const setStatus = (status: 'ai' | 'fallback', reason?: string) => {
      if (lastStatus.current === status) return
      lastStatus.current = status
      onStatusChange(status)
      if (process.env.NODE_ENV !== 'production') {
        const suffix = reason ? ` (${reason})` : ''
        const method = status === 'ai' ? console.info : console.warn
        method(`[Storefront] ${componentName} status=${status}${suffix}`)
      }
    }
    if (!source) {
      setStatus('fallback', 'no source')
      return
    }
    if (Component) {
      setStatus('ai')
      return
    }
    setStatus('fallback', rejectionReason ?? 'compile failed')
  }, [source, Component, onStatusChange, componentName, rejectionReason])

  // Minimal, guaranteed-safe fallback — this must never itself throw.
  // We can't reuse `fallback` here because in the hero case `fallback` IS
  // the thing that can throw (it renders next/image), so wrapping it
  // around itself would just crash again on retry.
  const safeFallback = (
    <div className="flex min-h-[240px] items-center justify-center px-6 py-10 text-sm text-muted-foreground">
      This section couldn&apos;t load.
    </div>
  )

  return (
    <MicroErrorBoundary fallback={safeFallback}>
      {Component ? <Component {...props} /> : fallback}
    </MicroErrorBoundary>
  )
}

function isHeroSection(section: ManifestSection) {
  return section.type === 'hero-centered' || section.type === 'hero-split' || section.type === 'hero-editorial' || section.type === 'hero-fullbleed' || section.type === 'hero-minimal'
}

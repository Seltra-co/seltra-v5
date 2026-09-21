//seltra-web/backend/src/ai/agents/storefront-codegen.agent.ts
// v4 — brandName display, industry icons, alternating section backgrounds

import { codegenChat } from '../client'
import type { CanonicalStore } from '../../types'
import {
  detectIndustry,
  resolveComposition,
  resolveIcons,
  type ThemeKey,
  type LayoutKey,
} from './composition-rules'

import { refineManifest }            from './refinement.engine'
import { validateStorefrontHtml, resolveRepairs } from './validator.agent'


export interface StorefrontCodegenInput {
  blueprint: CanonicalStore
  products: Array<{
    id: string
    name: string
    description?: string | null
    price: string | number
    currency: string
    category?: string | null
    images?: Array<{ url: string; isPrimary?: boolean }>
    variants?: Array<{ name: string; value: string }>
  }>
  tenantId: string
  paymentGateways?: string[]
  layoutHint?: string
}

export interface StorefrontCodegenResult {
  success: boolean
  html: string
  provider: string
  error: string | null
}

// ── Section types ─────────────────────────────────────────────────────────────
interface HeroSection {
  type: 'hero-centered' | 'hero-split' | 'hero-editorial' | 'hero-fullbleed' | 'hero-minimal'
  headline: string
  tagline: string
  subtext: string
  eyebrow?: string
  ctaLabel?: string
}
interface AnnouncementBarSection { type: 'announcement-bar'; message: string }
interface FeaturedDropSection {
  type: 'featured-drop'; badge: string; headline: string; subtext: string; showCountdown?: boolean
}
interface ProductGridSection {
  type: 'product-grid'; columns: 2 | 3 | 4; style: 'uniform' | 'dense' | 'featured-first' | 'magazine'
  limit?: number; showCategory?: boolean; sectionLabel?: string
}
interface ProductShelfSection { type: 'product-shelf'; headline: string; subtext?: string; limit?: number }
interface BrandStorySection {
  type: 'brand-story'; headline: string; body: string; stat?: string; statLabel?: string
  layout: 'text-left' | 'text-center'
}
interface CategoryStripSection { type: 'category-strip'; headline?: string }
interface SocialProofSection { type: 'social-proof'; style: 'marquee' | 'grid' | 'cards'; headline?: string; subtext?: string }
interface TrustBarSection { type: 'trust-bar'; items: string[] }
interface NewsletterSection { type: 'newsletter'; headline: string; subtext: string; placeholder?: string }

type Section =
  | HeroSection | AnnouncementBarSection | FeaturedDropSection
  | ProductGridSection | ProductShelfSection | BrandStorySection
  | CategoryStripSection | SocialProofSection | TrustBarSection | NewsletterSection

interface StoreManifest {
  sections: Section[]
  palette: {
    bg: string; surface: string; border: string; text: string
    muted: string; accent: string; accentText: string; accentSoft: string
  }
  typography: { headingFont: string; bodyFont: string }
  industry?: string
}

type CtaScope = 'hero_primary' | 'hero_secondary' | 'add_to_cart' | 'checkout' | 'newsletter' | 'global'
type CtaOverride = { color?: string; textColor?: string; label?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeArr<T>(val: T[] | null | undefined, fallback: T[] = []): T[] {
  return Array.isArray(val) ? val : fallback
}
function esc(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function escJs(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '')
}
function heroImg(products: StorefrontCodegenInput['products']): string {
  for (const p of products) {
    const url = p.images?.find(i => i.isPrimary)?.url ?? p.images?.[0]?.url ?? ''
    if (url && !url.startsWith('data:')) return url
  }
  return ''
}

function ctaOverrides(blueprint: CanonicalStore): Partial<Record<CtaScope, CtaOverride>> {
  return ((blueprint as unknown as { ctaOverrides?: Partial<Record<CtaScope, CtaOverride>> }).ctaOverrides ?? {})
}

function ctaFor(blueprint: CanonicalStore, scope: CtaScope): CtaOverride {
  const overrides = ctaOverrides(blueprint)
  return overrides[scope] ?? overrides.global ?? {}
}

function ctaLabel(blueprint: CanonicalStore, scope: CtaScope, fallback: string): string {
  return ctaFor(blueprint, scope).label ?? fallback
}

function ctaCssVars(
  blueprint: CanonicalStore,
  p: StoreManifest['palette'],
  newsletterFallback: { bg: string; text: string },
): string {
  const scopes: Array<[string, CtaScope, string, string]> = [
    ['hero-primary', 'hero_primary', p.accent, p.accentText],
    ['hero-secondary', 'hero_secondary', p.surface, p.text],
    ['add-to-cart', 'add_to_cart', p.accent, p.accentText],
    ['checkout', 'checkout', p.accent, p.accentText],
    ['newsletter', 'newsletter', newsletterFallback.bg, newsletterFallback.text],
  ]
  return scopes.map(([name, scope, bg, text]) => {
    const override = ctaFor(blueprint, scope)
    return `  --cta-${name}-bg:${override.color ?? bg};--cta-${name}-text:${override.textColor ?? text};`
  }).join('\n')
}

// ── Get display name — brandName takes priority over businessName ──────────────
function getDisplayName(blueprint: CanonicalStore): string {
  const bn = (blueprint as unknown as Record<string, unknown>).brandName
  if (bn && typeof bn === 'string' && bn.trim().length > 0 && bn.split(' ').length <= 4) {
    return bn.trim()
  }
  // Fallback: use first 1-2 words of businessName if it's long
  const biz = blueprint.businessName ?? 'Store'
  const words = biz.trim().split(/\s+/)
  if (words.length > 3) return words.slice(0, 2).join(' ')
  return biz
}

// ── Section background zones ──────────────────────────────────────────────────
// Defines which CSS background class each section type gets by default.
// This creates the visual rhythm: bg → surface → accentSoft → bg → ...
// instead of every section being the same flat color.
type BgZone = 'bg' | 'surface' | 'accent-soft' | 'accent-bold'

const SECTION_BG_MAP: Record<string, BgZone> = {
  'announcement-bar': 'accent-bold',   // always accent color — already handled inline
  'hero-centered':    'bg',
  'hero-split':       'bg',
  'hero-editorial':   'bg',
  'hero-fullbleed':   'bg',
  'hero-minimal':     'bg',
  'trust-bar':        'surface',
  'category-strip':   'surface',
  'product-shelf':    'bg',
  'featured-drop':    'accent-soft',
  'product-grid':     'surface',
  'brand-story':      'bg',
  'social-proof':     'surface',
  'newsletter':       'accent-bold',   // full-bleed accent — like v0/Boty's dark green section
}

function sectionBgClass(type: string): string {
  const zone = SECTION_BG_MAP[type] ?? 'bg'
  return `section-zone--${zone}`
}

// ── Theme / typography maps ───────────────────────────────────────────────────
import { THEME_PALETTES, THEME_TYPOGRAPHY } from '../design-system/theme'

// ── Fallback + sanitise (unchanged logic, uses getDisplayName) ────────────────
function fallbackManifest(input: StorefrontCodegenInput): StoreManifest {
  const corpus = [input.blueprint.businessName, input.blueprint.businessType ?? '', ...(input.blueprint.productCategories ?? [])].join(' ').toLowerCase()
  const isFood    = /food|restaurant|cafe|catering|snack|drink|beverage|grocery|bread|bake|pastry/.test(corpus)
  const isBeauty  = /beauty|skincare|cosmetic|luxury|jewelry|perfume|wellness|candle|artisan|boutique|serum|lotion/.test(corpus)
  const isBold    = /streetwear|sneaker|sport|gym|fitness|gaming|tech|hype|urban|apparel/.test(corpus)
  const displayName = getDisplayName(input.blueprint)

  if (isFood) return {
    sections: [
      { type: 'announcement-bar', message: `Order from ${displayName} — fresh and delivered to you.` },
      { type: 'hero-centered', headline: displayName, tagline: 'Fresh. Local. Handmade.', subtext: `Made daily for ${input.blueprint.targetAudience ?? 'you'}.`, eyebrow: input.blueprint.businessType ?? '' },
      { type: 'trust-bar', items: ['Same-day delivery', 'Fresh ingredients', 'No preservatives', 'Local sourcing'] },
      { type: 'product-shelf', headline: 'Best Sellers', subtext: 'Our most loved products', limit: 5 },
      { type: 'product-grid', columns: 3, style: 'magazine', showCategory: true, sectionLabel: 'Full Menu' },
      { type: 'newsletter', headline: 'Get recipes and exclusive offers', subtext: 'Join our community of food lovers.', placeholder: 'Your email address' },
    ],
    palette: THEME_PALETTES['warm-earth'],
    typography: THEME_TYPOGRAPHY['warm-earth'],
  }

  if (isBeauty) return {
    sections: [
      { type: 'hero-editorial', headline: displayName, tagline: 'Crafted for your skin.', subtext: `For ${input.blueprint.targetAudience ?? 'your customers'}.`, eyebrow: input.blueprint.businessType ?? '' },
      { type: 'trust-bar', items: ['Small batch formulas', 'No harsh chemicals', 'Dermatologist tested', 'Cruelty free'] },
      { type: 'product-grid', columns: 3, style: 'uniform', showCategory: true, sectionLabel: 'Products' },
      { type: 'brand-story', headline: 'Why we exist', body: `${displayName} was built for people who care about what they put on their skin. Small batches, real ingredients, honest results.`, layout: 'text-left' },
      { type: 'newsletter', headline: 'Skincare tips and new drops', subtext: 'Join thousands of happy customers.', placeholder: 'Enter your email' },
    ],
    palette: THEME_PALETTES['luxury'],
    typography: THEME_TYPOGRAPHY['luxury'],
  }

  if (isBold) return {
    sections: [
      { type: 'announcement-bar', message: 'New drop just landed — limited stock. Get yours before it sells out.' },
      { type: 'hero-fullbleed', headline: displayName, tagline: 'Limited drops. No restocks.', subtext: 'For those who move first.', eyebrow: input.blueprint.businessType ?? '' },
      { type: 'featured-drop', badge: 'NEW DROP', headline: 'Latest collection just landed.', subtext: 'Grab yours before it sells out.', showCountdown: true },
      { type: 'product-grid', columns: 3, style: 'dense', showCategory: false, sectionLabel: 'Shop All' },
      { type: 'trust-bar', items: ['Free shipping over GHS 500', 'Ships in 24h', 'Easy returns', 'Secure checkout'] },
    ],
    palette: THEME_PALETTES['bold-dark'],
    typography: THEME_TYPOGRAPHY['bold-dark'],
  }

  return {
    sections: [
      { type: 'hero-centered', headline: displayName, tagline: 'Shop the collection.', subtext: `For ${input.blueprint.targetAudience ?? 'your customers'}.`, eyebrow: input.blueprint.businessType ?? '' },
      { type: 'trust-bar', items: ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support'] },
      { type: 'product-grid', columns: 3, style: 'uniform', showCategory: true, sectionLabel: 'Products' },
    ],
    palette: THEME_PALETTES['minimal-light'],
    typography: THEME_TYPOGRAPHY['minimal-light'],
  }
}

function sanitiseManifest(raw: StoreManifest, input: StorefrontCodegenInput): StoreManifest {
  const DEFAULT_TRUST = ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support']
  const displayName = getDisplayName(input.blueprint)
  const sections = safeArr(raw.sections).map(s => {
    switch (s.type) {
      case 'trust-bar': return { ...s, items: safeArr((s as TrustBarSection).items, DEFAULT_TRUST) }
      case 'hero-centered': case 'hero-split': case 'hero-editorial': case 'hero-fullbleed': case 'hero-minimal': {
        const h = s as HeroSection
        return { ...h, headline: h.headline ?? displayName, tagline: h.tagline ?? '', subtext: h.subtext ?? '' }
      }
      case 'featured-drop': { const f = s as FeaturedDropSection; return { ...f, badge: f.badge ?? 'NEW', headline: f.headline ?? 'Just dropped.', subtext: f.subtext ?? '' } }
      case 'product-grid': { const g = s as ProductGridSection; return { ...g, columns: g.columns ?? 3, style: g.style ?? 'uniform' } }
      case 'product-shelf': { const ps = s as ProductShelfSection; return { ...ps, headline: ps.headline ?? 'Featured products' } }
      case 'brand-story': { const b = s as BrandStorySection; return { ...b, headline: b.headline ?? 'Our story', body: b.body ?? '', layout: b.layout ?? 'text-left' } }
      case 'social-proof': return null
      case 'newsletter': { const n = s as NewsletterSection; return { ...n, headline: n.headline ?? 'Stay in the loop', subtext: n.subtext ?? '' } }
      default: return s
    }
  }).filter((section): section is NonNullable<typeof section> => section !== null)
  return { ...raw, sections, palette: { ...raw.palette, accentSoft: raw.palette?.accentSoft ?? '#f5f5f5' } }
}

// ── Section builder ───────────────────────────────────────────────────────────
function buildSectionsFromLayout(
  layout: LayoutKey,
  input: StorefrontCodegenInput,
  composition: ReturnType<typeof resolveComposition>,
): Section[] {
  const { blueprint, products } = input
  const displayName = getDisplayName(blueprint)
  const heroVariant = composition.sectionVariantOverrides?.hero ?? 'centered'
  const include = new Set(composition.includeSections ?? [])
  const primaryCategory = blueprint.productCategories?.[0]

  const faqItems = (bp: typeof blueprint) => [
    { question: `How do I order from ${displayName}?`, answer: `Browse our products, add to cart, and complete checkout securely via ${(input.paymentGateways ?? ['Moolre'])[0]}. You will receive a confirmation immediately.` },
    { question: 'How long does delivery take?', answer: bp.targetAudience?.includes('digital') || bp.businessType?.toLowerCase().includes('digital') ? 'Your products are delivered instantly after payment. Check your email for download links.' : 'Most orders arrive within 2-5 business days. We will send tracking info once your order is dispatched.' },
    { question: `Can I customise my ${bp.businessType ?? 'order'}?`, answer: 'Yes. Many products can be personalised. Contact us before ordering and we will guide you through the options.' },
    { question: 'What is your refund policy?', answer: bp.businessType?.toLowerCase().includes('digital') ? 'Digital products are non-refundable once downloaded. If you have an issue, contact us and we will make it right.' : 'We accept returns within 14 days for unused items in original condition. Contact us to start the process.' },
  ]

  const heroSection: Section = {
    type: heroVariant === 'editorial' ? 'hero-editorial' : heroVariant === 'fullbleed' ? 'hero-fullbleed' : heroVariant === 'split' ? 'hero-split' : heroVariant === 'minimal' ? 'hero-minimal' : 'hero-centered',
    headline: displayName,
    tagline: `${blueprint.businessType ? `The best of ${blueprint.businessType}` : 'Shop the collection'}.`,
    subtext: blueprint.targetAudience ? `Designed for ${blueprint.targetAudience}. Fast checkout, secure payment.` : 'Discover our full collection. Fast checkout, secure payment.',
    eyebrow: blueprint.businessType ?? '',
  } as Section

  const trustBar: Section = {
    type: 'trust-bar',
    items: (blueprint.storeFeatures ?? []).slice(0, 4).length > 0 ? (blueprint.storeFeatures ?? []).slice(0, 4) : ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support'],
  } as Section

  const productGrid: Section = {
    type: 'product-grid',
    columns: 3,
    style: layout === 'showcase' ? 'dense' : layout === 'editorial' ? 'magazine' : 'uniform',
    showCategory: true,
    sectionLabel: primaryCategory ? `${primaryCategory} collection` : `${displayName} collection`,
    limit: 9,
  } as Section

  const newsletter: Section = { type: 'newsletter', headline: 'Stay in the loop', subtext: 'Get updates and exclusive offers.', placeholder: 'Enter your email' } as Section
  const brandStory: Section = { type: 'brand-story', headline: 'Why we exist', body: `${displayName} was built for ${blueprint.targetAudience ?? 'people who care'}. We believe in quality, craft, and honesty.`, layout: 'text-left' } as Section
  const announcementBar: Section = { type: 'announcement-bar', message: `Shop ${displayName} — fast delivery, secure checkout.` } as Section
  const productShelf: Section = { type: 'product-shelf', headline: 'Best Sellers', subtext: 'Our most loved products', limit: 6 } as Section
  const featuredDrop: Section = { type: 'featured-drop', badge: 'NEW DROP', headline: 'Just landed. Limited stock.', subtext: 'Grab yours before it sells out.', showCountdown: true } as Section

  const industryExtras: Section[] = []
  if (include.has('featured-drop') && layout !== 'showcase') industryExtras.push(featuredDrop)
  if (include.has('faq')) industryExtras.push({ type: 'faq', headline: `Questions about ${displayName}`, items: faqItems(blueprint) } as unknown as Section)

  let core: Section[]
  switch (layout) {
    case 'editorial':    core = [heroSection, trustBar, productShelf, brandStory, productGrid, newsletter]; break
    case 'conversion':   core = [announcementBar, heroSection, trustBar, productGrid, newsletter]; break
    case 'storytelling': core = [heroSection, brandStory, productShelf, trustBar, productGrid, newsletter]; break
    case 'showcase':     core = [announcementBar, heroSection, featuredDrop, productGrid, trustBar]; break
    case 'catalog':
    default:             core = [heroSection, trustBar, productGrid]; break
  }

  if (industryExtras.length > 0) {
    const insertAt = Math.max(core.length - 1, 1)
    core.splice(insertAt, 0, ...industryExtras)
  }

  return core
}

async function getManifest(input: StorefrontCodegenInput): Promise<StoreManifest> {
  const corpus = [input.blueprint.businessName, input.blueprint.businessType ?? '', ...(input.blueprint.productCategories ?? [])].join(' ')
  const industry = detectIndustry(corpus)
  const composition = resolveComposition(industry)
  const themeKey = composition.theme
  const palette = THEME_PALETTES[themeKey] ?? THEME_PALETTES['minimal-light']
  const typography = THEME_TYPOGRAPHY[themeKey] ?? THEME_TYPOGRAPHY['minimal-light']
  const sections = buildSectionsFromLayout(composition.layout, input, composition)

  const baseManifest: StoreManifest = { sections, palette, typography: { headingFont: typography.headingFont, bodyFont: typography.bodyFont }, industry }

// ── LLM copy enrichment (optional, non-blocking) ──────────────────────────
  if (process.env.SELTRA_LLM_MANIFEST === 'true') {
    try {
      const displayName = getDisplayName(input.blueprint)
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000))
      const result = await Promise.race([
        codegenChat([{ role: 'user', content: `Write improved hero copy for brand "${displayName}" — type: ${input.blueprint.businessType}, audience: ${input.blueprint.targetAudience}. Return JSON: { "headline": string, "tagline": string, "subtext": string }` }], 200),
        timeout,
      ])
      const raw = result.content.trim().replace(/```json|```/g, '').trim()
      const enriched = JSON.parse(raw) as { headline?: string; tagline?: string; subtext?: string }
      if (enriched.headline) {
        const enrichedSections = baseManifest.sections.map(s => {
        const heroTypes = ['hero-centered','hero-split','hero-editorial','hero-fullbleed','hero-minimal']
          if (heroTypes.includes(s.type)) {
            const hero = s as HeroSection
            return { ...hero, headline: enriched.headline ?? hero.headline, tagline: enriched.tagline ?? hero.tagline, subtext: enriched.subtext ?? hero.subtext }
          }
          return s
        })
        baseManifest.sections = enrichedSections
      }
    } catch {
      // LLM enrichment failed silently — rule-based manifest is fine
    }
  }

  // ── Critic + refinement loop — runs on EVERY generation ──────────────────
  const sanitised = sanitiseManifest(baseManifest, input)
  const { manifest: refined, fixesApplied, finalReport } = await refineManifest(
    sanitised as unknown as import('./critic.agent').ManifestForCritic,
    input.blueprint,
  )
  if (fixesApplied.length > 0) {
    console.log(`[Codegen] Refinement applied ${fixesApplied.length} fix(es). Final critic score: ${finalReport.score}/100`)
  }
  return refined as unknown as StoreManifest
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderAnnouncementBar(s: AnnouncementBarSection): string {
  return `<div class="announcement-bar">
  <div class="announcement-inner">
    <span class="announcement-dot"></span>
    <span>${esc(s.message)}</span>
    <span class="announcement-dot"></span>
    <span>${esc(s.message)}</span>
    <span class="announcement-dot"></span>
    <span>${esc(s.message)}</span>
  </div>
</div>`
}

function renderHeroCentered(s: HeroSection, input: StorefrontCodegenInput, features: string[], bgUrl: string): string {
  const hasImg = !!bgUrl
  return `<section class="hero hero-centered ${sectionBgClass('hero-centered')}">
  ${hasImg ? `<div class="hero-bg"><img src="${esc(bgUrl)}" alt="" class="hero-bg-img" aria-hidden="true"><div class="hero-bg-overlay"></div></div>` : `<div class="hero-bg hero-bg--gradient"></div>`}
  <div class="hero-content hero-content--centered">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}
    <h1 class="hero-title">${esc(s.headline)}</h1>
    <p class="hero-tagline">${esc(s.tagline)}</p>
    ${s.subtext ? `<p class="hero-sub">${esc(s.subtext)}</p>` : ''}
    ${features.length ? `<div class="pill-row">${features.map(f => `<span class="pill">${esc(f)}</span>`).join('')}</div>` : ''}
    <button class="btn-primary hero-cta" onclick="document.getElementById('products')?.scrollIntoView({behavior:'smooth'})">${esc(ctaLabel(input.blueprint, 'hero_primary', s.ctaLabel ?? 'Shop now'))}</button>
  </div>
</section>`
}

function renderHeroSplit(s: HeroSection, input: StorefrontCodegenInput, features: string[]): string {
  const imgUrl = input.products[0]?.images?.find(i => i.isPrimary)?.url ?? input.products[0]?.images?.[0]?.url ?? ''
  const useImg = imgUrl && !imgUrl.startsWith('data:')
  return `<section class="hero hero-split ${sectionBgClass('hero-split')}">
  <div class="hero-split-text">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}
    <h1 class="hero-title">${esc(s.headline)}</h1>
    <p class="hero-tagline">${esc(s.tagline)}</p>
    ${s.subtext ? `<p class="hero-sub">${esc(s.subtext)}</p>` : ''}
    ${features.length ? `<div class="pill-row">${features.map(f => `<span class="pill">${esc(f)}</span>`).join('')}</div>` : ''}
    <button class="btn-primary hero-cta" onclick="document.getElementById('products')?.scrollIntoView({behavior:'smooth'})">${esc(ctaLabel(input.blueprint, 'hero_primary', s.ctaLabel ?? 'Shop now'))}</button>
  </div>
  <div class="hero-split-img ${useImg ? '' : 'hero-split-img--fallback'}"${useImg ? ` style="background-image:url('${esc(imgUrl)}')"` : ''}></div>
</section>`
}

function renderHeroEditorial(s: HeroSection, input: StorefrontCodegenInput, features: string[], bgUrl: string): string {
  const hasImg = !!bgUrl
  return `<section class="hero hero-editorial ${sectionBgClass('hero-editorial')}">
  ${hasImg ? `<div class="hero-bg hero-bg--editorial"><img src="${esc(bgUrl)}" alt="" class="hero-bg-img" aria-hidden="true"><div class="hero-bg-overlay hero-bg-overlay--editorial"></div></div>` : `<div class="hero-bg hero-bg--gradient-editorial"></div>`}
  <div class="hero-content hero-content--editorial">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}
    <h1 class="hero-title hero-title--editorial">${esc(s.headline)}</h1>
    <p class="hero-tagline hero-tagline--editorial">${esc(s.tagline)}</p>
    ${s.subtext ? `<p class="hero-sub">${esc(s.subtext)}</p>` : ''}
    ${features.length ? `<div class="pill-row">${features.map(f => `<span class="pill">${esc(f)}</span>`).join('')}</div>` : ''}
    <button class="btn-primary hero-cta" onclick="document.getElementById('products')?.scrollIntoView({behavior:'smooth'})">${esc(ctaLabel(input.blueprint, 'hero_primary', s.ctaLabel ?? 'Shop now'))}</button>
  </div>
</section>`
}

function renderHeroFullbleed(s: HeroSection, input: StorefrontCodegenInput, features: string[], bgUrl: string): string {
  const hasImg = !!bgUrl
  return `<section class="hero hero-fullbleed ${sectionBgClass('hero-fullbleed')}">
  ${hasImg ? `<div class="hero-bg"><img src="${esc(bgUrl)}" alt="" class="hero-bg-img" aria-hidden="true"><div class="hero-bg-overlay hero-bg-overlay--dark"></div></div>` : `<div class="hero-bg hero-bg--dark"></div>`}
  <div class="hero-content hero-content--fullbleed">
    ${s.eyebrow ? `<p class="eyebrow eyebrow--light">${esc(s.eyebrow)}</p>` : ''}
    <h1 class="hero-title hero-title--fullbleed">${esc(s.headline)}</h1>
    <p class="hero-tagline">${esc(s.tagline)}</p>
    ${s.subtext ? `<p class="hero-sub">${esc(s.subtext)}</p>` : ''}
    ${features.length ? `<div class="pill-row pill-row--light">${features.map(f => `<span class="pill pill--light">${esc(f)}</span>`).join('')}</div>` : ''}
    <button class="btn-primary hero-cta" onclick="document.getElementById('products')?.scrollIntoView({behavior:'smooth'})">${esc(ctaLabel(input.blueprint, 'hero_primary', s.ctaLabel ?? 'Shop now'))}</button>
  </div>
</section>`
}

function renderHeroMinimal(s: HeroSection, input: StorefrontCodegenInput): string {
  return `<section class="hero hero-minimal ${sectionBgClass('hero-minimal')}">
  <div class="hero-content hero-content--minimal">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}
    <h1 class="hero-title hero-title--minimal">${esc(s.headline)}</h1>
    ${s.subtext ? `<p class="hero-sub">${esc(s.subtext)}</p>` : ''}
    <button class="btn-primary hero-cta" onclick="document.getElementById('products')?.scrollIntoView({behavior:'smooth'})">${esc(ctaLabel(input.blueprint, 'hero_primary', s.ctaLabel ?? 'Shop now'))}</button>
  </div>
</section>`
}

function renderFeaturedDrop(s: FeaturedDropSection, products: StorefrontCodegenInput['products']): string {
  const product = products[0]
  if (!product) return ''
  const imgUrl = product.images?.find(i => i.isPrimary)?.url ?? product.images?.[0]?.url ?? ''
  const useImg = imgUrl && !imgUrl.startsWith('data:')
  const countdown = s.showCountdown ? `<div class="drop-countdown"><span class="cd-num" id="cd-h">23</span><span class="cd-sep">:</span><span class="cd-num" id="cd-m">59</span><span class="cd-sep">:</span><span class="cd-num" id="cd-s">59</span></div>` : ''
  const price = Number(product.price).toFixed(2)
  return `<section class="featured-drop ${sectionBgClass('featured-drop')}">
  <div class="drop-body">
    <span class="drop-badge">${esc(s.badge)}</span>
    <h2 class="drop-headline">${esc(s.headline)}</h2>
    <p class="drop-sub">${esc(s.subtext)}</p>
    ${countdown}
    <button class="btn-primary drop-cta" onclick="addToCart('${escJs(product.id)}','${escJs(product.name)}',${price},'${escJs(product.currency)}','${escJs(imgUrl)}')">
      Shop Drop — ${esc(product.currency)} ${price}
    </button>
  </div>
  ${useImg ? `<div class="drop-img" style="background-image:url('${esc(imgUrl)}')"></div>` : ''}
</section>`
}

function renderProductCard(p: StorefrontCodegenInput['products'][0], input: StorefrontCodegenInput, showCategory: boolean, style?: string): string {
  const imgUrl = p.images?.find(i => i.isPrimary)?.url ?? p.images?.[0]?.url ?? ''
  const useImg = imgUrl && !imgUrl.startsWith('data:')
  const price = Number(p.price).toFixed(2)
  const isMagazine = style === 'magazine'

  // Use a short product name: if name is very long (>40 chars), try to trim it
  const displayProductName = p.name.length > 40
    ? p.name.replace(/^(.{0,35})\s.*$/, '$1…')
    : p.name

  const imgHtml = useImg
    ? `<div class="pcard-img" style="background-image:url('${esc(imgUrl)}')"></div>`
    : `<div class="pcard-img pcard-img--empty"><span class="pcard-initials">${esc(displayProductName.slice(0, 2).toUpperCase())}</span></div>`

  return `<article class="pcard${isMagazine ? ' pcard--magazine' : ''}">
  <div class="pcard-img-wrap">${imgHtml}
    <button class="pcard-quick-add" onclick="addToCart('${escJs(p.id)}','${escJs(p.name)}',${price},'${escJs(p.currency)}','${escJs(imgUrl)}')">${esc(ctaLabel(input.blueprint, 'add_to_cart', 'Add to cart'))}</button>
  </div>
  <div class="pcard-body">
    ${showCategory && p.category ? `<span class="pcard-cat">${esc(p.category)}</span>` : ''}
    <h3 class="pcard-name">${esc(displayProductName)}</h3>
    ${p.description ? `<p class="pcard-desc">${esc((p.description ?? '').slice(0, 80))}</p>` : ''}
    <div class="pcard-foot">
      <span class="pcard-price">${esc(p.currency)} ${price}</span>
      <button class="btn-add" onclick="addToCart('${escJs(p.id)}','${escJs(p.name)}',${price},'${escJs(p.currency)}','${escJs(imgUrl)}')">${esc(ctaLabel(input.blueprint, 'add_to_cart', '+ Add'))}</button>
    </div>
  </div>
</article>`
}

function renderProductGrid(s: ProductGridSection, input: StorefrontCodegenInput): string {
  const products = input.products
  const limited = products.slice(0, s.limit ?? 9)
  const colClass = s.columns === 4 ? 'cols-4' : s.columns === 2 ? 'cols-2' : 'cols-3'
  return `<section class="section-products ${sectionBgClass('product-grid')}">
  <div class="section-header">
    <div>
      <span class="section-eyebrow">${esc(s.sectionLabel ?? 'Products')}</span>
      <h2 class="section-title">${esc(s.sectionLabel ?? 'Products')}</h2>
    </div>
    <span class="section-count">${products.length} items</span>
  </div>
  <div class="pgrid ${colClass} pgrid--${s.style ?? 'uniform'}" id="products">
    ${limited.map(p => renderProductCard(p, input, s.showCategory ?? true, s.style)).join('\n')}
  </div>
</section>`
}

function renderProductShelf(s: ProductShelfSection, input: StorefrontCodegenInput): string {
  const limited = input.products.slice(0, s.limit ?? 6)
  return `<section class="section-shelf ${sectionBgClass('product-shelf')}">
  <div class="shelf-header">
    <div>
      <h2 class="shelf-title">${esc(s.headline)}</h2>
      ${s.subtext ? `<p class="shelf-sub">${esc(s.subtext)}</p>` : ''}
    </div>
    <span class="shelf-hint">Scroll →</span>
  </div>
  <div class="shelf-track">
    ${limited.map(p => renderProductCard(p, input, false)).join('\n')}
  </div>
</section>`
}

function renderBrandStory(s: BrandStorySection): string {
  const statHtml = s.stat ? `<div class="story-stat"><span class="story-stat-num">${esc(s.stat)}</span><span class="story-stat-label">${esc(s.statLabel ?? '')}</span></div>` : ''
  return `<section class="section-story story--${s.layout ?? 'text-left'} ${sectionBgClass('brand-story')}">
  <div class="story-inner">
    <h2 class="story-title">${esc(s.headline)}</h2>
    <p class="story-body">${esc(s.body)}</p>
    ${statHtml}
  </div>
</section>`
}

function renderCategoryStrip(s: CategoryStripSection, categories: string[]): string {
  if (!categories.length) return ''
  const pills = categories.map(c => `<button class="cat-pill" onclick="filterCat('${escJs(c)}')">${esc(c)}</button>`).join('')
  return `<section class="section-cats ${sectionBgClass('category-strip')}">
  ${s.headline ? `<span class="section-label">${esc(s.headline)}</span>` : ''}
  <div class="cat-row"><button class="cat-pill cat-pill--active" onclick="filterCat('all')">All</button>${pills}</div>
</section>`
}

// ── Trust bar with industry icons ─────────────────────────────────────────────
function renderTrustBar(s: TrustBarSection, industry: string): string {
  const items = safeArr(s.items, ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support'])
  const icons = resolveIcons(industry)

  return `<section class="section-trust ${sectionBgClass('trust-bar')}">
  ${items.map((item, i) => {
    const iconData = icons.items[i] ?? icons.items[0]
    return `<div class="trust-item">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="trust-icon">
        <path d="${esc(iconData.path)}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="trust-text">
        <span class="trust-label">${esc(item)}</span>
      </div>
    </div>`
  }).join('')}
</section>`
}

function renderSocialProof(s: SocialProofSection): string {
  const reviews = [
    { text: 'Exceptional quality, fast delivery', stars: 5 },
    { text: 'My go-to store in Accra. Always fresh', stars: 5 },
    { text: "Best experience I've had shopping local", stars: 5 },
    { text: 'Will definitely order again', stars: 5 },
    { text: 'Exactly as described, packaged beautifully', stars: 5 },
    { text: 'Great product, arrived quickly', stars: 5 },
  ]
  const stars = (n: number) => '★'.repeat(n)

  if (s.style === 'cards') {
    return `<section class="section-proof ${sectionBgClass('social-proof')}">
  ${s.headline ? `<div class="proof-head"><h2 class="proof-title">${esc(s.headline)}</h2>${s.subtext ? `<p class="proof-sub">${esc(s.subtext)}</p>` : ''}</div>` : ''}
  <div class="proof-cards-track">
    ${reviews.map(r => `<div class="proof-card"><p class="proof-stars">${stars(r.stars)}</p><p class="proof-text">${esc(r.text)}</p></div>`).join('')}
  </div>
</section>`
  }

  if (s.style === 'grid') {
    return `<section class="section-proof ${sectionBgClass('social-proof')}">
  ${s.headline ? `<h2 class="proof-title">${esc(s.headline)}</h2>` : ''}
  <div class="proof-grid">
    ${reviews.slice(0, 3).map(r => `<div class="proof-card"><p class="proof-stars">${stars(r.stars)}</p><p class="proof-text">${esc(r.text)}</p></div>`).join('')}
  </div>
</section>`
  }

  const all = [...reviews, ...reviews]
  return `<section class="section-proof section-proof--marquee ${sectionBgClass('social-proof')}">
  ${s.headline ? `<p class="proof-marquee-label">${esc(s.headline)}</p>` : ''}
  <div class="marquee-wrap"><div class="marquee-inner">
    ${all.map(r => `<span class="marquee-chip">${esc(r.text)} ${stars(r.stars)}</span>`).join('')}
  </div></div>
</section>`
}

function renderNewsletter(s: NewsletterSection, input: StorefrontCodegenInput): string {
  return `<section class="section-newsletter ${sectionBgClass('newsletter')}">
  <div class="nl-inner">
    <h2 class="nl-title">${esc(s.headline)}</h2>
    ${s.subtext ? `<p class="nl-sub">${esc(s.subtext)}</p>` : ''}
    <div class="nl-form">
      <input type="email" class="nl-input" placeholder="${esc(s.placeholder ?? 'Enter your email')}" aria-label="Email address">
      <button class="btn-primary nl-btn" onclick="nlSubmit(this)">${esc(ctaLabel(input.blueprint, 'newsletter', 'Subscribe ->'))}</button>
    </div>
    <p class="nl-reassurance">No spam. Unsubscribe anytime.</p>
  </div>
</section>`
}

function renderSection(section: Section, input: StorefrontCodegenInput, features: string[], categories: string[], industry: string): string {
  const bg = heroImg(input.products)
  switch (section.type) {
    case 'announcement-bar':  return renderAnnouncementBar(section)
    case 'hero-centered':     return renderHeroCentered(section, input, features, bg)
    case 'hero-split':        return renderHeroSplit(section, input, features)
    case 'hero-editorial':    return renderHeroEditorial(section, input, features, bg)
    case 'hero-fullbleed':    return renderHeroFullbleed(section, input, features, bg)
    case 'hero-minimal':      return renderHeroMinimal(section, input)
    case 'featured-drop':     return renderFeaturedDrop(section, input.products)
    case 'product-grid':      return renderProductGrid(section, input)
    case 'product-shelf':     return renderProductShelf(section, input)
    case 'brand-story':       return renderBrandStory(section)
    case 'category-strip':    return renderCategoryStrip(section, categories)
    case 'trust-bar':         return renderTrustBar(section, industry)
    case 'social-proof':      return renderSocialProof(section)
    case 'newsletter':        return renderNewsletter(section, input)
    default: return ''
  }
}

// ── CSS ───────────────────────────────────────────────────────────────────────
function buildCSS(manifest: StoreManifest, blueprint: CanonicalStore): string {
  const p = manifest.palette
  const hf = manifest.typography.headingFont
  const bf = manifest.typography.bodyFont

  // Derive newsletter background: for light themes use accent, for dark themes
  // use a slightly lighter surface. This avoids the gold-on-gold problem.
  const isDark = p.bg.startsWith('#0') || p.bg.startsWith('#1')
  const nlBg = isDark ? p.surface : p.accent
  const nlText = isDark ? p.text : p.accentText
  const nlSubText = isDark ? `${p.text}99` : `${p.accentText}cc`
  const nlInputBorder = isDark ? p.border : `${p.accentText}40`
  const nlInputBg = isDark ? p.bg : `${p.accentText}15`
  const ctaVars = ctaCssVars(blueprint, p, { bg: nlText, text: nlBg })

  return `*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:${p.bg};--surface:${p.surface};--border:${p.border};
  --text:${p.text};--muted:${p.muted};
  --accent:${p.accent};--ax:${p.accentText};--as:${p.accentSoft};
  --hf:'${hf}',Georgia,serif;--bf:'${bf}',system-ui,sans-serif;
  --r:.5rem;--r2:.75rem;--nav:56px;
  --nl-bg:${nlBg};--nl-text:${nlText};--nl-sub:${nlSubText};
  --nl-input-border:${nlInputBorder};--nl-input-bg:${nlInputBg};
${ctaVars}
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:var(--bf);line-height:1.6;-webkit-font-smoothing:antialiased}
body.no-scroll{overflow:hidden}
img{max-width:100%;display:block}
button{font-family:var(--bf)}

/* ── SECTION BACKGROUND ZONES ──────────────────────────────────────────────
   Every section gets one of four background zones. This creates rhythm and
   prevents the "all one flat color" problem.
────────────────────────────────────────────────────────────────────────── */
.section-zone--bg          { background:var(--bg) }
.section-zone--surface     { background:var(--surface) }
.section-zone--accent-soft { background:var(--as) }
.section-zone--accent-bold { background:var(--nl-bg);color:var(--nl-text) }

/* ANNOUNCEMENT BAR */
.announcement-bar{background:var(--accent);color:var(--ax);overflow:hidden;padding:.5rem 0;font-size:.72rem;font-weight:600;letter-spacing:.04em;white-space:nowrap}
.announcement-inner{display:inline-flex;gap:2rem;animation:scroll-announce 22s linear infinite;padding-right:2rem}
.announcement-dot{display:inline-block;width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.5;vertical-align:middle;flex-shrink:0}
@keyframes scroll-announce{from{transform:translateX(0)}to{transform:translateX(-50%)}}

/* NAV */
.nav{position:sticky;top:0;z-index:40;height:var(--nav);background:${p.bg}f0;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem}
.nav-brand{font-family:var(--hf);font-size:1.1rem;font-weight:700;line-height:1;letter-spacing:-.01em}
.nav-sub{font-size:.6rem;opacity:.4;letter-spacing:.06em;margin-top:.1rem;font-family:monospace;text-transform:uppercase}
.nav-right{display:flex;align-items:center;gap:.75rem}
.nav-cart{display:flex;align-items:center;gap:.4rem;font-size:.78rem;padding:.4rem .9rem;border-radius:999px;border:1.5px solid var(--border);background:transparent;cursor:pointer;color:var(--text);transition:border-color .18s}
.nav-cart:hover{border-color:var(--accent)}
.cart-badge{font-weight:800;color:var(--accent);min-width:1ch;text-align:center;transition:transform .15s}
.cart-badge.bump{transform:scale(1.4)}

/* ── HERO ────────────────────────────────────────────────────────────────── */
.hero{position:relative;overflow:hidden}
.hero-bg{position:absolute;inset:0;z-index:0}
.hero-bg-img{width:100%;height:100%;object-fit:cover;object-position:center}
.hero-bg-overlay{position:absolute;inset:0}
.hero-bg--gradient{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 12%,var(--bg)),var(--bg) 60%)}
.hero-bg--gradient-editorial{background:linear-gradient(to right,color-mix(in srgb,var(--accent) 14%,var(--bg)) 0%,var(--bg) 100%)}
.hero-bg--dark{background:#050505}
.hero-bg--editorial .hero-bg-img{object-position:right center}
.hero-bg-overlay{background:linear-gradient(to bottom,${p.bg}70 0%,${p.bg}a0 50%,${p.bg}e0 100%)}
.hero-bg-overlay--editorial{background:linear-gradient(to right,${p.bg}f0 0%,${p.bg}c0 40%,${p.bg}50 100%)}
.hero-bg-overlay--dark{background:linear-gradient(to top,rgba(0,0,0,.85) 0%,rgba(0,0,0,.5) 50%,rgba(0,0,0,.25) 100%)}
.hero-content{position:relative;z-index:1;display:flex;flex-direction:column;gap:.75rem}
.hero-centered{min-height:clamp(65vh,80vh,95vh);display:flex;align-items:center;justify-content:center;text-align:center}
.hero-content--centered{align-items:center;text-align:center;padding:clamp(3rem,8vh,6rem) 1.5rem;max-width:780px;width:100%}
.hero-editorial{min-height:clamp(60vh,75vh,90vh);display:flex;align-items:center}
.hero-content--editorial{padding:clamp(3rem,8vh,6rem) 1.5rem;max-width:680px}
.hero-fullbleed{min-height:clamp(70vh,85vh,100vh);display:flex;align-items:flex-end;justify-content:center;text-align:center}
.hero-content--fullbleed{padding:clamp(2rem,5vh,3rem) 1.5rem clamp(3rem,8vh,5rem);width:100%;max-width:900px;align-items:center;text-align:center}
.hero-minimal{min-height:clamp(40vh,55vh,70vh);display:flex;align-items:center;border-bottom:1px solid var(--border)}
.hero-content--minimal{padding:clamp(3rem,8vh,6rem) 1.5rem;max-width:600px}
.hero-split{display:grid;grid-template-columns:1fr 1fr;min-height:clamp(55vh,70vh,85vh)}
.hero-split-text{padding:clamp(3rem,7vh,5rem) 1.5rem clamp(3rem,7vh,5rem) clamp(1.5rem,4vw,3rem);display:flex;flex-direction:column;justify-content:center;gap:.75rem}
.hero-split-img{background-size:cover;background-position:center;min-height:300px}
.hero-split-img--fallback{background:linear-gradient(135deg,var(--as),var(--surface))}
@media(max-width:768px){.hero-split{grid-template-columns:1fr}.hero-split-img{aspect-ratio:16/9}}
.eyebrow{font-family:monospace;font-size:.68rem;opacity:.5;text-transform:uppercase;letter-spacing:.1em}
.eyebrow--light{color:rgba(255,255,255,.6)}
.hero-title{font-family:var(--hf);font-size:clamp(2.75rem,8vw,6rem);font-weight:700;line-height:.93;letter-spacing:-.02em}
.hero-title--editorial{font-size:clamp(2.75rem,7vw,5.5rem)}
.hero-title--fullbleed{font-size:clamp(4rem,12vw,9rem);font-weight:900;color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.3)}
.hero-title--minimal{font-size:clamp(2.5rem,5.5vw,4.5rem);font-weight:300;letter-spacing:-.025em}
.hero-tagline{font-size:clamp(.95rem,2.5vw,1.2rem);font-weight:600;opacity:.85}
.hero-tagline--editorial{font-family:var(--hf);font-style:italic;font-size:clamp(1rem,2.5vw,1.4rem)}
.hero-sub{font-size:.9375rem;opacity:.6;max-width:44ch;line-height:1.7}
.pill-row{display:flex;flex-wrap:wrap;gap:.5rem}
.pill{font-size:.7rem;padding:.3rem .75rem;border-radius:999px;border:1px solid var(--border);opacity:.75}
.pill-row--light .pill,.pill--light{border-color:rgba(255,255,255,.3);color:rgba(255,255,255,.85)}
.btn-primary{display:inline-flex;align-items:center;justify-content:center;padding:.7rem 1.5rem;background:var(--cta-hero-primary-bg);color:var(--cta-hero-primary-text);border:none;border-radius:var(--r);font-weight:700;font-size:.875rem;cursor:pointer;transition:opacity .15s,transform .1s;letter-spacing:.01em}
.btn-primary:hover{opacity:.88}
.btn-primary:active{transform:scale(.97)}

/* FEATURED DROP */
.featured-drop{display:flex;align-items:center;gap:2rem;padding:2.5rem 1.5rem;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.drop-body{flex:1;display:flex;flex-direction:column;gap:.75rem;min-width:0}
.drop-badge{display:inline-block;font-family:monospace;font-size:.6rem;font-weight:700;letter-spacing:.12em;padding:.25rem .75rem;border-radius:999px;background:var(--accent);color:var(--ax);text-transform:uppercase;width:fit-content}
.drop-headline{font-family:var(--hf);font-size:clamp(1.4rem,3vw,2.25rem);font-weight:700;line-height:1.1}
.drop-sub{font-size:.875rem;opacity:.65;max-width:40ch}
.drop-countdown{display:flex;align-items:center;gap:.25rem;font-family:monospace;font-size:1.25rem;font-weight:700;color:var(--accent)}
.cd-num{background:var(--surface);border:1px solid var(--border);padding:.2rem .5rem;border-radius:.25rem;min-width:2.25rem;text-align:center}
.cd-sep{opacity:.4;margin:0 .05rem}
.drop-cta{margin-top:.25rem}
.drop-img{width:min(200px,38vw);height:min(200px,38vw);border-radius:var(--r2);background-size:cover;background-position:center;flex-shrink:0}
@media(max-width:600px){.featured-drop{flex-direction:column}.drop-img{width:100%;height:200px}}

/* ── TRUST BAR — with industry icons ──────────────────────────────────────
   4 items laid out in a row. Each has a unique SVG icon + label.
   On surface background with top/bottom border for section separation.
────────────────────────────────────────────────────────────────────────── */
.section-trust{display:flex;flex-wrap:wrap;gap:1rem 2rem;padding:1.5rem clamp(1rem,4vw,2.5rem);border-top:1px solid var(--border);border-bottom:1px solid var(--border);justify-content:center;align-items:center}
.trust-item{display:flex;align-items:center;gap:.625rem}
.trust-icon{color:var(--accent);flex-shrink:0;opacity:.9}
.trust-text{display:flex;flex-direction:column}
.trust-label{font-size:.78rem;font-weight:600;color:var(--text)}

/* CATEGORIES */
.section-cats{padding:.875rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:.875rem;overflow-x:auto;scrollbar-width:none}
.section-cats::-webkit-scrollbar{display:none}
.cat-row{display:flex;gap:.4rem;flex-wrap:nowrap}
.cat-pill{font-size:.72rem;padding:.35rem .9rem;border-radius:999px;border:1px solid var(--border);cursor:pointer;background:transparent;color:var(--muted);transition:all .18s;white-space:nowrap;font-weight:500}
.cat-pill:hover,.cat-pill--active{border-color:var(--accent);color:var(--accent);background:var(--as);font-weight:600}

/* ── PRODUCT GRID SECTION HEADER ──────────────────────────────────────────
   Gives the grid section a real editorial moment above the cards —
   a large heading rather than just a tiny monospace label.
────────────────────────────────────────────────────────────────────────── */
.section-products{padding:clamp(2.5rem,5vh,4rem) clamp(1rem,4vw,2.5rem) clamp(3rem,6vh,5rem)}
.section-header{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}
.section-eyebrow{font-family:monospace;font-size:.62rem;opacity:.4;text-transform:uppercase;letter-spacing:.1em;display:block;margin-bottom:.4rem}
.section-title{font-family:var(--hf);font-size:clamp(1.6rem,3.5vw,2.5rem);font-weight:700;line-height:1.05;letter-spacing:-.015em}
.section-label{font-family:monospace;font-size:.65rem;opacity:.4;text-transform:uppercase;letter-spacing:.08em}
.section-count{font-size:.75rem;opacity:.35;font-family:monospace;padding-bottom:.25rem}
.pgrid{display:grid;gap:1rem}
.pgrid.cols-2{grid-template-columns:repeat(2,1fr)}
.pgrid.cols-3{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.pgrid.cols-4{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}

/* PRODUCT CARD */
.pcard{background:var(--bg);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;display:flex;flex-direction:column;transition:transform .22s,box-shadow .22s;position:relative}
.pcard:hover{transform:translateY(-3px);box-shadow:0 8px 28px rgba(0,0,0,.09)}
.pcard-img-wrap{position:relative;aspect-ratio:1;overflow:hidden;background:var(--as)}
.pcard-img{position:absolute;inset:0;background-size:cover;background-position:center;transition:transform .4s ease}
.pcard-img--empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--as)}
.pcard-initials{font-family:var(--hf);font-size:2rem;font-weight:700;opacity:.2;color:var(--accent)}
.pcard:hover .pcard-img{transform:scale(1.05)}
.pcard-quick-add{position:absolute;bottom:.75rem;left:50%;transform:translateX(-50%) translateY(8px);opacity:0;background:var(--cta-add-to-cart-bg);color:var(--cta-add-to-cart-text);border:none;border-radius:999px;padding:.4rem 1rem;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:opacity .18s,transform .18s}
.pcard:hover .pcard-quick-add{opacity:1;transform:translateX(-50%) translateY(0)}
.pcard-body{padding:.875rem;display:flex;flex-direction:column;gap:.25rem;flex:1}
.pcard-cat{font-size:.6rem;font-family:monospace;opacity:.4;text-transform:uppercase;letter-spacing:.06em}
.pcard-name{font-weight:700;font-size:.875rem;line-height:1.35}
.pcard-desc{font-size:.73rem;opacity:.55;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pcard-foot{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:.625rem}
.pcard-price{font-weight:800;font-size:.9rem;color:var(--accent)}
.btn-add{padding:.35rem .8rem;border-radius:.375rem;font-weight:700;font-size:.7rem;cursor:pointer;border:none;background:var(--cta-add-to-cart-bg);color:var(--cta-add-to-cart-text);transition:opacity .15s,transform .1s}
.btn-add:hover{opacity:.88}
.btn-add:active{transform:scale(.94)}
.pcard--magazine .pcard-img-wrap{aspect-ratio:4/5}

/* PRODUCT SHELF */
.section-shelf{padding:2rem 0}
.shelf-header{padding:0 1.5rem;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between}
.shelf-title{font-family:var(--hf);font-size:clamp(1.25rem,2.5vw,1.75rem);font-weight:700}
.shelf-sub{font-size:.8rem;opacity:.5;margin-top:.25rem}
.shelf-hint{font-size:.7rem;opacity:.35;font-family:monospace}
.shelf-track{display:flex;gap:.875rem;overflow-x:auto;padding:0 1.5rem .75rem;scrollbar-width:none;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
.shelf-track::-webkit-scrollbar{display:none}
.shelf-track .pcard{width:clamp(150px,24vw,200px);flex-shrink:0;scroll-snap-align:start}
.shelf-track .pcard-img-wrap{aspect-ratio:1}
.shelf-track .pcard-desc{display:none}

/* BRAND STORY */
.section-story{padding:clamp(3rem,7vh,5rem) clamp(1rem,4vw,2.5rem);border-top:1px solid var(--border)}
.story--text-center .story-inner{max-width:620px;margin:0 auto;text-align:center}
.story--text-left .story-inner{max-width:620px}
.story-title{font-family:var(--hf);font-size:clamp(1.8rem,3.5vw,2.75rem);font-weight:700;margin-bottom:1rem;line-height:1.1}
.story-body{font-size:1rem;opacity:.7;line-height:1.9;max-width:52ch}
.story--text-center .story-body{margin:0 auto}
.story-stat{margin-top:2rem;display:flex;flex-direction:column;gap:.25rem}
.story-stat-num{font-family:var(--hf);font-size:3rem;font-weight:700;color:var(--accent);line-height:1}
.story-stat-label{font-size:.8rem;opacity:.5;text-transform:uppercase;letter-spacing:.08em;font-family:monospace}

/* SOCIAL PROOF */
.section-proof{padding:2.5rem 1.5rem;border-top:1px solid var(--border);overflow:hidden}
.proof-head{text-align:center;margin-bottom:2rem}
.proof-title{font-family:var(--hf);font-size:clamp(1.4rem,3vw,2rem);font-weight:700}
.proof-sub{font-size:.875rem;opacity:.55;margin-top:.5rem}
.proof-marquee-label{font-family:monospace;font-size:.65rem;opacity:.35;text-transform:uppercase;letter-spacing:.08em;text-align:center;margin-bottom:.875rem}
.proof-cards-track{display:flex;gap:.875rem;overflow-x:auto;padding-bottom:.75rem;scrollbar-width:none}
.proof-cards-track::-webkit-scrollbar{display:none}
.proof-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r2);padding:1.25rem;min-width:220px;flex-shrink:0}
.proof-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.875rem}
.proof-stars{color:var(--accent);font-size:.9rem;margin-bottom:.5rem}
.proof-text{font-size:.8rem;opacity:.7;line-height:1.6}
.marquee-wrap{overflow:hidden;mask:linear-gradient(90deg,transparent,black 10%,black 90%,transparent);-webkit-mask:linear-gradient(90deg,transparent,black 10%,black 90%,transparent)}
.marquee-inner{display:flex;gap:1rem;width:max-content;animation:marquee 28s linear infinite}
.marquee-inner:hover{animation-play-state:paused}
.marquee-chip{font-size:.8rem;opacity:.6;white-space:nowrap;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:.4rem 1rem}
@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}

/* ── NEWSLETTER — full-bleed accent zone ───────────────────────────────────
   Uses --nl-bg / --nl-text variables so it works on both light and dark themes.
   Light themes: accent color background (warm/dark)
   Dark themes:  slightly elevated surface (avoids pure black)
────────────────────────────────────────────────────────────────────────── */
.section-newsletter{padding:clamp(4rem,8vh,6rem) 1.5rem;background:var(--nl-bg) !important;border-top:1px solid var(--border)}
.nl-inner{max-width:560px;margin:0 auto;text-align:center}
.nl-title{font-family:var(--hf);font-size:clamp(1.75rem,4vw,2.75rem);font-weight:700;margin-bottom:.625rem;color:var(--nl-text);line-height:1.1}
.nl-sub{font-size:1rem;margin-bottom:1.75rem;color:var(--nl-sub)}
.nl-form{display:flex;gap:.5rem;max-width:420px;margin:0 auto}
.nl-input{flex:1;padding:.75rem 1.1rem;border:1.5px solid var(--nl-input-border);border-radius:999px;font-size:.875rem;background:var(--nl-input-bg);color:var(--nl-text);outline:none;font-family:var(--bf)}
.nl-input::placeholder{color:var(--nl-sub)}
.nl-input:focus{border-color:var(--nl-text)}
.nl-btn{flex-shrink:0;border-radius:999px;background:var(--cta-newsletter-bg);color:var(--cta-newsletter-text);font-weight:700;font-size:.875rem;padding:.75rem 1.5rem;border:none;cursor:pointer;transition:opacity .15s}
.nl-btn:hover{opacity:.85}
.nl-reassurance{font-size:.72rem;margin-top:1rem;opacity:.5;color:var(--nl-text)}
@media(max-width:480px){.nl-form{flex-direction:column;align-items:stretch}.nl-btn{border-radius:var(--r)}}

/* FOOTER */
.footer{border-top:1px solid var(--border);padding:2rem clamp(1rem,4vw,2.5rem);display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:1.5rem;font-size:.73rem;opacity:.55}
.footer-brand{font-family:var(--hf);font-weight:700;font-size:.9rem;margin-bottom:.25rem}
.footer-tagline{opacity:.7;font-size:.7rem;max-width:22ch;line-height:1.5}

/* CART DRAWER */
.cart-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:49;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.cart-overlay.on{display:block}
.cart-drawer{position:fixed;top:0;right:0;width:min(380px,95vw);height:100dvh;transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);background:var(--surface);border-left:1px solid var(--border);z-index:50;display:flex;flex-direction:column;overflow:hidden}
.cart-drawer.on{transform:translateX(0)}
.cart-head{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border);flex-shrink:0}
.cart-head-title{font-weight:800;font-size:.9375rem}
.cart-close{background:none;border:none;cursor:pointer;font-size:1.1rem;opacity:.4;color:var(--text);padding:.25rem;border-radius:.25rem;line-height:1;transition:opacity .15s}
.cart-close:hover{opacity:1}
.cart-body{flex:1 1 0%;min-height:0;overflow-y:auto;overflow-x:hidden;padding:.875rem 1.25rem;display:flex;flex-direction:column;gap:.625rem;overscroll-behavior:contain}
@keyframes slideIn{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:translateX(0)}}
.cart-item{display:flex;gap:.75rem;align-items:flex-start;padding:.75rem;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);animation:slideIn .2s ease both;flex-shrink:0}
.cart-item-img{width:3rem;height:3rem;border-radius:.25rem;background:var(--border);flex-shrink:0;object-fit:cover}
.cart-item-info{flex:1;min-width:0}
.cart-item-name{font-weight:600;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cart-item-price{font-size:.7rem;opacity:.55;margin-top:.1rem}
.cart-item-qty{display:flex;align-items:center;gap:.3rem;flex-shrink:0;font-size:.75rem}
.qty-btn{width:1.375rem;height:1.375rem;border:1px solid var(--border);border-radius:.25rem;background:none;cursor:pointer;color:var(--text);display:flex;align-items:center;justify-content:center;font-size:.8rem;transition:border-color .15s}
.qty-btn:hover{border-color:var(--accent)}
.cart-empty{font-size:.8rem;opacity:.35;text-align:center;padding:3rem 0;flex:1;display:flex;align-items:center;justify-content:center}
.cart-foot{border-top:1px solid var(--border);padding:.875rem 1.25rem;flex-shrink:0;background:var(--surface)}
.cart-total-row{display:flex;justify-content:space-between;align-items:center;font-size:.875rem;margin-bottom:.75rem}
.cart-total-label{opacity:.55}
.cart-total-val{font-weight:800;color:var(--accent)}
.checkout-btn{width:100%;padding:.8rem;border-radius:var(--r);font-weight:800;font-size:.875rem;cursor:pointer;border:none;background:var(--cta-checkout-bg);color:var(--cta-checkout-text);transition:opacity .15s;letter-spacing:.01em}
.checkout-btn:hover{opacity:.88}
.checkout-btn:disabled{opacity:.3;cursor:not-allowed}

/* TOAST */
.toast{position:fixed;bottom:1.5rem;left:1.5rem;z-index:60;display:flex;align-items:center;gap:.75rem;background:var(--text);color:var(--bg);padding:.75rem 1rem;border-radius:var(--r2);font-size:.8rem;font-weight:500;max-width:280px;box-shadow:0 4px 24px rgba(0,0,0,.2);transform:translateY(20px);opacity:0;transition:all .28s cubic-bezier(.34,1.56,.64,1);pointer-events:none}
.toast.show{transform:translateY(0);opacity:1;pointer-events:auto}
.toast-img{width:2.5rem;height:2.5rem;border-radius:.25rem;object-fit:cover;flex-shrink:0;background:var(--surface)}
.toast-text{flex:1;min-width:0}
.toast-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.toast-label{opacity:.6;font-size:.72rem}

/* RESPONSIVE */
@media(max-width:640px){
  .pgrid.cols-3,.pgrid.cols-4{grid-template-columns:repeat(2,1fr);gap:.75rem}
  .hero-title--fullbleed{font-size:clamp(3rem,14vw,6rem)}
  .hero-title--editorial{font-size:clamp(2.25rem,10vw,3.5rem)}
  .hero-centered .hero-title{font-size:clamp(2.25rem,10vw,4rem)}
  .shelf-track .pcard{width:clamp(140px,44vw,175px)}
  .section-trust{gap:.75rem 1.25rem}
}`
}

// ── JS (unchanged) ────────────────────────────────────────────────────────────
function buildJS(currency: string): string {
  return `<script>
var cart = [];
var cartOpen = false;

function openCart() {
  cartOpen = true;
  document.getElementById('cart-drawer').classList.add('on');
  document.getElementById('cart-overlay').classList.add('on');
  document.body.classList.add('no-scroll');
}
function closeCart() {
  cartOpen = false;
  document.getElementById('cart-drawer').classList.remove('on');
  document.getElementById('cart-overlay').classList.remove('on');
  document.body.classList.remove('no-scroll');
}
function toggleCart() {
  if (cartOpen) { closeCart(); } else { openCart(); }
}

function addToCart(id, name, price, cur, image) {
  price = parseFloat(price);
  var ex = cart.find(function(i) { return i.id === id; });
  if (ex) { ex.qty++; } else { cart.push({ id: id, name: name, price: price, currency: cur, image: image, qty: 1 }); }
  renderCart();
  showToast(name, price, cur, image);
  var badge = document.getElementById('cart-badge');
  if (badge) { badge.classList.add('bump'); setTimeout(function(){ badge.classList.remove('bump'); }, 300); }
}

function updateQty(id, delta) {
  var item = cart.find(function(i) { return i.id === id; });
  if (!item) return;
  item.qty = Math.max(0, item.qty + delta);
  cart = cart.filter(function(i) { return i.qty > 0; });
  renderCart();
}

function renderCart() {
  var count = cart.reduce(function(s, i) { return s + i.qty; }, 0);
  var total = cart.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
  var cur = (cart[0] && cart[0].currency) || '${escJs(currency)}';
  var badge = document.getElementById('cart-badge');
  if (badge) badge.textContent = count || '';
  var totalEl = document.getElementById('cart-total');
  if (totalEl) totalEl.textContent = cur + ' ' + total.toFixed(2);
  var checkoutBtn = document.getElementById('checkout-btn');
  if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
  var bodyEl = document.getElementById('cart-body');
  if (!bodyEl) return;
  if (cart.length === 0) {
    bodyEl.innerHTML = '<div class="cart-empty">Your cart is empty</div>';
    return;
  }
  bodyEl.innerHTML = cart.map(function(item) {
    var imgHtml = item.image
      ? '<img class="cart-item-img" src="' + item.image + '" onerror="this.style.background=\'var(--border)\';this.src=\'\'" alt="">'
      : '<div class="cart-item-img"></div>';
    return '<div class="cart-item">' + imgHtml +
      '<div class="cart-item-info"><div class="cart-item-name">' + item.name + '</div><div class="cart-item-price">' + item.currency + ' ' + item.price.toFixed(2) + '</div></div>' +
      '<div class="cart-item-qty"><button class="qty-btn" onclick="updateQty(\'' + item.id + '\',-1)">−</button><span>' + item.qty + '</span><button class="qty-btn" onclick="updateQty(\'' + item.id + '\',1)">+</button></div>' +
    '</div>';
  }).join('');
  openCart();
}

function checkout() {
  if (cart.length === 0) return;
  window.parent.postMessage({ type: 'SELTRA_CHECKOUT', cart: cart }, '*');
}

function filterCat(cat) {
  document.querySelectorAll('.cat-pill').forEach(function(el) { el.classList.remove('cat-pill--active'); });
  if (event && event.target) event.target.classList.add('cat-pill--active');
  document.querySelectorAll('.pcard').forEach(function(card) {
    var catEl = card.querySelector('.pcard-cat');
    var show = !catEl || cat === 'all' || catEl.textContent.trim().toLowerCase() === cat.toLowerCase();
    card.style.display = show ? '' : 'none';
  });
}

var toastTimer = null;
function showToast(name, price, cur, image) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  var toastImg = toast.querySelector('.toast-img');
  var toastName = toast.querySelector('.toast-name');
  if (toastImg) { toastImg.src = image || ''; toastImg.style.display = image ? '' : 'none'; }
  if (toastName) toastName.textContent = name;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

(function() {
  var hEl = document.getElementById('cd-h');
  var mEl = document.getElementById('cd-m');
  var sEl = document.getElementById('cd-s');
  if (!hEl || !mEl || !sEl) return;
  var end = Date.now() + 23 * 3600000 + 59 * 60000 + 59000;
  setInterval(function() {
    var diff = end - Date.now();
    if (diff <= 0) return;
    hEl.textContent = String(Math.floor(diff / 3600000)).padStart(2, '0');
    mEl.textContent = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    sEl.textContent = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  }, 1000);
})();

function nlSubmit(btn) {
  var input = btn.previousElementSibling;
  if (!input || !input.value || !input.value.includes('@')) { input && input.focus(); return; }
  btn.textContent = 'Subscribed ✓';
  btn.disabled = true;
  input.disabled = true;
}

function reportHeight() {
  var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  window.parent.postMessage({ type: 'SELTRA_HEIGHT', height: h }, '*');
}
window.addEventListener('load', function() { reportHeight(); setTimeout(reportHeight, 500); setTimeout(reportHeight, 1500); });
</script>`
}

// ── Assemble HTML ─────────────────────────────────────────────────────────────
function buildStorefront(input: StorefrontCodegenInput, manifest: StoreManifest): string {
  const { blueprint } = input
  const displayName = getDisplayName(blueprint)
  const logoUrl = (blueprint as unknown as { logoUrl?: string }).logoUrl
  const payments = (input.paymentGateways ?? ['Moolre']).join(' · ')
  const currency = input.products[0]?.currency ?? 'GHS'
  const features = safeArr(blueprint.storeFeatures).slice(0, 5)
  const categories = safeArr(blueprint.productCategories)
  const industry = manifest.industry ?? detectIndustry([blueprint.businessName, blueprint.businessType ?? ''].join(' '))

  const fonts = [...new Set([manifest.typography.headingFont, manifest.typography.bodyFont])]
  const fontParam = fonts.map(f => `family=${f.replace(/ /g, '+')}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700`).join('&')

  const sectionsHtml = manifest.sections
    .map(s => renderSection(s, input, features, categories, industry))
    .filter(Boolean)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<!-- SELTRA_MANIFEST: ${JSON.stringify({ sections: manifest.sections, palette: manifest.palette, typography: manifest.typography })} -->
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(displayName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fontParam}&display=swap" rel="stylesheet">
<style>
${buildCSS(manifest, blueprint)}
</style>
</head>
<body>

<nav class="nav">
  <div>
    <div class="nav-brand">${logoUrl ? `<img src="${esc(logoUrl)}" alt="" style="width:2rem;height:2rem;border-radius:999px;object-fit:cover;vertical-align:middle;margin-right:.5rem">` : ''}${esc(displayName)}</div>
    <div class="nav-sub">${esc(blueprint.businessType ?? '')}</div>
  </div>
  <div class="nav-right">
    <button class="nav-cart" onclick="toggleCart()" aria-label="Open cart">
      🛒 <span class="cart-badge" id="cart-badge"></span>
    </button>
  </div>
</nav>

${sectionsHtml}

<footer class="footer">
  <div>
    <div class="footer-brand">${esc(displayName)}</div>
    <div class="footer-tagline">${esc(blueprint.targetAudience ?? '')}</div>
    <div style="margin-top:.5rem;font-size:.68rem;opacity:.5">Powered by <strong>Seltra</strong></div>
  </div>
  <div>${esc(payments)}</div>
</footer>

<!-- Cart overlay + drawer -->
<div class="cart-overlay" id="cart-overlay" onclick="closeCart()"></div>
<div class="cart-drawer" id="cart-drawer">
  <div class="cart-head">
    <span class="cart-head-title">Your cart</span>
    <button class="cart-close" onclick="closeCart()" aria-label="Close cart">✕</button>
  </div>
  <div class="cart-body" id="cart-body">
    <div class="cart-empty">Your cart is empty</div>
  </div>
  <div class="cart-foot">
    <div class="cart-total-row">
      <span class="cart-total-label">Total</span>
      <span class="cart-total-val" id="cart-total">${currency} 0.00</span>
    </div>
    <button class="checkout-btn" id="checkout-btn" onclick="checkout()" disabled>${esc(ctaLabel(blueprint, 'checkout', 'Checkout ->'))}</button>
  </div>
</div>

<!-- Toast notification -->
<div class="toast" id="toast">
  <img class="toast-img" src="" alt="">
  <div class="toast-text">
    <div class="toast-name"></div>
    <div class="toast-label">Added to cart</div>
  </div>
</div>

${buildJS(currency)}
</body>
</html>`
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateStorefrontCode(input: StorefrontCodegenInput): Promise<StorefrontCodegenResult> {
  const manifest = await getManifest(input)
  const html     = buildStorefront(input, manifest)

  //Post-render validation
  const validationReport = validateStorefrontHtml(html, input.blueprint.businessName)

  if (!validationReport.passed) {
    const repairs = resolveRepairs(validationReport)
    const needsFullRegen = repairs.some(r => r.type === 'full_regeneration')

    if (needsFullRegen) {
      console.warn('[Codegen] Validator triggered full regeneration')
      //One retry — if it fails again, serve the first attempt rather than crashing
      try {
        const retryManifest = await getManifest(input)
        const retryHtml     = buildStorefront(input, retryManifest)
        const retryReport   = validateStorefrontHtml(retryHtml, input.blueprint.businessName)
        if (retryReport.score >= validationReport.score) {
          console.log(`[Codegen] Retry succeeded — score improved from ${validationReport.score} to ${retryReport.score}`)
          const sections = retryManifest.sections.map((s: { type: string }) => s.type).join(', ')
          return { success: true, html: retryHtml, provider: 'manifest+programmatic-v4+self-healed', error: null }
        }
      } catch (e) {
        console.warn('[Codegen] Retry failed, serving original output:', e)
      }
    }
  }

  const sections = manifest.sections.map((s: { type: string }) => s.type).join(', ')
  console.log(`[Codegen] Built storefront — ${html.length} chars | sections: ${sections} | validator: ${validationReport.score}/100`)
  return {
    success: true,
    html,
    provider: `manifest+programmatic-v4+critic:${validationReport.score}`,
    error: null,
  }
}

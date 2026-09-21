//store/store.service.ts
import { Injectable, NotFoundException, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { JwtService } from '@nestjs/jwt'
import { generateBlueprint, generateProducts, classifyLayout, generateManifest, generateHeroNavSources } from '../ai'
import { buildImagePromptPrefix, extractDNA } from '../ai/agents/dna.agent'
import { generateHeroImage } from '../ai/providers/cloudflare-images'
import { buildPlan } from '../ai/agents/plan.agent'
import { prisma } from '../db'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import type { CanonicalStore, GeneratedProduct } from '../types'
import type { StoreDNA } from '../types/store-dna'
import type { BuildContext } from './build-events.service'
import { getStoreCreationError, planLimits } from '../common/plan-limits'
import * as crypto from 'crypto'

type PlannerAnswers = {
  fulfillment_mode?: string
  contact_number?: string
  delivery_tiers?: string
  product_variants?: string
}

type DeliveryTier = {
  id: string
  label: string
  description: string
  priceFrom: number
  currency: string
  areas?: string[]
  etaLabel?: string
}

function slugifyTier(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'delivery'
}

function parseDeliveryTiers(answer?: string): DeliveryTier[] | null {
  if (!answer || !/multiple|standard|express|same[-\s]?day|ghs|cedi|\$|price|tier|speed/i.test(answer)) return null
  if (/one flat|single|later|set this up later/i.test(answer)) return null

  const lines = answer
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
  const sourceLines = lines.length > 1 ? lines : answer.split(/,(?=\s*(standard|express|same[-\s]?day|pickup|delivery)\b)/i).map((line) => line.trim()).filter(Boolean)
  const tiers = sourceLines
    .map((line): DeliveryTier | null => {
      const labelMatch = line.match(/\b(standard|express|same[-\s]?day|premium|economy|regular)\b/i)
      const priceMatch = line.match(/(?:GHS|GH₵|₵|\$)?\s*(\d+(?:\.\d{1,2})?)/i)
      if (!labelMatch && !priceMatch) return null
      const rawLabel = labelMatch?.[1] ?? line.split(/[-:]/)[0]?.trim() ?? 'Delivery'
      const label = `${rawLabel.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())} Delivery`
      const currency = /\$/.test(line) ? 'USD' : 'GHS'
      const areaMatch = line.match(/(?:areas?|covers?|within)\s*[:\-]?\s*([^.;]+)/i)
      const areas = areaMatch?.[1]
        ?.split(',')
        .map((area) => area.trim())
        .filter(Boolean)
      const etaMatch = line.match(/(\d+\s*[-–]\s*\d+\s*(?:working\s*)?(?:days?|hrs?|hours?)|same[-\s]?day|next[-\s]?day|order before [^.;]+)/i)
      return {
        id: slugifyTier(rawLabel),
        label,
        description: line,
        priceFrom: Number(priceMatch?.[1] ?? 0),
        currency,
        ...(areas && areas.length > 0 ? { areas } : {}),
        ...(etaMatch?.[1] ? { etaLabel: etaMatch[1] } : {}),
      }
    })
    .filter((tier): tier is DeliveryTier => Boolean(tier))

  return tiers.length > 0 ? tiers : null
}

function defaultDeliveryTiers(blueprint: CanonicalStore, detail: string): DeliveryTier[] {
  const localAreas = inferLocalAreas(detail)
  const country = /ghana|accra|kumasi|tema|madina|spintex|east legon|ashaley/i.test(detail) ? 'Ghana' : 'your area'
  return [
    {
      id: 'standard',
      label: 'Standard Delivery',
      description: `2-4 working days across ${country}`,
      priceFrom: 35,
      currency: 'GHS',
    },
    {
      id: 'express',
      label: 'Express Delivery',
      description: '1-2 working days for priority orders',
      priceFrom: 55,
      currency: 'GHS',
    },
    {
      id: 'same-day',
      label: 'Same-Day Delivery',
      description: `Same-day dispatch for nearby ${blueprint.businessType.toLowerCase()} customers`,
      priceFrom: 75,
      currency: 'GHS',
      areas: localAreas.length > 0 ? localAreas : ['Ashaley Botwe', 'Lakeside', 'East Legon', 'Spintex', 'Madina'],
      etaLabel: 'Order before 12pm',
    },
  ]
}

function inferLocalAreas(detail: string): string[] {
  const knownAreas = ['Ashaley Botwe', 'Lakeside', 'East Legon', 'Spintex', 'Madina', 'Tema', 'Osu', 'Adenta', 'Kumasi', 'Accra']
  return knownAreas.filter((area) => new RegExp(`\\b${area.replace(/\s+/g, '\\s+')}\\b`, 'i').test(detail))
}

function normalizeFulfillmentMode(answer?: string): 'delivery' | 'pickup' | 'both' {
  if (!answer) return 'delivery'
  const normalized = answer.trim().toLowerCase()
  if (/\bpickup only\b|\bcollection only\b|\bpick up only\b|\bpick up\b|\bcollect only\b/i.test(normalized)) return 'pickup'
  if (/\bboth\b|\bdelivery and pickup\b|\bpickup and delivery\b|\bcollect or deliver\b|\bdeliver or pickup\b|\bdelivery or pickup\b/i.test(normalized)) return 'both'
  if (/\bpickup\b|\bcollect\b/i.test(normalized) && /\bdeliver\b|\bdelivery\b|\bship\b/i.test(normalized)) return 'both'
  if (/\bpickup\b|\bcollect\b/i.test(normalized)) return 'pickup'
  return 'delivery'
}

function parsePlannerDeliveryTiers(answer?: string, blueprint?: CanonicalStore): DeliveryTier[] | null {
  return null
}

function wantsAutonomousVariants(prompt: string, blueprint: CanonicalStore, plannerAnswers?: PlannerAnswers): boolean {
  const detail = [
    prompt,
    plannerAnswers?.product_variants,
    blueprint.businessType,
    ...blueprint.productCategories,
  ].filter(Boolean).join('\n')
  if (/\b(no|none|single option|one option|no variants|without variants)\b/i.test(detail)) return false
  return /\b(yes|yeah|yep|we do|they do|variants?|sizes?|colou?rs?|lengths?|flavou?rs?|scents?|packs?|bundles?|ready-to-wear|fashion|clothing|apparel|shoes?|beauty|skincare|food|bakery)\b/i.test(detail)
}

function hasOnlyGenericVariants(product: GeneratedProduct): boolean {
  const variants = product.variants ?? []
  if (variants.length === 0) return true
  return variants.every((variant) =>
    /^(option|type|tier)$/i.test(variant.name) && /^(standard|premium|basic|regular)$/i.test(variant.value),
  )
}

function inferVariantsForProduct(product: GeneratedProduct, blueprint: CanonicalStore, prompt: string) {
  const detail = [
    prompt,
    blueprint.businessType,
    product.category,
    product.name,
    product.description,
    ...blueprint.productCategories,
  ].filter(Boolean).join(' ')

  if (/shoe|sneaker|heel|sandal|footwear/i.test(detail)) {
    return [
      { name: 'Shoe Size', value: '38' },
      { name: 'Shoe Size', value: '39' },
      { name: 'Shoe Size', value: '40' },
      { name: 'Shoe Size', value: '41' },
      { name: 'Color', value: 'Black' },
      { name: 'Color', value: 'Brown' },
    ]
  }

  if (/fashion|clothing|apparel|wear|shirt|dress|trouser|skirt|kaftan|ready-to-wear/i.test(detail)) {
    return [
      { name: 'Size', value: 'Small' },
      { name: 'Size', value: 'Medium' },
      { name: 'Size', value: 'Large' },
      { name: 'Size', value: 'XL' },
      { name: 'Color', value: 'Black' },
      { name: 'Color', value: 'White' },
      { name: 'Color', value: 'Navy' },
    ]
  }

  if (/beauty|skin|hair|cream|oil|lotion|soap|serum|fragrance|perfume|scent/i.test(detail)) {
    return [
      { name: 'Size', value: 'Travel' },
      { name: 'Size', value: 'Regular' },
      { name: 'Size', value: 'Family' },
      { name: 'Scent', value: 'Original' },
      { name: 'Scent', value: 'Unscented' },
    ]
  }

  if (/food|bakery|snack|drink|juice|meal|cake|pastry|grocery/i.test(detail)) {
    return [
      { name: 'Pack Size', value: 'Single' },
      { name: 'Pack Size', value: 'Box of 6' },
      { name: 'Pack Size', value: 'Box of 12' },
    ]
  }

  return [
    { name: 'Option', value: 'Standard' },
    { name: 'Option', value: 'Premium' },
  ]
}

function applyAutonomousVariants(
  products: GeneratedProduct[],
  blueprint: CanonicalStore,
  prompt: string,
  plannerAnswers?: PlannerAnswers,
): GeneratedProduct[] {
  if (!wantsAutonomousVariants(prompt, blueprint, plannerAnswers)) return products
  return products.map((product) => {
    if (!hasOnlyGenericVariants(product)) return product
    return {
      ...product,
      variants: inferVariantsForProduct(product, blueprint, prompt),
    }
  })
}

type CreateStoreInput = {
  name: string
  businessType?: string
  targetAudience?: string
  prompt: string
  plannerAnswers?: PlannerAnswers
  requestedProductCount?: number
  requestedCategories?: string[]
}

// Dedupe concurrent/duplicate submissions of the identical prompt from the
// same caller (double-click, React effect firing twice, retry-on-reconnect).
// This is what was producing two tenants for one submission — one from the
// real LLM blueprint, one from the deterministic fallback that ran on the
// second, colliding call — and throwing P2002 on slug.
const inFlightStoreCreations = new Map<string, Promise<any>>()

function buildCreationKey(ownerId: string | undefined, prompt: string): string {
  return crypto
    .createHash('sha256')
    .update(`${ownerId ?? 'guest'}::${prompt.trim()}`)
    .digest('hex')
}

function emitFileChunks(ctx: BuildContext | undefined, file: string, content: string) {
  if (!ctx) return
  const chunkSize = 220
  for (let i = 0; i < content.length; i += chunkSize) {
    ctx.emit({ type: 'chunk', file, content: content.slice(i, i + chunkSize) })
  }
}

// Slugs must be safe as a DNS label: lowercase letters, numbers, and single
// hyphens, no leading/trailing hyphen, 3-63 chars.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

function normalizeAndValidateSlug(rawSlug: string): string {
  const slug = rawSlug.trim().toLowerCase()
  if (!SLUG_PATTERN.test(slug) || slug.length < 3 || slug.length > 63) {
    throw new BadRequestException(
      'Subdomain must be 3-63 characters: lowercase letters, numbers, and hyphens only (no leading, trailing, or double hyphens).',
    )
  }
  return slug
}

@Injectable()
export class StoreService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantEvents: TenantEventsService,
  ) {}

  async create(input: CreateStoreInput, authorization?: string, ctx?: BuildContext) {
    const prompt = [input.name, input.businessType, input.targetAudience, input.prompt]
      .filter(Boolean)
      .join('\n')
    const ownerId = await this.getUserIdFromAuth(authorization, false)
    const result = await this.createFromPrompt(
      prompt,
      ownerId,
      ctx,
      input.plannerAnswers,
      input.requestedProductCount,
      input.requestedCategories,
    )
    return result.tenant
  }

  async checkStoreCreationLimit(authorization?: string) {
    const ownerId = await this.getUserIdFromAuth(authorization, false)
    if (!ownerId) {
      return { allowed: true }
    }

    const [currentStoreCount, owner] = await Promise.all([
      prisma.tenant.count({ where: { ownerId } }),
      prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } }),
    ])

    const reason = getStoreCreationError(owner?.plan, currentStoreCount)
    return {
      allowed: !reason,
      reason: reason ?? undefined,
    }
  }

  async createFromPrompt(
    prompt: string,
    ownerId?: string,
    ctx?: BuildContext,
    plannerAnswers?: PlannerAnswers,
    requestedProductCount?: number,
    requestedCategories?: string[],
  ) {
    const key = buildCreationKey(ownerId, prompt)
    const existing = inFlightStoreCreations.get(key)
    if (existing) {
      console.warn(
        '[Store] Duplicate createFromPrompt call detected for identical prompt — reusing in-flight build instead of creating a second tenant',
      )
      return existing
    }

    const runPromise = this.createFromPromptInner(prompt, ownerId, ctx, plannerAnswers)
    inFlightStoreCreations.set(key, runPromise)
    try {
      return await runPromise
    } finally {
      inFlightStoreCreations.delete(key)
    }
  }

  private async createFromPromptInner(
    prompt: string,
    ownerId?: string,
    ctx?: BuildContext,
    plannerAnswers?: PlannerAnswers,
    requestedProductCount?: number,
    requestedCategories?: string[],
  ) {
    // Resolve product cap up front so it's available to every generateProducts() call below.
    let maxProducts = planLimits(undefined).maxProductsPerStore // free-tier default for guests
    if (ownerId) {
      const [existingCount, owner] = await Promise.all([
        prisma.tenant.count({ where: { ownerId } }),
        prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true } }),
      ])
      const { maxProductsPerStore } = planLimits(owner?.plan)
      maxProducts = maxProductsPerStore
      const storeError = getStoreCreationError(owner?.plan, existingCount)
      if (storeError) {
        throw new Error(storeError)
      }
    }
    // Respect merchant-provided requestedProductCount but cap to plan's max
    const requestedCount = typeof requestedProductCount === 'number' && requestedProductCount > 0
      ? Math.floor(requestedProductCount)
      : undefined
    ctx?.emit({ type: 'step', step: 'intent', status: 'started', label: 'Business intent' })
    ctx?.emit({ type: 'log', message: 'Reading merchant prompt...' })
    ctx?.emit({ type: 'step', step: 'blueprint', status: 'started', label: 'Blueprint' })
    ctx?.emit({ type: 'log', message: 'Generating store blueprint...' })
    const blueprintResult = await generateBlueprint(prompt)

    if (!blueprintResult.data) {
      throw new Error('Could not generate store blueprint — no data returned')
    }

    const blueprint = blueprintResult.data
    // If merchant supplied categories, prefer those over inferred categories
    if (Array.isArray(requestedCategories) && requestedCategories.length > 0) {
      blueprint.productCategories = requestedCategories
      ctx?.emit({ type: 'log', message: `Using merchant-provided categories: ${requestedCategories.join(', ')}` })
    }
    // Determine how many products to generate (merchant requested vs plan cap)
    const desiredProductCount = typeof requestedCount === 'number'
      ? Math.min(requestedCount, maxProducts)
      : maxProducts
    if (typeof requestedCount === 'number' && desiredProductCount < requestedCount) {
      ctx?.emit({ type: 'log', message: `Requested ${requestedCount} products; capped to ${desiredProductCount} by plan limits.` })
    }
    ctx?.emit({ type: 'step', step: 'intent', status: 'completed', label: 'Business intent' })
    ctx?.emit({ type: 'step', step: 'blueprint', status: 'completed', label: 'Blueprint' })
    ctx?.emit({ type: 'file', name: 'Blueprint.json', status: 'started' })
    emitFileChunks(ctx, 'Blueprint.json', JSON.stringify(blueprint, null, 2))
    ctx?.emit({ type: 'file', name: 'Blueprint.json', status: 'completed' })

    // ── Extract StoreDNA synchronously — zero LLM tokens, rule-based ──
    ctx?.emit({ type: 'step', step: 'dna', status: 'started', label: 'Brand DNA' })
    ctx?.emit({ type: 'log', message: 'Extracting brand DNA...' })
    const dna = extractDNA(
      prompt,
      blueprint.businessType ?? undefined,
      blueprint.targetAudience ?? undefined,
    )
    ctx?.emit({ type: 'step', step: 'dna', status: 'completed', label: 'Brand DNA' })
    ctx?.emit({ type: 'file', name: 'StoreDNA.json', status: 'started' })
    emitFileChunks(ctx, 'StoreDNA.json', JSON.stringify(dna, null, 2))
    ctx?.emit({ type: 'file', name: 'StoreDNA.json', status: 'completed' })

    ctx?.emit({ type: 'step', step: 'products', status: 'started', label: 'Products' })
    ctx?.emit({ type: 'log', message: 'Generating launch-ready product catalog...' })
    const [productResult, layoutResult] = await Promise.all([
      generateProducts(blueprint, desiredProductCount, dna, (url, index) => {
        ctx?.emit({
          type: 'image',
          role: 'product',
          url,
          label: index < 3 ? 'Product concept preview' : 'More product concept previews',
        })
      }),
      classifyLayout(blueprint),
    ])

    let products = (productResult.products ?? []).length > 0
      ? productResult.products
      : []

    if (products.length === 0) {
      console.warn('[Store] Product generation returned 0 products — forcing deterministic fallback')
      ctx?.emit({ type: 'log', message: 'Product agent returned no products; switching to deterministic fallback...' })
      const savedFlag = process.env.SELTRA_LLM_PRODUCTS
      process.env.SELTRA_LLM_PRODUCTS = 'false'
      try {
        const fallbackResult = await generateProducts(blueprint, maxProducts, dna)
        products = fallbackResult.products
      } finally {
        process.env.SELTRA_LLM_PRODUCTS = savedFlag
      }
      console.log(`[Store] Fallback generated ${products.length} products`)
    }
    products = applyAutonomousVariants(products, blueprint, prompt, plannerAnswers)
    ctx?.emit({ type: 'step', step: 'products', status: 'completed', label: 'Products' })
    ctx?.emit({ type: 'file', name: 'Products.json', status: 'started' })
    emitFileChunks(ctx, 'Products.json', JSON.stringify(products, null, 2))
    ctx?.emit({ type: 'file', name: 'Products.json', status: 'completed' })

    // P0.2 — a plan derived from THIS prompt's actual blueprint/DNA/product count,
    // not a static 10-step list. Zero extra LLM calls — this is data we already have.
    const plan = buildPlan(blueprint, dna, products.length)
    ctx?.emit({ type: 'plan', items: plan })

    console.log(`[Store] Blueprint ready. Products to create: ${products.length}`)
    console.log(`[Store] StoreDNA: industry=${dna.industry}, personality=${dna.brandPersonality}, hero=${dna.heroStyle}`)

    ctx?.emit({ type: 'step', step: 'payments', status: 'started', label: 'Payments' })
    ctx?.emit({ type: 'log', message: 'Creating tenant, categories, products, and payment providers...' })
    const tenant = await this.createFromBlueprint(
      blueprint,
      products,
      layoutResult.variant,
      ownerId,
      undefined,
    )

    const mode = normalizeFulfillmentMode(plannerAnswers?.fulfillment_mode)
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        fulfillmentMode: mode,
        ...(plannerAnswers?.contact_number !== undefined ? { contactPhone: plannerAnswers.contact_number } : {}),
        deliveryTiers: Prisma.JsonNull,
      },
    })
    ctx?.emit({ type: 'step', step: 'payments', status: 'completed', label: 'Payments' })

    // ── Persist StoreDNA to tenant in background (non-blocking) ──
    prisma.tenant.update({
      where: { id: tenant.id },
      data: {  storeDNA: JSON.parse(JSON.stringify(dna)), },
    }).catch((err) =>
      console.warn(`[Store] Failed to persist storeDNA for ${tenant.id}:`, err),
    )

    let completedTenant = tenant

    // Normal API calls return once the tenant exists. Build sessions await the
    // full asset pipeline so the final SSE "done" event reflects real completion.
    if (ctx) {
      await this.generateAndSaveStorefrontAssets(tenant.id, blueprint, dna, ctx)
      completedTenant = await this.findByIdOrSlug(tenant.id)
    } else {
      this.generateAndSaveStorefrontAssets(tenant.id, blueprint, dna)
        .catch((err) =>
          console.error(`[StorefrontAssets] Background generation failed for ${tenant.id}:`, err),
        )
    }

    return {
      tenant: completedTenant,
      blueprint,
      dna,
      provider: blueprintResult.provider,
      layoutVariant: layoutResult.variant,
      storefrontCodeProvider: 'pending',
    }
  }

  private async generateAndSaveStorefrontAssets(
    tenantId: string,
    blueprint: CanonicalStore,
    dna?: StoreDNA,
    ctx?: BuildContext,
  ) {
    try {
      console.log(`[StorefrontAssets] Starting background generation for tenant ${tenantId}`)
      ctx?.emit({ type: 'step', step: 'manifest', status: 'started', label: 'Manifest' })
      ctx?.emit({ type: 'log', message: 'Planning and composing your storefront...' })

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          products: { include: { images: true, variants: true } },
          paymentProviders: true,
        },
      })

      if (!tenant) {
        console.error(`[StorefrontAssets] Tenant ${tenantId} not found — aborting`)
        return
      }

      console.log(`[StorefrontAssets] Found ${tenant.products.length} products for tenant ${tenantId}`)

      const products = tenant.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price.toString(),
        currency: p.currency,
        category: p.category,
        images: p.images as Array<{ url: string; isPrimary?: boolean }>,
        variants: p.variants,
      }))

      const storeDNA = (tenant.storeDNA ?? dna ?? null) as StoreDNA | null

      // P0.1 — the critic/refinement loop now runs inside generateManifest() itself.
      // These hooks just surface it as its own visible build step instead of it
      // happening silently between "Manifest" and "Hero".
      const manifestResult = await generateManifest(blueprint, storeDNA, products, {
        onCritiqueStart: () => {
          ctx?.emit({ type: 'step', step: 'critique', status: 'started', label: 'Design review' })
          ctx?.emit({ type: 'log', message: 'Reviewing layout against the storefront quality bar...' })
        },
        onCritiqueEnd: (score, fixesApplied) => {
          const fixNote = fixesApplied > 0 ? ` — ${fixesApplied} refinement${fixesApplied === 1 ? '' : 's'} applied` : ' — no fixes needed'
          ctx?.emit({ type: 'log', message: `Design score: ${score}/100${fixNote}` })
          ctx?.emit({ type: 'step', step: 'critique', status: 'completed', label: 'Design review' })
        },
      })

      ctx?.emit({ type: 'file', name: 'Manifest.json', status: 'started' })
      emitFileChunks(ctx, 'Manifest.json', JSON.stringify(manifestResult.manifest, null, 2))
      ctx?.emit({ type: 'file', name: 'Manifest.json', status: 'completed' })
      ctx?.emit({ type: 'step', step: 'manifest', status: 'completed', label: 'Manifest' })

      ctx?.emit({ type: 'step', step: 'hero', status: 'started', label: 'Hero' })
      ctx?.emit({ type: 'step', step: 'nav', status: 'started', label: 'Navigation' })
      ctx?.emit({ type: 'log', message: 'Designing a beautiful shopping experience...' })
      let heroImageUrl: string | null = null
      const productHeroImageUrl = products
        .flatMap((product) => product.images?.map((image) => image.url).filter(Boolean) ?? [])
        .find((url): url is string => typeof url === 'string' && url.length > 0) ?? null
      if (storeDNA) {
        const heroImagePrompt = `${buildImagePromptPrefix(storeDNA)}, hero lifestyle photograph for ${blueprint.businessName}, ${blueprint.businessType}`
        ctx?.emit({ type: 'log', message: 'Crafting your storefront hero background...' })
        heroImageUrl = await generateHeroImage(heroImagePrompt)
        if (heroImageUrl) {
          ctx?.emit({ type: 'image', role: 'hero', url: heroImageUrl, label: 'Your hero photo' })
        } else {
          heroImageUrl = productHeroImageUrl
          if (heroImageUrl) {
            ctx?.emit({ type: 'image', role: 'hero', url: heroImageUrl, label: 'Hero image fallback' })
          } else {
            ctx?.emit({ type: 'log', message: 'Cloudflare hero image did not return usable image bytes; continuing with a generated gradient hero.' })
          }
        }
      } else if (productHeroImageUrl) {
        heroImageUrl = productHeroImageUrl
        ctx?.emit({ type: 'image', role: 'hero', url: heroImageUrl, label: 'Hero image fallback' })
      }
      let storyImageUrl: string | null = null
      if (storeDNA) {
        try {
          const storyImagePrompt = `${buildImagePromptPrefix(storeDNA)}, lifestyle photograph representing the story and craft behind ${blueprint.businessName}`
          storyImageUrl = await generateHeroImage(storyImagePrompt)
          if (storyImageUrl) {
            ctx?.emit({ type: 'image', role: 'story', url: storyImageUrl, label: 'Your story photo' })
          }
        } catch {
          ctx?.emit({ type: 'log', message: 'Story image generation was skipped; continuing with the storefront build.' })
        }
      }

      const micro = await generateHeroNavSources({
        blueprint,
        manifest: manifestResult.manifest,
        dna: storeDNA,
        heroImageUrl,
        products,
      }, storeDNA, (attempt) => {
        if (attempt.ok) {
          ctx?.emit({
            type: 'log',
            message: 'Rendering and compiling your store',
          })
          return
        }
        const reason = attempt.reason ? `: ${attempt.reason}` : ''
        ctx?.emit({
          type: 'log',
          message: `[${attempt.role}] ${attempt.model} attempt ${attempt.attempt} rejected${reason}`,
        })
      })
      ctx?.emit({ type: 'file', name: 'Hero.tsx', status: 'started' })
      emitFileChunks(ctx, 'Hero.tsx', micro.heroSource ?? '// Fallback: deterministic HeroSection')
      ctx?.emit({ type: 'file', name: 'Hero.tsx', status: 'completed' })
      ctx?.emit({ type: 'file', name: 'Navbar.tsx', status: 'started' })
      emitFileChunks(ctx, 'Navbar.tsx', micro.navSource ?? '// Fallback: deterministic DefaultNav')
      ctx?.emit({ type: 'file', name: 'Navbar.tsx', status: 'completed' })
      ctx?.emit({ type: 'step', step: 'hero', status: 'completed', label: 'Hero' })
      ctx?.emit({ type: 'step', step: 'nav', status: 'completed', label: 'Navigation' })

      ctx?.emit({ type: 'step', step: 'compile', status: 'started', label: 'Compile' })
      ctx?.emit({ type: 'log', message: 'Saving generated assets and refreshing preview...' })
      const manifestJson = JSON.stringify(manifestResult.manifest)
      const heroGeneratedAt = micro.heroSource ? new Date() : null
      const navGeneratedAt = micro.navSource ? new Date() : null

      const canonical = (tenant.canonical as Record<string, unknown> | null) ?? {}
      const canonicalWithHero = {
        ...canonical,
        heroSpec: micro.heroSpec,
        ...(heroImageUrl ? { heroImageUrl } : {}),
        ...(storyImageUrl ? { storyImageUrl } : {}),
      }

      try {
        await prisma.$executeRaw`
          UPDATE "Tenant"
          SET
            "manifest" = ${manifestJson}::jsonb,
            "heroSource" = ${micro.heroSource},
            "heroGeneratedAt" = ${heroGeneratedAt},
            "navSource" = ${micro.navSource},
            "navGeneratedAt" = ${navGeneratedAt},
            "canonical" = ${JSON.stringify(canonicalWithHero)}::jsonb,
            "updatedAt" = NOW()
          WHERE "id" = ${tenantId}
        `
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const stack = err instanceof Error ? err.stack : undefined
        console.error(`[StorefrontAssets] executeRaw failed for ${tenantId}: ${message}`, stack ?? err)
        throw err
      }

      void this.tenantEvents.recordForTenant(tenantId, 'theme_updated', {
        manifestProvider: manifestResult.provider,
        heroNavProvider: micro.provider,
      })
      void this.tenantEvents.recordForTenant(tenantId, 'ai_invocation', {
        chunk: 'storefront_assets',
        model: [manifestResult.provider, micro.provider].filter(Boolean).join(','),
      })
      ctx?.emit({ type: 'step', step: 'compile', status: 'completed', label: 'Compile' })
      ctx?.emit({ type: 'step', step: 'deploy', status: 'started', label: 'Preview' })
      ctx?.emit({ type: 'step', step: 'deploy', status: 'completed', label: 'Deploy' })
      console.log(`[StorefrontAssets] Done for tenant ${tenantId} — manifest=${manifestResult.provider}; ${micro.provider}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      console.error(`[StorefrontAssets] FAILED for tenant ${tenantId}: ${message}`, stack ?? err)
      ctx?.emit({ type: 'log', message: `Storefront asset generation failed: ${message}` })
      throw err
    }
  }

  async createFromBlueprint(
    blueprint: CanonicalStore,
    products: GeneratedProduct[],
    layoutVariant: 'editorial' | 'grid' | 'bold' = 'grid',
    ownerId?: string,
    storefrontCode?: string,
  ) {
    const slug = await this.uniqueSlug(blueprint.storeSlug)

    console.log(
      `[Store] Creating tenant "${blueprint.businessName}" with slug "${slug}" and ${products.length} products`,
    )

    try {
      const tenant = await prisma.tenant.create({
        data: {
          ownerId,
          name: blueprint.businessName,
          slug,
          businessType: blueprint.businessType,
          targetAudience: blueprint.targetAudience,
          platform: 'Seltra',
          status: 'active',
          canonical: {
            ...(blueprint as object),
            layoutVariant,
          },
          storeUrl: `${slug}.seltra.co`,
          storefrontCode: storefrontCode ?? null,
          storefrontVersion: storefrontCode ? 1 : 0,
          storefrontGeneratedAt: storefrontCode ? new Date() : null,
          categories: {
            create: blueprint.productCategories.map((name) => ({ name })),
          },
          paymentProviders: {
            create: blueprint.recommendedTechStack.paymentGateways.map((provider) => ({
              provider,
              config: {},
            })),
          },
          products: {
            create: products.map((product, index) => {
              const priceStr = product.price != null ? String(product.price) : '0'
              const tags = Array.isArray(product.tags) ? product.tags.map(String) : []

              console.log(
                `[Store]   Product[${index}]: "${product.name}" price="${priceStr}" category="${product.category}"`,
              )

              return {
                name: product.name,
                description: product.description ?? null,
                price: priceStr,
                currency: product.currency || 'GHS',
                category: product.category ?? null,
                sku: product.sku ?? null,
                tags,
                status: 'active',
                images: {
                  create: (product.images ?? [])
                    .filter((img) => Boolean(img?.url))
                    .map((image) => ({
                      url: image.url,
                      isPrimary: image.isPrimary ?? true,
                    })),
                },
                variants: {
                  create: (product.variants ?? [])
                    .filter((v) => v?.name && v?.value)
                    .map((variant) => ({
                      name: variant.name,
                      value: variant.value,
                    })),
                },
              }
            }),
          },
        },
        include: this.storeInclude(),
      })

      console.log(`[Store] Created tenant ${tenant.id} with ${tenant.products.length} products`)
      return tenant
    } catch (err) {
      console.error('[Store] prisma.tenant.create failed:', err)
      throw err
    }
  }

  async patchStorefrontCode(storeId: string, newHtml: string) {
    const existing = await prisma.tenant.findUnique({
      where: { id: storeId },
      select: { storefrontVersion: true },
    })
    const updated = await prisma.tenant.update({
      where: { id: storeId },
      data: {
        storefrontCode: newHtml,
        storefrontVersion: (existing?.storefrontVersion ?? 0) + 1,
        storefrontGeneratedAt: new Date(),
      },
    })
    void this.tenantEvents.recordForTenant(storeId, 'theme_updated', { source: 'storefront_code_patch' })
    return updated
  }

  async regenerateStorefrontCode(storeId: string) {
    const store = await this.findByIdOrSlug(storeId)
    const canonical = (store.canonical ?? {}) as Record<string, unknown>
    const blueprint = canonical as unknown as CanonicalStore

    await this.generateAndSaveStorefrontAssets(store.id, blueprint)
    return this.findByIdOrSlug(store.id)
  }

  async findBySlug(slug: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      include: this.storeInclude(),
    })
    if (!tenant) throw new NotFoundException(`Store "${slug}" not found`)
    return this.withDerivedFields(tenant)
  }

  async findByIdOrSlug(idOrSlug: string) {
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: this.storeInclude(),
    })
    if (!tenant) throw new NotFoundException(`Store "${idOrSlug}" not found`)
    return tenant
  }

  async findMine(authorization?: string) {
    const ownerId = await this.getUserIdFromAuth(authorization, true)
    return prisma.tenant.findMany({
      where: { ownerId },
      include: this.storeInclude(),
      orderBy: { updatedAt: 'desc' },
    })
  }

  async update(
    id: string,
    data: {
      name?: string
      businessType?: string
      targetAudience?: string
      region?: string
      country?: string
      language?: string
      dismissedAnnouncements?: string[]
      payoutMethod?: string
      payoutProvider?: string
      payoutProviderCode?: string
      payoutAccount?: string
      slug?: string
      fulfillmentMode?: string
      contactPhone?: string
      pickupAddress?: string
      pickupInstructions?: string
      deliveryDays?: string
      deliveryEstimate?: string
      deliveryFeeNote?: string
      deliveryTiers?: DeliveryTier[] | null
    },
    authorization?: string,
  ) {
    const ownerId = await this.getUserIdFromAuth(authorization, true)
    const tenant = await prisma.tenant.findUnique({ where: { id } })
    if (!tenant || (tenant.ownerId && tenant.ownerId !== ownerId)) {
      throw new NotFoundException(`Store "${id}" not found`)
    }

    // ── Subdomain rename: only touches slug/storeUrl, everything else on the
    // tenant (products, orders, payments, etc.) is untouched and keyed by id. ──
    let nextSlug: string | undefined
    if (data.slug !== undefined && data.slug !== tenant.slug) {
      nextSlug = normalizeAndValidateSlug(data.slug)
      const taken = await prisma.tenant.findFirst({
        where: { slug: nextSlug, NOT: { id } },
        select: { id: true },
      })
      if (taken) {
        throw new ConflictException('That subdomain is already taken. Please choose another.')
      }
    }

    const preferences = {
      ...((tenant.preferences as Record<string, unknown> | null) ?? {}),
      ...(data.region ? { region: data.region } : {}),
      ...(data.language ? { language: data.language } : {}),
      ...(data.dismissedAnnouncements ? {
        dismissedAnnouncements: [...new Set([
          ...(((tenant.preferences as Record<string, unknown> | null)?.dismissedAnnouncements as string[] | undefined) ?? []),
          ...data.dismissedAnnouncements,
        ])],
      } : {}),
    }

    // Only include fulfillment-related keys that were actually passed in, so
    // partial PATCHes (e.g. from the dedicated /fulfillment endpoint) never
    // clobber fields the merchant didn't touch.
    const fulfillmentFields: Record<string, unknown> = {}
    if (data.fulfillmentMode !== undefined) fulfillmentFields.fulfillmentMode = data.fulfillmentMode
    if (data.contactPhone !== undefined) fulfillmentFields.contactPhone = data.contactPhone
    if (data.pickupAddress !== undefined) fulfillmentFields.pickupAddress = data.pickupAddress
    if (data.pickupInstructions !== undefined) fulfillmentFields.pickupInstructions = data.pickupInstructions
    if (data.deliveryDays !== undefined) fulfillmentFields.deliveryDays = data.deliveryDays
    if (data.deliveryEstimate !== undefined) fulfillmentFields.deliveryEstimate = data.deliveryEstimate
    if (data.deliveryFeeNote !== undefined) fulfillmentFields.deliveryFeeNote = data.deliveryFeeNote
    if (data.deliveryTiers !== undefined) fulfillmentFields.deliveryTiers = data.deliveryTiers

    const updateData = {
      name: data.name,
      businessType: data.businessType,
      targetAudience: data.targetAudience,
      country: data.country,
      preferences,
      payoutMethod: data.payoutMethod,
      payoutProvider: data.payoutProvider,
      payoutProviderCode: data.payoutProviderCode,
      payoutAccount: data.payoutAccount,
      ownerId: tenant.ownerId ?? ownerId,
      ...fulfillmentFields,
      ...(nextSlug ? { slug: nextSlug, storeUrl: `${nextSlug}.seltra.co` } : {}),
    }
    const updated = await prisma.tenant.update({
      where: { id },
      data: updateData,
      include: this.storeInclude(),
    })
    void this.tenantEvents.recordForTenant(id, 'settings_changed', updateData)
    return updated
  }

  async delete(id: string, authorization?: string) {
    const ownerId = await this.getUserIdFromAuth(authorization, true)
    const tenant = await prisma.tenant.findUnique({ where: { id } })
    if (!tenant || tenant.ownerId !== ownerId) {
      throw new NotFoundException(`Store "${id}" not found`)
    }
    await prisma.tenant.delete({ where: { id } })
    return { success: true }
  }

  async regenerateStorefrontCodeForOwner(storeId: string, authorization?: string) {
    const ownerId = await this.getUserIdFromAuth(authorization, true)
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId } })
    if (!tenant || tenant.ownerId !== ownerId) {
      throw new NotFoundException(`Store "${storeId}" not found`)
    }
    return this.regenerateStorefrontCode(storeId)
  }

  private async getUserIdFromAuth(authorization: string | undefined, required: true): Promise<string>
  private async getUserIdFromAuth(
    authorization: string | undefined,
    required: false,
  ): Promise<string | undefined>
  private async getUserIdFromAuth(authorization?: string, required = true) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) {
      if (required) throw new UnauthorizedException('Missing bearer token')
      return undefined
    }
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_SECRET || 'change-me',
      })
      return payload.sub
    } catch {
      if (required) throw new UnauthorizedException('Invalid bearer token')
      return undefined
    }
  }

  private withDerivedFields<T extends { canonical: unknown }>(tenant: T) {
    const canonical = tenant.canonical as Record<string, unknown>
    return {
      ...tenant,
      layoutVariant: (canonical?.layoutVariant as string) || 'grid',
      theme: canonical?.theme || {},
    }
  }

  private async uniqueSlug(baseSlug: string) {
    const base = baseSlug || `seltra-store-${Date.now()}`
    let slug = base
    let suffix = 2
    while (await prisma.tenant.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${base}-${suffix}`
      suffix += 1
    }
    return slug
  }

  private storeInclude() {
    return {
      products: { include: { images: true, variants: true } },
      categories: true,
      paymentProviders: true,
      shippingZones: true,
    } as const
  }
}

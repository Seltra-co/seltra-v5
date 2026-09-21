//store/store-image.service.ts
import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common'
import { prisma } from '../db'
import { validateImageUrl } from '../common/image-validation'
import { uploadImageBuffer } from './cloudinary.service'
import { generateHeroImage, generateProductImage } from '../ai/providers/cloudflare-images'
import { buildImagePromptPrefix } from '../ai/agents/dna.agent'
import type { StoreDNA } from '../types/store-dna'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'

const FETCH_TIMEOUT_MS = 15_000

@Injectable()
export class StoreImageService {
  private readonly logger = new Logger(StoreImageService.name)

  constructor(private readonly tenantEvents: TenantEventsService) {}

  // ── Hero image ──────────────────────────────────────────────────────────

  async regenerateHeroImage(tenantId: string, stylePrompt?: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Store not found')

    const dna = tenant.storeDNA as StoreDNA | null
    const promptPrefix = dna
      ? buildImagePromptPrefix(dna)
      : 'Professional commercial photography, polished ecommerce brand visuals'
    const prompt = [
      promptPrefix,
      `hero lifestyle photograph for ${tenant.name}`,
      tenant.businessType ?? 'general retail',
      stylePrompt,
    ].filter(Boolean).join(', ')

    const url = await generateHeroImage(prompt)
    if (!url) {
      throw new BadRequestException(
        'Could not generate a hero image right now — image generation is temporarily unavailable. Try again shortly.',
      )
    }
    await this.saveHeroImageUrl(tenantId, url)
    return { url, source: 'generated' as const }
  }

  async setHeroImageUrl(tenantId: string, requestedUrl: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Store not found')

    const finalUrl = await this.rehostExternalImage(requestedUrl, `seltra/${tenantId}/hero/${Date.now()}`)
    await this.saveHeroImageUrl(tenantId, finalUrl)
    return { url: finalUrl, source: 'provided-url' as const }
  }

  async setStoryImageUrl(tenantId: string, requestedUrl: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Store not found')

    const finalUrl = await this.rehostExternalImage(requestedUrl, `seltra/${tenantId}/story/${Date.now()}`)
    await this.saveStoryImageUrl(tenantId, finalUrl)
    return { url: finalUrl, source: 'provided-url' as const }
  }

  async regenerateStoryImage(tenantId: string, stylePrompt?: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Store not found')

    const dna = tenant.storeDNA as StoreDNA | null
    const promptPrefix = dna
      ? buildImagePromptPrefix(dna)
      : 'Professional editorial lifestyle photography, polished ecommerce brand visuals'
    const prompt = [
      promptPrefix,
      `editorial lifestyle photograph representing the brand story of ${tenant.name}`,
      tenant.businessType ?? 'general retail',
      stylePrompt,
    ].filter(Boolean).join(', ')

    const url = await generateHeroImage(prompt)
    if (!url) {
      throw new BadRequestException(
        'Could not generate a story image right now — image generation is temporarily unavailable. Try again shortly.',
      )
    }
    await this.saveStoryImageUrl(tenantId, url)
    return { url, source: 'generated' as const }
  }

  async setLogoUrl(tenantId: string, requestedUrl: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Store not found')

    const finalUrl = await this.rehostExternalImage(requestedUrl, `seltra/${tenantId}/logo/${Date.now()}`)
    await this.saveLogoUrl(tenantId, finalUrl)
    return { url: finalUrl, source: 'provided-url' as const }
  }

  async regenerateLogo(tenantId: string, stylePrompt?: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Store not found')

    const dna = tenant.storeDNA as StoreDNA | null
    const prompt = [
      'minimal vector-style logo mark, flat design, simple geometric shapes, no text, transparent-friendly solid background',
      `for a brand named ${tenant.name}`,
      dna ? buildImagePromptPrefix(dna) : '',
      stylePrompt,
    ].filter(Boolean).join(', ')
    const url = await generateProductImage(prompt)
    if (!url) {
      throw new BadRequestException('Could not generate a logo right now — image generation is temporarily unavailable. Try again shortly.')
    }
    await this.saveLogoUrl(tenantId, url)
    return { url, source: 'generated' as const }
  }

  private async saveHeroImageUrl(tenantId: string, url: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { canonical: true } })
    const canonical = (tenant?.canonical as Record<string, unknown> | null) ?? {}
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { canonical: { ...canonical, heroImageUrl: url }, updatedAt: new Date() },
    })
    void this.tenantEvents.recordForTenant(tenantId, 'theme_updated', { source: 'hero_image_change' })
  }

  private async saveStoryImageUrl(tenantId: string, url: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { canonical: true } })
    const canonical = (tenant?.canonical as Record<string, unknown> | null) ?? {}
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { canonical: { ...canonical, storyImageUrl: url }, updatedAt: new Date() },
    })
    void this.tenantEvents.recordForTenant(tenantId, 'theme_updated', { source: 'story_image_change' })
  }

  private async saveLogoUrl(tenantId: string, url: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { canonical: true } })
    const canonical = (tenant?.canonical as Record<string, unknown> | null) ?? {}
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { canonical: { ...canonical, logoUrl: url }, updatedAt: new Date() },
    })
    void this.tenantEvents.recordForTenant(tenantId, 'theme_updated', { source: 'logo_change' })
  }

  // ── Product image ───────────────────────────────────────────────────────

  async regenerateProductImage(tenantId: string, productId: string, stylePrompt?: string) {
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Product not found')

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { businessType: true, storeDNA: true } })
    const description = stylePrompt ? `${product.description ?? ''} ${stylePrompt}`.trim() : product.description ?? ''
    const dna = tenant?.storeDNA as StoreDNA | null
    const promptPrefix = dna
      ? buildImagePromptPrefix(dna)
      : 'Professional product photography, clean ecommerce studio lighting'

    const url = await generateProductImage(
      `${promptPrefix}, ${product.name}, ${description}, ${tenant?.businessType ?? 'general retail'} product photography`,
    )
    if (!url) {
      throw new BadRequestException(
        'Could not generate a product image right now — image generation is temporarily unavailable.',
      )
    }
    await this.saveProductImageUrl(productId, url)
    return { url, source: 'generated' as const, productId, productName: product.name }
  }

  async setProductImageUrl(tenantId: string, productId: string, requestedUrl: string) {
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Product not found')

    const finalUrl = await this.rehostExternalImage(requestedUrl, `seltra/${tenantId}/products/${productId}`)
    await this.saveProductImageUrl(productId, finalUrl)
    return { url: finalUrl, source: 'provided-url' as const, productId, productName: product.name }
  }

  private async saveProductImageUrl(productId: string, url: string) {
    const existing = await prisma.productImage.findFirst({ where: { productId, isPrimary: true } })
    if (existing) {
      await prisma.productImage.update({ where: { id: existing.id }, data: { url } })
    } else {
      await prisma.productImage.create({ data: { productId, url, isPrimary: true } })
    }
    await prisma.productImage.deleteMany({ where: { productId, isPrimary: false } })
  }

  /** Fuzzy name lookup so chat can say "change the Signature Bundle photo" without an ID. */
  async findProductByName(tenantId: string, name: string) {
    const products = await prisma.product.findMany({ where: { tenantId }, select: { id: true, name: true } })
    const lower = name.toLowerCase().trim()
    return (
      products.find((p) => p.name.toLowerCase() === lower) ??
      products.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase())) ??
      null
    )
  }

  /**
   * Validates a merchant-supplied URL, then re-hosts it on Cloudinary rather
   * than trusting the original host long-term. This is the fix for the
   * "upstream image response failed ... 404" bug — a dead/placeholder URL is
   * rejected here instead of being saved and failing later at render time.
   */
  private async rehostExternalImage(requestedUrl: string, publicId: string): Promise<string> {
    const validation = await validateImageUrl(requestedUrl)
    if (!validation.valid) {
      throw new BadRequestException(
        `That image link doesn't work (${validation.reason}). Send me a direct link to an image, or ask me to generate one instead.`,
      )
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(requestedUrl, { signal: controller.signal })
      if (!res.ok) {
        throw new BadRequestException(`Could not download that image (HTTP ${res.status}).`)
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      const mimeType = res.headers.get('content-type') ?? validation.contentType ?? 'image/jpeg'
      const upload = await uploadImageBuffer(buffer.toString('base64'), mimeType, publicId)
      return upload.secure_url
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Re-hosting image failed for ${requestedUrl}: ${message}`)
      throw new BadRequestException('Could not fetch that image link — please try a different one.')
    } finally {
      clearTimeout(timer)
    }
  }
}

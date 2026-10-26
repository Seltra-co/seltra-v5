import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { prisma } from '../db'
import { OrdersService } from '../orders/orders.service'
import { StorefrontCheckoutDto } from './storefront.dto'

type RateBucket = { count: number; resetAt: number }

@Injectable()
export class StorefrontService {
  private readonly checkoutBuckets = new Map<string, RateBucket>()

  constructor(private readonly orders: OrdersService) {}

  async getStore(slug: string) {
    const tenant = await this.findTenant(slug)
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      businessType: tenant.businessType,
      country: tenant.country,
      currency: 'GHS',
      fulfillment: {
        mode: tenant.fulfillmentMode,
        contactPhone: tenant.contactPhone,
        pickupAddress: tenant.pickupAddress,
        pickupInstructions: tenant.pickupInstructions,
        deliveryDays: tenant.deliveryDays,
        deliveryEstimate: tenant.deliveryEstimate,
        deliveryFeeNote: tenant.deliveryFeeNote,
        tiers: tenant.deliveryTiers,
      },
    }
  }

  async getProducts(slug: string, category?: string) {
    const tenant = await this.findTenant(slug)
    const rows = await prisma.product.findMany({
      where: { tenantId: tenant.id, status: 'active', ...(category ? { category } : {}) },
      select: {
        id: true, name: true, description: true, price: true, currency: true,
        category: true, sku: true, tags: true,
        images: { select: { id: true, url: true, isPrimary: true } },
        variants: { select: { id: true, name: true, value: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return rows.map((product) => ({ ...product, price: product.price.toString() }))
  }

  async getCategories(slug: string) {
    const tenant = await this.findTenant(slug)
    const [categories, counts] = await Promise.all([
      prisma.category.findMany({ where: { tenantId: tenant.id }, orderBy: { name: 'asc' } }),
      prisma.product.groupBy({ by: ['category'], where: { tenantId: tenant.id, status: 'active' }, _count: { _all: true } }),
    ])
    const countByName = new Map(counts.filter((row) => row.category).map((row) => [row.category!, row._count._all]))
    return categories.map((category) => ({ ...category, productCount: countByName.get(category.name) ?? 0 }))
  }

  async getShipping(slug: string) {
    const tenant = await this.findTenant(slug)
    const [zones, deliveryTiers] = await Promise.all([
      prisma.shippingZone.findMany({ where: { tenantId: tenant.id }, select: { id: true, name: true, deliveryTime: true, fee: true, metadata: true } }),
      Promise.resolve(tenant.deliveryTiers),
    ])
    return { fulfillmentMode: tenant.fulfillmentMode, zones, deliveryTiers, deliveryDays: tenant.deliveryDays, deliveryEstimate: tenant.deliveryEstimate }
  }

  async checkout(slug: string, payload: StorefrontCheckoutDto, clientKey: string) {
    this.enforceCheckoutRate(slug, clientKey)
    if (!payload.items.length || payload.items.length > 50) throw new BadRequestException('Checkout requires between 1 and 50 line items')
    const tenant = await this.findTenant(slug)
    const ids = [...new Set(payload.items.map((line) => line.productId))]
    const products = await prisma.product.findMany({ where: { tenantId: tenant.id, id: { in: ids }, status: 'active' }, select: { id: true, name: true, price: true, currency: true } })
    const byId = new Map(products.map((product) => [product.id, product]))
    if (byId.size !== ids.length) throw new BadRequestException('One or more products are unavailable')
    const cart = payload.items.map((line) => {
      const product = byId.get(line.productId)!
      return { product: { id: product.id, name: product.name, price: product.price.toString() }, quantity: line.quantity }
    })
    const totalAmount = cart.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0)
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new BadRequestException('Invalid checkout total')
    const currencies = new Set(products.map((product) => product.currency))
    if (currencies.size !== 1) throw new BadRequestException('Products with different currencies cannot be checked out together')
    const currency = products[0].currency.toUpperCase()
    if (currency !== 'GHS' && currency !== 'NGN') throw new BadRequestException(`Checkout is not available for ${currency} yet`)
    const result = await this.orders.initialize({
      reference: `seltra_${tenant.id}_${randomUUID()}`,
      tenantId: tenant.id,
      customerEmail: payload.customerEmail,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      cart,
      totalAmount: Number(totalAmount.toFixed(2)),
      currency,
      callbackUrl: payload.callbackUrl,
    })
    return { ...result, totalAmount: Number(totalAmount.toFixed(2)), currency, items: cart.map(({ product, quantity }) => ({ productId: product.id, name: product.name, unitPrice: product.price, quantity })) }
  }

  async confirmCheckout(slug: string, reference: string) {
    const tenant = await this.findTenant(slug)
    return this.orders.confirmStorefrontCheckout(reference, tenant.id)
  }

  async getOrder(slug: string, orderId: string, email: string) {
    const tenant = await this.findTenant(slug)
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || normalizedEmail.length > 254 || !normalizedEmail.includes('@')) throw new BadRequestException('A valid checkout email is required')
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId: tenant.id, customerEmail: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, status: true, totalAmount: true, currency: true, items: true, createdAt: true, updatedAt: true, trackingNumber: true },
    })
    if (!order) throw new NotFoundException('Order not found')
    return { ...order, totalAmount: order.totalAmount.toString(), items: Array.isArray(order.items) ? order.items : [] }
  }

  private async findTenant(slug: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true, businessType: true, country: true,
        status: true, fulfillmentMode: true, contactPhone: true, pickupAddress: true,
        pickupInstructions: true, deliveryDays: true, deliveryEstimate: true,
        deliveryFeeNote: true, deliveryTiers: true,
      },
    })
    if (!tenant || tenant.status !== 'active') throw new NotFoundException('Store not found')
    return tenant
  }

  private enforceCheckoutRate(slug: string, clientKey: string) {
    const now = Date.now()
    const key = `${slug}:${clientKey.slice(0, 100)}`
    const bucket = this.checkoutBuckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      this.checkoutBuckets.set(key, { count: 1, resetAt: now + 60_000 })
      if (this.checkoutBuckets.size > 10_000) {
        for (const [entry, value] of this.checkoutBuckets) if (value.resetAt <= now) this.checkoutBuckets.delete(entry)
      }
      return
    }
    if (bucket.count >= 10) throw new HttpException('Please wait before trying checkout again', HttpStatus.TOO_MANY_REQUESTS)
    bucket.count += 1
  }
}

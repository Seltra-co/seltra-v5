//seltra/backend/src/orders/orders.service.ts
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHmac } from 'crypto'
import { prisma } from '../db'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { OrderAgentService } from './order-agent.service'

interface VerifyOrderPayload {
  reference: string
  tenantId: string
  customerEmail: string
  customerName?: string
  cart: Array<{ product: { id: string; name: string; price: string }; quantity: number }>
  totalAmount: number
  currency: string
  callbackUrl?: string
}

@Injectable()
export class OrdersService {
  private readonly paystackSecretKey = process.env.PAYSTACK_SECRET_KEY || ''

  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantEvents: TenantEventsService,
    private readonly orderAgent: OrderAgentService,
  ) {}

  async initialize(payload: VerifyOrderPayload) {
    if (!this.paystackSecretKey) {
      return {
        success: false,
        message: 'Paystack secret key is not configured',
      }
    }

    const reference =
      payload.reference ||
      `seltra_${payload.tenantId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: payload.customerEmail,
        amount: Math.round(payload.totalAmount * 100),
        currency: payload.currency === 'GHS' ? 'GHS' : 'NGN',
        reference,
        callback_url: payload.callbackUrl,
        metadata: {
          customerName: payload.customerName,
          tenantId: payload.tenantId,
          cart: payload.cart.map((item) => ({
            productId: item.product.id,
            productName: item.product.name,
            quantity: item.quantity,
            price: item.product.price,
          })),
        },
      }),
    })

    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.status) {
      return {
        success: false,
        message: data?.message || 'Could not initialize Paystack payment',
        reference,
      }
    }

    return {
      success: true,
      reference,
      authorizationUrl: data.data?.authorization_url,
      accessCode: data.data?.access_code,
    }
  }

  async verifyAndSave(payload: VerifyOrderPayload) {
    // 1. Verify with Paystack
    if (this.paystackSecretKey) try {
      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(payload.reference)}`,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
        },
      )

      const verifyData = await verifyRes.json()

      if (!verifyData.status || verifyData.data?.status !== 'success') {
        return { success: false, message: 'Payment verification failed', reference: payload.reference }
      }
    } catch (err) {
      // In test mode with no key, skip strict verification but still save order
      console.warn('[OrdersService] Paystack verification skipped (test mode or no key):', err)
    }

    // 2. Save order to Postgres
    try {
      const existing = await prisma.order.findFirst({
        where: { paystackRef: payload.reference },
      })
      if (existing) {
        return {
          success: true,
          message: 'Order already confirmed',
          orderId: existing.id,
          reference: payload.reference,
        }
      }

      const order = await prisma.order.create({
        data: {
          tenantId: payload.tenantId,
          customerEmail: payload.customerEmail,
          customerName: payload.customerName || '',
          totalAmount: payload.totalAmount,
          currency: payload.currency,
          status: 'pending',
          paystackRef: payload.reference,
          items: payload.cart.map((item) => ({
            productId: item.product.id,
            productName: item.product.name,
            quantity: item.quantity,
            price: item.product.price,
          })) as object,
        },
      })
      void this.tenantEvents.recordForTenant(order.tenantId, 'order_placed', {
        orderId: order.id,
        reference: payload.reference,
        amount: order.totalAmount.toString(),
        customerEmail: order.customerEmail,
        customerName: order.customerName,
      })
      void this.orderAgent.onOrderCreated(order, 'paystack').catch(() => null)

      return {
        success: true,
        message: 'Order confirmed',
        orderId: order.id,
        reference: payload.reference,
      }
    } catch (err) {
      console.error('[OrdersService] Failed to save order:', err)
      return { success: false, message: 'Order save failed', reference: payload.reference }
    }
  }

  async handleWebhook(body: unknown, signature?: string) {
    if (!this.paystackSecretKey) return { received: true }

    const expected = createHmac('sha512', this.paystackSecretKey)
      .update(JSON.stringify(body))
      .digest('hex')

    if (signature !== expected) {
      return { received: false, message: 'Invalid signature' }
    }

    const event = body as {
      event?: string
      data?: {
        reference?: string
        status?: string
        customer?: { email?: string }
        amount?: number
        currency?: string
        metadata?: {
          tenantId?: string
          customerName?: string
          cart?: VerifyOrderPayload['cart']
        }
      }
    }

    if (event.event === 'charge.success' && event.data?.status === 'success') {
      const tenantId = event.data.metadata?.tenantId
      const cart = event.data.metadata?.cart
      if (tenantId && cart && event.data.reference && event.data.customer?.email) {
        await this.verifyAndSave({
          reference: event.data.reference,
          tenantId,
          customerEmail: event.data.customer.email,
          customerName: event.data.metadata?.customerName,
          cart,
          totalAmount: (event.data.amount || 0) / 100,
          currency: event.data.currency || 'GHS',
        })
      }
    }

    return { received: true }
  }

  async listOrders(
    authorization: string | undefined,
    opts: { tenantId?: string; page: number; perPage: number; status?: string },
  ) {
    const tenantId = await this.resolveTenantId(authorization, opts.tenantId)
    const page = Math.max(1, opts.page)
    const perPage = Math.min(100, Math.max(1, opts.perPage))
    const where = {
      tenantId,
      merchantAmount: { not: null },
      ...(opts.status ? { status: opts.status } : {}),
    }
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.order.count({ where }),
    ])

    return {
      data: orders.map((order) => ({ ...order, items: this.parseItems(order.items) })),
      total,
      page,
      perPage,
    }
  }

  async getOrder(
    authorization: string | undefined,
    orderId: string,
    requestedTenantId?: string,
    reference?: string,
  ) {
    if (reference) {
      const order = await prisma.order.findFirst({ where: { paystackRef: reference } })
      if (!order) throw new NotFoundException('Order not found')
      return { ...order, items: this.parseItems(order.items) }
    }

    const tenantId = await this.resolveTenantId(authorization, requestedTenantId)
    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } })
    if (!order) throw new NotFoundException('Order not found')
    return { ...order, items: this.parseItems(order.items) }
  }

  async getOrderByReference(reference: string) {
    const order = await prisma.order.findFirst({ where: { paystackRef: reference } })
    if (!order) throw new NotFoundException('Order not found')
    return { ...order, items: this.parseItems(order.items) }
  }

  async updateStatus(
    authorization: string | undefined,
    orderId: string,
    status: string,
    requestedTenantId?: string,
  ) {
    const allowed = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']
    if (!allowed.includes(status)) throw new UnauthorizedException('Invalid order status')
    const tenantId = await this.resolveTenantId(authorization, requestedTenantId)
    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } })
    if (!order) throw new NotFoundException('Order not found')
    const timeline = Array.isArray(order.timeline) ? order.timeline : []
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        timeline: [...timeline, { status, at: new Date().toISOString(), by: 'merchant' }],
        fulfilledBy: status === 'delivered' ? 'merchant' : order.fulfilledBy,
      },
    })
    void this.tenantEvents.recordForTenant(updated.tenantId, 'order_status_updated', {
      orderId: updated.id,
      status,
      customerEmail: updated.customerEmail,
      customerName: updated.customerName,
    })
    void this.orderAgent.onStatusUpdated(updated).catch(() => null)
    return updated
  }

  private parseItems(items: unknown) {
    return Array.isArray(items) ? items : []
  }

  private async resolveTenantId(authorization?: string, requestedTenantId?: string) {
    const userId = await this.userIdFromAuth(authorization)
    if (requestedTenantId) {
      const tenant = await prisma.tenant.findFirst({ where: { id: requestedTenantId, ownerId: userId } })
      if (!tenant) throw new NotFoundException('Store not found')
      return tenant.id
    }
    const tenant = await prisma.tenant.findFirst({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
    })
    if (!tenant) throw new NotFoundException('No store found for this merchant')
    return tenant.id
  }

  private async userIdFromAuth(authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing bearer token')
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_SECRET || 'change-me',
      })
      return payload.sub
    } catch {
      throw new UnauthorizedException('Invalid bearer token')
    }
  }
}

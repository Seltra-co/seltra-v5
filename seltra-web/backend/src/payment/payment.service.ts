// //seltra/backend/src/payment/payment.service.ts
// import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
// import { JwtService } from '@nestjs/jwt'
// import { Prisma } from '@prisma/client'
// import { createHmac, randomBytes } from 'crypto'
// import { prisma } from '../db'
// import { PaystackService } from './paystack.service'

// type CheckoutItem = {
//   productId?: string
//   product?: { id?: string; name?: string; price?: string | number }
//   name?: string
//   quantity: number
//   price?: string | number
// }

// type CustomerDetails = {
//   customerPhone?: string
//   shippingAddress?: string
//   shippingCity?: string
//   shippingCountry?: string
//   marketingOptIn?: boolean
// }

// type WebhookPayload = {
//   event?: string
//   data?: {
//     reference?: string
//     status?: string
//     amount?: number
//     currency?: string
//     customer?: { email?: string; first_name?: string; last_name?: string }
//     metadata?: {
//       tenantId?: string
//       tenantSlug?: string
//       customerName?: string
//       customerPhone?: string
//       shippingAddress?: string
//       shippingCity?: string
//       shippingCountry?: string
//       marketingOptIn?: boolean
//       items?: CheckoutItem[]
//       cart?: CheckoutItem[]
//     }
//   }
// }

// type WebhookMetadata = NonNullable<NonNullable<WebhookPayload['data']>['metadata']>

// export type { WebhookPayload }

// @Injectable()
// export class PaymentService {
//   constructor(
//     private readonly paystackService: PaystackService,
//     private readonly jwtService: JwtService,
//   ) {}

//   generateReference(tenantSlug: string) {
//     const random = randomBytes(4).toString('hex')
//     return `seltra_${tenantSlug}_${Date.now()}_${random}`
//   }

//   parseReference(ref: string): { tenantSlug: string } | null {
//     const parts = ref.split('_')
//     if (parts.length < 4 || parts[0] !== 'seltra' || !parts[1] || !parts[2]) return null
//     return { tenantSlug: parts[1] }
//   }

//   async initializePayment(
//     tenantId: string,
//     items: CheckoutItem[],
//     customerEmail: string,
//     customerName?: string,
//     customerDetails: CustomerDetails = {},
//     callbackUrl?: string,
//   ) {
//     const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
//     if (!tenant) throw new NotFoundException('Store not found')

//     const normalizedItems = this.normalizeItems(items)
//     const totalAmount = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
//     const reference = this.generateReference(tenant.slug)
//     const currency = 'GHS'
//     const authorization = await this.paystackService.initializeTransaction({
//       email: customerEmail,
//       amount: Math.round(totalAmount * 100),
//       currency,
//       reference,
//       callback_url: callbackUrl,
//       metadata: {
//         tenantId,
//         tenantSlug: tenant.slug,
//         customerName,
//         ...customerDetails,
//         items: normalizedItems,
//       },
//     })

//     const customer = await this.upsertCustomer(tenantId, customerEmail, customerName, customerDetails)

//     const order = await prisma.order.create({
//       data: {
//         tenantId,
//         customerId: customer.id,
//         customerEmail,
//         customerName: customerName || '',
//         customerPhone: customerDetails.customerPhone,
//         shippingAddress: customerDetails.shippingAddress,
//         shippingCity: customerDetails.shippingCity,
//         shippingCountry: customerDetails.shippingCountry,
//         marketingOptIn: Boolean(customerDetails.marketingOptIn),
//         totalAmount,
//         currency,
//         status: 'pending',
//         paystackRef: reference,
//         items: normalizedItems as unknown as Prisma.InputJsonValue,
//       },
//     })

//     return {
//       authorization_url: authorization.authorization_url,
//       authorizationUrl: authorization.authorization_url,
//       reference,
//       orderId: order.id,
//     }
//   }

//   async handleWebhook(payload: WebhookPayload, paystackSignature?: string) {
//     this.verifyWebhookSignature(payload, paystackSignature)

//     const event = payload.event || ''
//     const reference = payload.data?.reference
//     if (!reference) return { received: true }

//     const parsed = this.parseReference(reference)
//     const grossAmount = new Prisma.Decimal((payload.data?.amount || 0) / 100)
//     const existing = await prisma.paystackEvent.upsert({
//       where: { reference },
//       update: { rawPayload: payload as Prisma.InputJsonValue },
//       create: {
//         reference,
//         event,
//         tenantSlug: parsed?.tenantSlug || payload.data?.metadata?.tenantSlug,
//         tenantId: payload.data?.metadata?.tenantId,
//         amount: grossAmount,
//         currency: payload.data?.currency || 'GHS',
//         customerEmail: payload.data?.customer?.email,
//         customerName: payload.data?.metadata?.customerName || this.customerNameFromPayload(payload),
//         rawPayload: payload as Prisma.InputJsonValue,
//       },
//     })

//     if (existing.processed) return { received: true }

//     if (event === 'charge.success' && payload.data?.status === 'success') {
//       const tenant = await prisma.tenant.findFirst({
//         where: {
//           OR: [
//             { slug: parsed?.tenantSlug || '' },
//             { id: payload.data.metadata?.tenantId || '' },
//           ],
//         },
//       })
//       if (!tenant) throw new NotFoundException('Tenant for Paystack reference not found')

//       const items = this.normalizeItems(payload.data.metadata?.items || payload.data.metadata?.cart || [])
//       const existingOrder = await prisma.order.findFirst({ where: { paystackRef: reference } })
//       const customerEmail = payload.data.customer?.email || existingOrder?.customerEmail || ''
//       const customerName = payload.data.metadata?.customerName || this.customerNameFromPayload(payload)
//       const customerDetails = this.customerDetailsFromMetadata(payload.data.metadata)
//       const customer = customerEmail
//         ? await this.upsertCustomer(tenant.id, customerEmail, customerName, customerDetails)
//         : null
//       const order = existingOrder
//         ? await prisma.order.update({
//             where: { id: existingOrder.id },
//             data: {
//               customerId: customer?.id ?? existingOrder.customerId,
//               status: existingOrder.merchantAmount ? existingOrder.status : 'pending',
//               totalAmount: grossAmount,
//               currency: payload.data.currency || 'GHS',
//               customerEmail,
//               customerName,
//               customerPhone: customerDetails.customerPhone,
//               shippingAddress: customerDetails.shippingAddress,
//               shippingCity: customerDetails.shippingCity,
//               shippingCountry: customerDetails.shippingCountry,
//               marketingOptIn: Boolean(customerDetails.marketingOptIn),
//               items: items as unknown as Prisma.InputJsonValue,
//             },
//           })
//         : await prisma.order.create({
//             data: {
//               tenantId: tenant.id,
//               customerId: customer?.id,
//               customerEmail,
//               customerName,
//               customerPhone: customerDetails.customerPhone,
//               shippingAddress: customerDetails.shippingAddress,
//               shippingCity: customerDetails.shippingCity,
//               shippingCountry: customerDetails.shippingCountry,
//               marketingOptIn: Boolean(customerDetails.marketingOptIn),
//               totalAmount: grossAmount,
//               currency: payload.data.currency || 'GHS',
//               status: 'pending',
//               paystackRef: reference,
//               items: items as unknown as Prisma.InputJsonValue,
//             },
//           })

//       await this.creditMerchantLedger(tenant.id, order.id, grossAmount, reference)
//     }

//     return { received: true }
//   }

//   async verifyPayment(reference: string) {
//     if (!reference) throw new BadRequestException('Missing payment reference')

//     const verification = await this.paystackService.verifyTransaction(reference)
//     if (!verification.status || verification.data?.status !== 'success') {
//       return {
//         success: false,
//         status: verification.data?.status || 'unknown',
//         message: verification.message || 'Payment has not been confirmed by Paystack',
//       }
//     }

//     const existingOrder = await prisma.order.findFirst({ where: { paystackRef: reference } })
//     const parsed = this.parseReference(reference)
//     const tenant = existingOrder
//       ? await prisma.tenant.findUnique({ where: { id: existingOrder.tenantId } })
//       : await prisma.tenant.findFirst({ where: { slug: parsed?.tenantSlug || '' } })
//     if (!tenant) throw new NotFoundException('Tenant for Paystack reference not found')

//     const metadata = verification.data.metadata || {}
//     const customerEmail = verification.data.customer?.email || existingOrder?.customerEmail || ''
//     if (!customerEmail) throw new BadRequestException('Paystack verification did not include a customer email')

//     const customerName =
//       this.stringFromMeta(metadata, 'customerName') ||
//       existingOrder?.customerName ||
//       [verification.data.customer?.first_name, verification.data.customer?.last_name].filter(Boolean).join(' ')
//     const customerDetails = this.customerDetailsFromRecord(metadata)
//     const customer = await this.upsertCustomer(tenant.id, customerEmail, customerName, customerDetails)
//     const grossAmount = new Prisma.Decimal((verification.data.amount || 0) / 100)
//     const currency = verification.data.currency || existingOrder?.currency || 'GHS'
//     const items = this.checkoutItemsFromMetadata(metadata, existingOrder?.items)

//     const order = existingOrder
//       ? await prisma.order.update({
//           where: { id: existingOrder.id },
//           data: {
//             customerId: customer.id,
//             customerEmail,
//             customerName,
//             customerPhone: customerDetails.customerPhone,
//             shippingAddress: customerDetails.shippingAddress,
//             shippingCity: customerDetails.shippingCity,
//             shippingCountry: customerDetails.shippingCountry,
//             marketingOptIn: Boolean(customerDetails.marketingOptIn),
//             totalAmount: grossAmount,
//             currency,
//             status: existingOrder.merchantAmount ? existingOrder.status : 'pending',
//             items: items as unknown as Prisma.InputJsonValue,
//           },
//         })
//       : await prisma.order.create({
//           data: {
//             tenantId: tenant.id,
//             customerId: customer.id,
//             customerEmail,
//             customerName,
//             customerPhone: customerDetails.customerPhone,
//             shippingAddress: customerDetails.shippingAddress,
//             shippingCity: customerDetails.shippingCity,
//             shippingCountry: customerDetails.shippingCountry,
//             marketingOptIn: Boolean(customerDetails.marketingOptIn),
//             totalAmount: grossAmount,
//             currency,
//             status: 'pending',
//             paystackRef: reference,
//             items: items as unknown as Prisma.InputJsonValue,
//           },
//         })

//     await prisma.paystackEvent.upsert({
//       where: { reference },
//       update: {
//         event: 'charge.success',
//         tenantId: tenant.id,
//         tenantSlug: tenant.slug,
//         amount: grossAmount,
//         currency,
//         customerEmail,
//         customerName,
//         rawPayload: verification as unknown as Prisma.InputJsonValue,
//       },
//       create: {
//         reference,
//         event: 'charge.success',
//         tenantId: tenant.id,
//         tenantSlug: tenant.slug,
//         amount: grossAmount,
//         currency,
//         customerEmail,
//         customerName,
//         rawPayload: verification as unknown as Prisma.InputJsonValue,
//       },
//     })

//     await this.creditMerchantLedger(tenant.id, order.id, grossAmount, reference)
//     const refreshedOrder = await prisma.order.findUnique({ where: { id: order.id } })

//     return {
//       success: true,
//       order: refreshedOrder ? { ...refreshedOrder, items: this.parseJsonItems(refreshedOrder.items) } : order,
//     }
//   }

//   async creditMerchantLedger(
//     tenantId: string,
//     orderId: string,
//     grossAmountInput: Prisma.Decimal | number,
//     reference?: string,
//   ) {
//     const grossAmount = new Prisma.Decimal(grossAmountInput)
//     const feePercent = new Prisma.Decimal(process.env.SELTRA_FEE_PERCENT || 0)
//     const seltraFee = grossAmount.mul(feePercent).div(100)
//     const merchantAmount = grossAmount.minus(seltraFee)

//     const existingTx = await prisma.ledgerTransaction.findFirst({ where: { orderId, type: 'credit' } })
//     if (existingTx) {
//       await prisma.paystackEvent.updateMany({ where: { reference }, data: { processed: true, tenantId } })
//       return existingTx
//     }

//     const ledger = await prisma.merchantLedger.upsert({
//       where: { tenantId },
//       update: {
//         balance: { increment: merchantAmount },
//       },
//       create: {
//         tenantId,
//         balance: merchantAmount,
//         currency: 'GHS',
//       },
//     })

//     const tx = await prisma.ledgerTransaction.create({
//       data: {
//         ledgerId: ledger.id,
//         orderId,
//         type: 'credit',
//         amount: merchantAmount,
//         currency: 'GHS',
//         description: `Order payment credited${reference ? ` (${reference})` : ''}`,
//         meta: { grossAmount, seltraFee, reference } as unknown as Prisma.InputJsonValue,
//       },
//     })

//     await prisma.order.update({
//       where: { id: orderId },
//       data: {
//         disbursed: false,
//         merchantAmount,
//         seltraFee,
//       },
//     })
//     await prisma.paystackEvent.updateMany({ where: { reference }, data: { processed: true, tenantId } })

//     return tx
//   }

//   async getMerchantLedger(authorization?: string, tenantId?: string) {
//     const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
//     const ledger = await prisma.merchantLedger.upsert({
//       where: { tenantId: resolvedTenantId },
//       update: {},
//       create: { tenantId: resolvedTenantId, balance: 0, currency: 'GHS' },
//       include: {
//         transactions: {
//           orderBy: { createdAt: 'desc' },
//           take: 50,
//         },
//       },
//     })
//     return ledger
//   }

//   async getMerchantSales(authorization: string | undefined, page = 1, perPage = 20, tenantId?: string) {
//     const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
//     const skip = (page - 1) * perPage
//     const where = { tenantId: resolvedTenantId, merchantAmount: { not: null } }
//     const [orders, total] = await Promise.all([
//       prisma.order.findMany({
//         where,
//         orderBy: { createdAt: 'desc' },
//         skip,
//         take: perPage,
//       }),
//       prisma.order.count({ where }),
//     ])
//     return {
//       data: orders.map((order) => ({ ...order, items: order.items })),
//       total,
//       page,
//       perPage,
//     }
//   }

//   async getMerchantCustomers(authorization?: string, tenantId?: string) {
//     const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
//     const customers = await prisma.customer.findMany({
//       where: { tenantId: resolvedTenantId },
//       include: {
//         orders: {
//           where: { merchantAmount: { not: null } },
//           orderBy: { createdAt: 'desc' },
//         },
//       },
//       orderBy: { updatedAt: 'desc' },
//     })

//     return customers.map((customer) => {
//       const totalSpent = customer.orders.reduce(
//         (sum, order) => sum.add(order.totalAmount),
//         new Prisma.Decimal(0),
//       )
//       const lastOrder = customer.orders[0]

//       return {
//         id: customer.id,
//         tenantId: customer.tenantId,
//         name: customer.name,
//         email: customer.email,
//         phone: customer.phone,
//         address: customer.address,
//         city: customer.city,
//         country: customer.country,
//         marketingOptIn: customer.marketingOptIn,
//         orderCount: customer.orders.length,
//         totalSpent,
//         currency: lastOrder?.currency || 'GHS',
//         lastOrderAt: lastOrder?.createdAt,
//         isRecurring: customer.orders.length > 1,
//         createdAt: customer.createdAt,
//         updatedAt: customer.updatedAt,
//       }
//     })
//   }

//   async resolveTenantId(authorization?: string, requestedTenantId?: string) {
//     const userId = await this.userIdFromAuth(authorization)
//     if (requestedTenantId) {
//       const tenant = await prisma.tenant.findFirst({ where: { id: requestedTenantId, ownerId: userId } })
//       if (!tenant) throw new NotFoundException('Store not found')
//       return tenant.id
//     }

//     const tenant = await prisma.tenant.findFirst({
//       where: { ownerId: userId },
//       orderBy: { updatedAt: 'desc' },
//     })
//     if (!tenant) throw new NotFoundException('No store found for this merchant')
//     return tenant.id
//   }

//   private normalizeItems(items: CheckoutItem[]) {
//     return (items || []).map((item) => {
//       const product = item.product || {}
//       const price = Number(item.price ?? product.price ?? 0)
//       const quantity = Number(item.quantity || 1)
//       return {
//         productId: item.productId || product.id,
//         productName: item.name || product.name || 'Product',
//         quantity,
//         price,
//       }
//     })
//   }

//   private verifyWebhookSignature(payload: WebhookPayload, signature?: string) {
//     const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY
//     if (!secret) return
//     const expected = createHmac('sha512', secret).update(JSON.stringify(payload)).digest('hex')
//     if (!signature || signature !== expected) throw new UnauthorizedException('Invalid Paystack signature')
//   }

//   private async upsertCustomer(
//     tenantId: string,
//     email: string,
//     name?: string,
//     details: CustomerDetails = {},
//   ) {
//     const normalizedEmail = email.trim().toLowerCase()
//     return prisma.customer.upsert({
//       where: {
//         tenantId_email: {
//           tenantId,
//           email: normalizedEmail,
//         },
//       },
//       update: {
//         name: name || undefined,
//         phone: details.customerPhone || undefined,
//         address: details.shippingAddress || undefined,
//         city: details.shippingCity || undefined,
//         country: details.shippingCountry || undefined,
//         marketingOptIn: Boolean(details.marketingOptIn),
//       },
//       create: {
//         tenantId,
//         email: normalizedEmail,
//         name: name || '',
//         phone: details.customerPhone,
//         address: details.shippingAddress,
//         city: details.shippingCity,
//         country: details.shippingCountry,
//         marketingOptIn: Boolean(details.marketingOptIn),
//       },
//     })
//   }

//   private customerDetailsFromMetadata(metadata?: WebhookMetadata): CustomerDetails {
//     return {
//       customerPhone: metadata?.customerPhone,
//       shippingAddress: metadata?.shippingAddress,
//       shippingCity: metadata?.shippingCity,
//       shippingCountry: metadata?.shippingCountry,
//       marketingOptIn: Boolean(metadata?.marketingOptIn),
//     }
//   }

//   private customerDetailsFromRecord(metadata?: Record<string, unknown>): CustomerDetails {
//     return {
//       customerPhone: this.stringFromMeta(metadata, 'customerPhone'),
//       shippingAddress: this.stringFromMeta(metadata, 'shippingAddress'),
//       shippingCity: this.stringFromMeta(metadata, 'shippingCity'),
//       shippingCountry: this.stringFromMeta(metadata, 'shippingCountry'),
//       marketingOptIn: Boolean(metadata?.marketingOptIn),
//     }
//   }

//   private checkoutItemsFromMetadata(metadata?: Record<string, unknown>, fallback?: unknown) {
//     const items = Array.isArray(metadata?.items) ? metadata.items : Array.isArray(metadata?.cart) ? metadata.cart : fallback
//     return this.parseJsonItems(items)
//   }

//   private parseJsonItems(items: unknown) {
//     return Array.isArray(items) ? items : []
//   }

//   private stringFromMeta(metadata: Record<string, unknown> | undefined, key: string) {
//     const value = metadata?.[key]
//     return typeof value === 'string' ? value : undefined
//   }

//   private async userIdFromAuth(authorization?: string) {
//     const token = authorization?.replace(/^Bearer\s+/i, '')
//     if (!token) throw new UnauthorizedException('Missing bearer token')
//     try {
//       const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
//         secret: process.env.JWT_SECRET || 'change-me',
//       })
//       return payload.sub
//     } catch {
//       throw new UnauthorizedException('Invalid bearer token')
//     }
//   }

//   private customerNameFromPayload(payload: WebhookPayload) {
//     return [payload.data?.customer?.first_name, payload.data?.customer?.last_name].filter(Boolean).join(' ')
//   }
// }
// seltra/backend/src/payment/payment.service.ts
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Prisma } from '@prisma/client'
import { createHash, createHmac, randomBytes, randomInt } from 'crypto'
import { prisma } from '../db'
import { PaystackService } from './paystack.service'
import { MoolreService, type MoolreWebhookBody } from './moolre.service'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { OrderAgentService } from '../orders/order-agent.service'
import { ResendService } from '../resend/resend.service'

type CheckoutItem = {
  productId?: string
  product?: { id?: string; name?: string; price?: string | number }
  name?: string
  quantity: number
  price?: string | number
  selectedVariants?: Record<string, string>
  type?: string
  deliveryTier?: DeliveryTierSelection
}

type DeliveryTierSelection = {
  id: string
  label: string
  priceFrom: number
  currency: string
}

type NormalizedCheckoutItem = {
  type?: string
  productId?: string
  productName: string
  quantity: number
  price: number
  selectedVariants?: Record<string, string>
  deliveryTier?: DeliveryTierSelection
}

type CustomerDetails = {
  customerPhone?: string
  shippingAddress?: string
  shippingCity?: string
  shippingCountry?: string
  marketingOptIn?: boolean
  deliveryTier?: DeliveryTierSelection
}

type WebhookPayload = {
  event?: string
  data?: {
    reference?: string
    status?: string
    amount?: number
    currency?: string
    customer?: { email?: string; first_name?: string; last_name?: string }
    metadata?: {
      tenantId?: string
      tenantSlug?: string
      customerName?: string
      customerPhone?: string
      shippingAddress?: string
      shippingCity?: string
      shippingCountry?: string
      marketingOptIn?: boolean
      items?: CheckoutItem[]
      cart?: CheckoutItem[]
    }
  }
}

type WebhookMetadata = NonNullable<NonNullable<WebhookPayload['data']>['metadata']>

export type { WebhookPayload }

type PayoutMethod = 'mobile_money' | 'bank'

const GHANA_TELCOS = new Map([
  ['mtn', { label: 'MTN Mobile Money', code: '1' }],
  ['telecel', { label: 'Telecel Cash', code: '6' }],
  ['at', { label: 'AT Money', code: '7' }],
])

const GHANA_BANKS = new Map([
  ['gcb', { label: 'GCB Bank', code: 'gcb' }],
  ['ecobank', { label: 'Ecobank Ghana', code: 'ecobank' }],
  ['absa', { label: 'Absa Bank Ghana', code: 'absa' }],
  ['stanbic', { label: 'Stanbic Bank Ghana', code: 'stanbic' }],
  ['standard-chartered', { label: 'Standard Chartered Bank Ghana', code: 'standard-chartered' }],
  ['fidelity', { label: 'Fidelity Bank Ghana', code: 'fidelity' }],
  ['calbank', { label: 'CalBank', code: 'calbank' }],
  ['republic', { label: 'Republic Bank Ghana', code: 'republic' }],
  ['access', { label: 'Access Bank Ghana', code: 'access' }],
  ['zenith', { label: 'Zenith Bank Ghana', code: 'zenith' }],
  ['uba', { label: 'United Bank for Africa Ghana', code: 'uba' }],
])

// ── Determines which provider is active ──────────────────────────────────────
function activeProvider(): 'moolre' | 'paystack' {
  return (process.env.PAYMENT_PROVIDER || 'moolre') === 'paystack' ? 'paystack' : 'moolre'
}

const baseUrl = process.env.SELTRA_BASE_URL || 'http://localhost:3001'
const moolreCallbackUrl = `${baseUrl}/api/v1/webhooks/moolre`   // POST webhook
const moolreRedirectUrl = `${baseUrl}/api/v1/webhooks/moolre`   // GET redirect (backend bounces to frontend)

@Injectable()
export class PaymentService {
  constructor(
    private readonly paystackService: PaystackService,
    private readonly moolreService: MoolreService,
    private readonly jwtService: JwtService,
    private readonly tenantEvents: TenantEventsService,
    private readonly orderAgent: OrderAgentService,
    private readonly resendService: ResendService,
  ) {}

  generateReference(tenantSlug: string) {
    const random = randomBytes(4).toString('hex')
    return `seltra_${tenantSlug}_${Date.now()}_${random}`
  }

  parseReference(ref: string): { tenantSlug: string } | null {
    const parts = ref.split('_')
    if (parts.length < 4 || parts[0] !== 'seltra' || !parts[1] || !parts[2]) return null
    return { tenantSlug: parts[1] }
  }

  // ── PUBLIC: called by the storefront checkout ─────────────────────────────
  async initializePayment(
    tenantId: string,
    items: CheckoutItem[],
    customerEmail: string,
    customerName?: string,
    customerDetails: CustomerDetails = {},
    callbackUrl?: string,
  ) {
    if (activeProvider() === 'moolre') {
      return this.initializePaymentMoolre(tenantId, items, customerEmail, customerName, customerDetails, callbackUrl)
    }
    return this.initializePaymentPaystack(tenantId, items, customerEmail, customerName, customerDetails, callbackUrl)
  }

  // ── MOOLRE: initialize checkout ───────────────────────────────────────────
  private async initializePaymentMoolre(
    tenantId: string,
    items: CheckoutItem[],
    customerEmail: string,
    customerName?: string,
    customerDetails: CustomerDetails = {},
    callbackUrl?: string,
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Store not found')

    const normalizedItems = this.withDeliveryTier(this.normalizeItems(items), customerDetails.deliveryTier)
    const totalAmount = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const reference = this.generateReference(tenant.slug)

    // Build our callback URL for Moolre to POST to when payment completes
    const baseUrl = process.env.SELTRA_BASE_URL || 'http://localhost:3001'
    const moolreCallbackUrl = `${baseUrl}/api/v1/webhooks/moolre`

    // Store metadata in the reference lookup — we can't pass arbitrary metadata
    // to Moolre's payment link, so we persist the order as pending immediately
    const customer = await this.upsertCustomer(tenantId, customerEmail, customerName, customerDetails)

    const order = await prisma.order.create({
      data: {
        tenantId,
        customerId: customer.id,
        customerEmail,
        customerName: customerName || '',
        customerPhone: customerDetails.customerPhone,
        shippingAddress: customerDetails.shippingAddress,
        shippingCity: customerDetails.shippingCity,
        shippingCountry: customerDetails.shippingCountry,
        marketingOptIn: Boolean(customerDetails.marketingOptIn),
        totalAmount,
        currency: 'GHS',
        status: 'pending',
        paystackRef: reference, // reusing paystackRef column as our universal payment reference
        items: normalizedItems as unknown as Prisma.InputJsonValue,
      },
    })
    void this.orderAgent.onOrderCreated(order, 'moolre').catch(() => null)

    // const result = await this.moolreService.generatePaymentLink({
    //   amount: totalAmount,
    //   reference,
    //   callbackUrl: moolreCallbackUrl,
    // })
    // inside initializePaymentMoolre(), replace the generatePaymentLink call:

    const result = await this.moolreService.generatePaymentLink({
      amount: totalAmount,
      reference,
      callbackUrl: moolreCallbackUrl,
      redirectUrl: moolreRedirectUrl,   // same host, but handled by @Get() above
    })

    if (!result.success || !result.paymentUrl) {
      // Clean up the pending order if Moolre fails to give us a link
      await prisma.order.delete({ where: { id: order.id } }).catch(() => null)
      throw new BadRequestException(result.error || 'Could not generate Moolre payment link')
    }

    console.log(`[Moolre] Payment link generated for order ${order.id}: ${result.paymentUrl}`)

    return {
      authorization_url: result.paymentUrl,
      authorizationUrl: result.paymentUrl,
      reference,
      orderId: order.id,
      provider: 'moolre',
    }
  }

  // ── PAYSTACK: initialize checkout (legacy) ────────────────────────────────
private async initializePaymentPaystack(
  tenantId: string,
  items: CheckoutItem[],
  customerEmail: string,
  customerName?: string,
  customerDetails: CustomerDetails = {},
  callbackUrl?: string,
) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new NotFoundException('Store not found')

  const normalizedItems = this.withDeliveryTier(this.normalizeItems(items), customerDetails.deliveryTier)
  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const reference = this.generateReference(tenant.slug)
  const currency = 'GHS'

  const authorization = await this.paystackService.initializeTransaction({
    email: customerEmail,
    amount: Math.round(totalAmount * 100),
    currency,
    reference,
    callback_url: callbackUrl,
    metadata: {
      tenantId,
      tenantSlug: tenant.slug,
      customerName,
      ...customerDetails,
      items: normalizedItems,
    },
  })

  const customer = await this.upsertCustomer(tenantId, customerEmail, customerName, customerDetails)

  const order = await prisma.order.create({
    data: {
      tenantId,
      customerId: customer.id,
      customerEmail,
      customerName: customerName || '',
      customerPhone: customerDetails.customerPhone,
      shippingAddress: customerDetails.shippingAddress,
      shippingCity: customerDetails.shippingCity,
      shippingCountry: customerDetails.shippingCountry,
      marketingOptIn: Boolean(customerDetails.marketingOptIn),
      totalAmount,
      currency,
      status: 'pending',
      paystackRef: reference,
      items: normalizedItems as unknown as Prisma.InputJsonValue,
    },
  })
  void this.orderAgent.onOrderCreated(order, 'paystack').catch(() => null)

  return {
    authorization_url: authorization.authorization_url,
    authorizationUrl: authorization.authorization_url,
    reference,
    orderId: order.id,
    provider: 'paystack',
  }
}

  // ── MOOLRE: webhook handler ───────────────────────────────────────────────
async handleMoolreWebhook(body: MoolreWebhookBody) {
  console.log('[Moolre] Webhook received:', JSON.stringify(body))

  // Moolre success codes: P01 (sandbox legacy) or SPV03 (current)
  const SUCCESS_CODES = new Set(['P01', 'SPV03'])
  
  if (body.status !== 1 || !SUCCESS_CODES.has(body.code)) {
    console.log('[Moolre] Webhook ignored — not a success event:', body.code)
    return { received: true }
  }

  // Use body.data.reference (not externalref) — your webhook payload uses "reference"
  // const externalref = body.data?.externalref ?? (body.data as any)?.reference
  const externalref = body.data?.externalref || body.data?.reference
    if (!externalref) {
      console.warn('[Moolre] Webhook missing externalref — cannot match order')
      return { received: true }
    }

    const existingOrder = await prisma.order.findFirst({ where: { paystackRef: externalref } })
    if (!existingOrder) {
      console.warn(`[Moolre] No order found for reference: ${externalref}`)
      return { received: true }
    }

    // Idempotency — already credited
    if (existingOrder.merchantAmount !== null) {
      console.log(`[Moolre] Order ${existingOrder.id} already credited — skipping`)
      return { received: true }
    }

    const grossAmount = new Prisma.Decimal(body.data?.amount || existingOrder.totalAmount)

    const paidOrder = await prisma.order.update({
      where: { id: existingOrder.id },
      data: {
        totalAmount: grossAmount,
        currency: 'GHS',
        status: 'pending', // merchant fulfillment still required
      },
    })

    await this.creditMerchantLedger(existingOrder.tenantId, existingOrder.id, grossAmount, externalref)
    void this.tenantEvents.recordForTenant(existingOrder.tenantId, 'payment_received', {
      orderId: existingOrder.id,
      reference: externalref,
      amount: Number(grossAmount).toFixed(2),
      currency: 'GHS',
      customerName: existingOrder.customerName,
      customerEmail: existingOrder.customerEmail,
      provider: 'moolre',
    })
    void this.orderAgent.onPaymentConfirmed(paidOrder, 'moolre').catch(() => null)

    console.log(`[Moolre] Ledger credited for order ${existingOrder.id}, amount: ${grossAmount}`)
    return { received: true }
  }

  // ── MOOLRE: verify a payment by reference (called by success page) ────────
  async verifyMoolrePayment(reference: string) {
    if (!reference) throw new BadRequestException('Missing payment reference')

    const existingOrder = await prisma.order.findFirst({ where: { paystackRef: reference } })

    // If we already credited the ledger from the webhook, trust that
    if (existingOrder?.merchantAmount !== null && existingOrder?.merchantAmount !== undefined) {
      return {
        success: true,
        source: 'ledger',
        order: { ...existingOrder, items: this.parseJsonItems(existingOrder.items) },
      }
    }

    // Otherwise poll Moolre directly
    const statusResult = await this.moolreService.checkPaymentStatus(reference)

    if (statusResult.status === 'success') {
      if (existingOrder && existingOrder.merchantAmount === null) {
        const grossAmount = new Prisma.Decimal(statusResult.amount || existingOrder.totalAmount)
        await this.creditMerchantLedger(existingOrder.tenantId, existingOrder.id, grossAmount, reference)
        const refreshed = await prisma.order.findUnique({ where: { id: existingOrder.id } })
        if (refreshed) void this.orderAgent.onPaymentConfirmed(refreshed, 'moolre').catch(() => null)
        return {
          success: true,
          source: 'polled',
          order: refreshed ? { ...refreshed, items: this.parseJsonItems(refreshed.items) } : existingOrder,
        }
      }
    }

    return {
      success: statusResult.status === 'success',
      status: statusResult.status,
      message:
        statusResult.status === 'pending'
          ? 'Payment is being confirmed. Receipt details will follow by email.'
          : 'Payment verification failed.',
    }
  }

  // ── PAYSTACK: legacy — kept intact, only active when PAYMENT_PROVIDER=paystack ──

  async handleWebhook(payload: WebhookPayload, paystackSignature?: string) {
    this.verifyWebhookSignature(payload, paystackSignature)

    const event = payload.event || ''
    const reference = payload.data?.reference
    if (!reference) return { received: true }

    const parsed = this.parseReference(reference)
    const grossAmount = new Prisma.Decimal((payload.data?.amount || 0) / 100)
    const existing = await prisma.paystackEvent.upsert({
      where: { reference },
      update: { rawPayload: payload as Prisma.InputJsonValue },
      create: {
        reference,
        event,
        tenantSlug: parsed?.tenantSlug || payload.data?.metadata?.tenantSlug,
        tenantId: payload.data?.metadata?.tenantId,
        amount: grossAmount,
        currency: payload.data?.currency || 'GHS',
        customerEmail: payload.data?.customer?.email,
        customerName: payload.data?.metadata?.customerName || this.customerNameFromPayload(payload),
        rawPayload: payload as Prisma.InputJsonValue,
      },
    })

    if (existing.processed) return { received: true }

    if (event === 'charge.success' && payload.data?.status === 'success') {
      const tenant = await prisma.tenant.findFirst({
        where: {
          OR: [
            { slug: parsed?.tenantSlug || '' },
            { id: payload.data.metadata?.tenantId || '' },
          ],
        },
      })
      if (!tenant) throw new NotFoundException('Tenant for Paystack reference not found')

      const metadata = payload.data.metadata
      const items = this.normalizeItems(metadata?.items || metadata?.cart || [])
      const existingOrder = await prisma.order.findFirst({ where: { paystackRef: reference } })
      const customerEmail = payload.data.customer?.email || existingOrder?.customerEmail || ''
      const customerName = metadata?.customerName || this.customerNameFromPayload(payload)
      const customerDetails = this.customerDetailsFromMetadata(metadata)
      const customer = customerEmail
        ? await this.upsertCustomer(tenant.id, customerEmail, customerName, customerDetails)
        : null
      const order = existingOrder
        ? await prisma.order.update({
            where: { id: existingOrder.id },
            data: {
              customerId: customer?.id ?? existingOrder.customerId,
              status: existingOrder.merchantAmount ? existingOrder.status : 'pending',
              totalAmount: grossAmount,
              currency: payload.data.currency || 'GHS',
              customerEmail,
              customerName,
              customerPhone: customerDetails.customerPhone,
              shippingAddress: customerDetails.shippingAddress,
              shippingCity: customerDetails.shippingCity,
              shippingCountry: customerDetails.shippingCountry,
              marketingOptIn: Boolean(customerDetails.marketingOptIn),
              items: items as unknown as Prisma.InputJsonValue,
            },
          })
        : await prisma.order.create({
            data: {
              tenantId: tenant.id,
              customerId: customer?.id,
              customerEmail,
              customerName,
              customerPhone: customerDetails.customerPhone,
              shippingAddress: customerDetails.shippingAddress,
              shippingCity: customerDetails.shippingCity,
              shippingCountry: customerDetails.shippingCountry,
              marketingOptIn: Boolean(customerDetails.marketingOptIn),
              totalAmount: grossAmount,
              currency: payload.data.currency || 'GHS',
              status: 'pending',
              paystackRef: reference,
              items: items as unknown as Prisma.InputJsonValue,
            },
          })

      await this.creditMerchantLedger(tenant.id, order.id, grossAmount, reference)
      void this.tenantEvents.recordForTenant(tenant.id, 'payment_received', {
        orderId: order.id,
        reference,
        amount: Number(grossAmount).toFixed(2),
        currency: 'GHS',
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        provider: 'paystack',
      })
      void this.orderAgent.onPaymentConfirmed(order, 'paystack').catch(() => null)
    }

    return { received: true }
  }

  async verifyPayment(reference: string) {
    if (!reference) throw new BadRequestException('Missing payment reference')

    if (activeProvider() === 'moolre') {
      return this.verifyMoolrePayment(reference)
    }

    return this.verifyPaystackPayment(reference)
  }

  private async verifyPaystackPayment(reference: string) {
    const verification = await this.paystackService.verifyTransaction(reference)
    if (!verification.status || verification.data?.status !== 'success') {
      return {
        success: false,
        status: verification.data?.status || 'unknown',
        message: verification.message || 'Payment has not been confirmed by Paystack',
      }
    }

    const existingOrder = await prisma.order.findFirst({ where: { paystackRef: reference } })
    const parsed = this.parseReference(reference)
    const tenant = existingOrder
      ? await prisma.tenant.findUnique({ where: { id: existingOrder.tenantId } })
      : await prisma.tenant.findFirst({ where: { slug: parsed?.tenantSlug || '' } })
    if (!tenant) throw new NotFoundException('Tenant for Paystack reference not found')

    const metadata = verification.data.metadata || {}
    const customerEmail = verification.data.customer?.email || existingOrder?.customerEmail || ''
    if (!customerEmail) throw new BadRequestException('Paystack verification did not include a customer email')

    const customerName =
      this.stringFromMeta(metadata, 'customerName') ||
      existingOrder?.customerName ||
      [verification.data.customer?.first_name, verification.data.customer?.last_name].filter(Boolean).join(' ')
    const customerDetails = this.customerDetailsFromRecord(metadata)
    const customer = await this.upsertCustomer(tenant.id, customerEmail, customerName, customerDetails)
    const grossAmount = new Prisma.Decimal((verification.data.amount || 0) / 100)
    const currency = verification.data.currency || existingOrder?.currency || 'GHS'
    const items = this.checkoutItemsFromMetadata(metadata, existingOrder?.items)
    const wasAlreadyCredited = existingOrder?.merchantAmount !== null && existingOrder?.merchantAmount !== undefined

    const order = existingOrder
      ? await prisma.order.update({
          where: { id: existingOrder.id },
          data: {
            customerId: customer.id,
            customerEmail,
            customerName,
            customerPhone: customerDetails.customerPhone,
            shippingAddress: customerDetails.shippingAddress,
            shippingCity: customerDetails.shippingCity,
            shippingCountry: customerDetails.shippingCountry,
            marketingOptIn: Boolean(customerDetails.marketingOptIn),
            totalAmount: grossAmount,
            currency,
            status: existingOrder.merchantAmount ? existingOrder.status : 'pending',
            items: items as unknown as Prisma.InputJsonValue,
          },
        })
      : await prisma.order.create({
          data: {
            tenantId: tenant.id,
            customerId: customer.id,
            customerEmail,
            customerName,
            customerPhone: customerDetails.customerPhone,
            shippingAddress: customerDetails.shippingAddress,
            shippingCity: customerDetails.shippingCity,
            shippingCountry: customerDetails.shippingCountry,
            marketingOptIn: Boolean(customerDetails.marketingOptIn),
            totalAmount: grossAmount,
            currency,
            status: 'pending',
            paystackRef: reference,
            items: items as unknown as Prisma.InputJsonValue,
          },
        })

    await prisma.paystackEvent.upsert({
      where: { reference },
      update: {
        event: 'charge.success',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        amount: grossAmount,
        currency,
        customerEmail,
        customerName,
        rawPayload: verification as unknown as Prisma.InputJsonValue,
      },
      create: {
        reference,
        event: 'charge.success',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        amount: grossAmount,
        currency,
        customerEmail,
        customerName,
        rawPayload: verification as unknown as Prisma.InputJsonValue,
      },
    })

    await this.creditMerchantLedger(tenant.id, order.id, grossAmount, reference)
    if (!wasAlreadyCredited) {
      void this.tenantEvents.recordForTenant(tenant.id, 'payment_received', {
        orderId: order.id,
        reference,
        amount: Number(grossAmount).toFixed(2),
        currency: 'GHS',
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        provider: 'paystack',
      })
      void this.orderAgent.onPaymentConfirmed(order, 'paystack').catch(() => null)
    }
    const refreshedOrder = await prisma.order.findUnique({ where: { id: order.id } })

    return {
      success: true,
      order: refreshedOrder ? { ...refreshedOrder, items: this.parseJsonItems(refreshedOrder.items) } : order,
    }
  }

  // ── Shared: ledger credit — unchanged ────────────────────────────────────
  async creditMerchantLedger(
    tenantId: string,
    orderId: string,
    grossAmountInput: Prisma.Decimal | number,
    reference?: string,
  ) {
    const grossAmount = new Prisma.Decimal(grossAmountInput)
    const feePercent = new Prisma.Decimal(process.env.SELTRA_FEE_PERCENT || 0)
    const seltraFee = grossAmount.mul(feePercent).div(100)
    const merchantAmount = grossAmount.minus(seltraFee)

    const existingTx = await prisma.ledgerTransaction.findFirst({ where: { orderId, type: 'credit' } })
    if (existingTx) {
      await prisma.paystackEvent.updateMany({ where: { reference }, data: { processed: true, tenantId } }).catch(() => null)
      return existingTx
    }

    const ledger = await prisma.merchantLedger.upsert({
      where: { tenantId },
      update: { balance: { increment: merchantAmount } },
      create: { tenantId, balance: merchantAmount, currency: 'GHS' },
    })

    const tx = await prisma.ledgerTransaction.create({
      data: {
        ledgerId: ledger.id,
        orderId,
        type: 'credit',
        amount: merchantAmount,
        currency: 'GHS',
        description: 'Order payment credited',
        meta: { grossAmount, seltraFee, reference } as unknown as Prisma.InputJsonValue,
      },
    })

    await prisma.order.update({
      where: { id: orderId },
      data: { disbursed: false, merchantAmount, seltraFee },
    })

    // Only update paystackEvent if using Paystack (avoids error on Moolre payments with no event row)
    if (reference) {
      await prisma.paystackEvent.updateMany({ where: { reference }, data: { processed: true, tenantId } }).catch(() => null)
    }

    return tx
  }

  // ── Unchanged methods below ───────────────────────────────────────────────

  async getMerchantLedger(authorization?: string, tenantId?: string, pageInput = 1, perPageInput = 10) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const page = Math.max(1, pageInput)
    const perPage = Math.min(50, Math.max(1, perPageInput))
    const ledger = await prisma.merchantLedger.upsert({
      where: { tenantId: resolvedTenantId },
      update: {},
      create: { tenantId: resolvedTenantId, balance: 0, currency: 'GHS' },
    })
    const [transactions, total] = await Promise.all([
      prisma.ledgerTransaction.findMany({
        where: { ledgerId: ledger.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.ledgerTransaction.count({ where: { ledgerId: ledger.id } }),
    ])
    return { ...ledger, transactions, total, page, perPage }
  }

  getPayoutOptions() {
    return {
      country: 'Ghana',
      mobileMoney: Array.from(GHANA_TELCOS.values()),
      banks: Array.from(GHANA_BANKS.values()),
    }
  }

  async validatePayoutAccount(
    authorization: string | undefined,
    body: { tenantId?: string; method?: string; providerCode?: string; account?: string },
  ) {
    const tenantId = await this.resolveTenantId(authorization, body.tenantId)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Store not found')

    const method = this.normalizePayoutMethod(body.method)
    const provider = this.resolvePayoutProvider(method, body.providerCode)
    const account = this.normalizeAccount(body.account)
    const result = await this.moolreService.validateReceiverName({ method, providerCode: provider.code, account })
    if (!result.success || !result.accountName) {
      throw new BadRequestException(result.error || 'Could not validate payout account')
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        payoutMethod: method,
        payoutProvider: provider.label,
        payoutProviderCode: provider.code,
        payoutAccount: account,
        payoutAccountName: result.accountName,
        payoutValidatedAt: new Date(),
      },
    })

    return {
      success: true,
      accountName: result.accountName,
      payout: this.payoutFromTenant(updated),
    }
  }

  async requestDisbursement(authorization: string | undefined, tenantId?: string, amountInput?: string | number) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const tenant = await prisma.tenant.findUnique({
      where: { id: resolvedTenantId },
      include: { owner: { include: { application: true } } },
    })
    if (!tenant) throw new NotFoundException('Store not found')
    if (!tenant.payoutMethod || !tenant.payoutProviderCode || !tenant.payoutAccount) {
      throw new BadRequestException('Add and validate payout details before requesting disbursement')
    }
    const merchantPhone = this.merchantPhoneFromTenant(tenant)
    if (!merchantPhone) {
      throw new BadRequestException('Add a merchant phone number before requesting disbursement OTP')
    }

    const ledger = await prisma.merchantLedger.upsert({
      where: { tenantId: resolvedTenantId },
      update: {},
      create: { tenantId: resolvedTenantId, balance: 0, currency: 'GHS' },
    })
    const balance = new Prisma.Decimal(ledger.balance)
    const requestedAmount = new Prisma.Decimal(amountInput ?? 0)
    const minimumReserve = new Prisma.Decimal(50)
    if (balance.lte(0)) {
      throw new BadRequestException('No balance available for disbursement')
    }
    if (requestedAmount.lte(0)) {
      throw new BadRequestException('Enter the amount you want to disburse')
    }
    if (requestedAmount.gt(balance)) {
      throw new BadRequestException('Disbursement amount is higher than your available balance')
    }
    if (balance.minus(requestedAmount).lt(minimumReserve)) {
      throw new BadRequestException('At least GHS 50.00 must remain in your Seltra balance')
    }

    const otp = String(randomInt(100000, 999999))
    const externalRef = `seltra_disb_${resolvedTenantId.slice(0, 8)}_${Date.now()}`
    const disbursement = await prisma.disbursement.create({
      data: {
        tenantId: resolvedTenantId,
        ledgerId: ledger.id,
        amount: requestedAmount,
        currency: ledger.currency,
        status: 'pending_otp',
        provider: tenant.payoutProvider,
        providerCode: tenant.payoutProviderCode,
        account: tenant.payoutAccount,
        accountName: tenant.payoutAccountName,
        externalRef,
        otpHash: this.hashOtp(otp),
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })

    const smsBalance = await this.moolreService.checkSmsBalance()
    if (!smsBalance.success) {
      await prisma.disbursement.delete({ where: { id: disbursement.id } }).catch(() => null)
      throw new BadRequestException(`Could not verify SMS bundle balance: ${smsBalance.error}`)
    }
    if ((smsBalance.balance ?? 0) <= 0) {
      await prisma.disbursement.delete({ where: { id: disbursement.id } }).catch(() => null)
      throw new BadRequestException('SMS bundle balance is insufficient to send disbursement OTP. Top up SMS credits in the Moolre dashboard SMS section.')
    }

    const otpSms = await this.moolreService.sendSms({
      to: merchantPhone,
      message: `Seltra payout OTP: ${otp}. Confirm ${ledger.currency} ${requestedAmount.toFixed(2)} to ${tenant.payoutAccountName || tenant.payoutProvider || 'your payout account'}. Expires in 10 minutes.`,
    })
    if (!otpSms.success) {
      await prisma.disbursement.delete({ where: { id: disbursement.id } }).catch(() => null)
      throw new BadRequestException(
        otpSms.error
          ? `Could not send disbursement OTP: ${otpSms.error}`
          : 'Could not send disbursement OTP to merchant phone',
      )
    }
    void this.tenantEvents.recordForTenant(resolvedTenantId, 'disbursement_requested', {
      disbursementId: disbursement.id,
      amount: requestedAmount.toString(),
      currency: ledger.currency,
    })

    return {
      success: true,
      disbursementId: disbursement.id,
      expiresAt: disbursement.otpExpiresAt,
    }
  }

  // async confirmDisbursement(
  //   authorization: string | undefined,
  //   body: { tenantId?: string; disbursementId?: string; otp?: string },
  // ) {
  //   const tenantId = await this.resolveTenantId(authorization, body.tenantId)
  //   if (!body.disbursementId || !body.otp) throw new BadRequestException('Missing disbursement OTP details')

  //   const disbursement = await prisma.disbursement.findFirst({
  //     where: { id: body.disbursementId, tenantId },
  //     include: { tenant: { include: { owner: { include: { application: true } } } }, ledger: true },
  //   })
  //   if (!disbursement) throw new NotFoundException('Disbursement request not found')
  //   if (disbursement.status !== 'pending_otp') throw new BadRequestException('Disbursement is not awaiting OTP')
  //   if (!disbursement.otpExpiresAt || disbursement.otpExpiresAt.getTime() < Date.now()) {
  //     throw new BadRequestException('Disbursement OTP has expired')
  //   }
  //   if (disbursement.otpHash !== this.hashOtp(body.otp)) throw new BadRequestException('Invalid disbursement OTP')

  //   const amount = new Prisma.Decimal(disbursement.amount)
  //   const ledger = await prisma.merchantLedger.findUnique({ where: { id: disbursement.ledgerId } })
  //   if (!ledger || new Prisma.Decimal(ledger.balance).lt(amount)) {
  //     throw new BadRequestException('Ledger balance is no longer enough for this disbursement')
  //   }

  //   const method = this.normalizePayoutMethod(disbursement.tenant.payoutMethod || disbursement.status)
  //   const transfer = await this.moolreService.initiateTransfer({
  //     method,
  //     providerCode: disbursement.providerCode || '',
  //     amount: amount.toFixed(2),
  //     account: disbursement.account,
  //     externalRef: disbursement.externalRef,
  //     reference: `Seltra payout ${disbursement.tenant.name}`,
  //     receiverName: disbursement.accountName || undefined,
  //   })
  //   if (!transfer.success) throw new BadRequestException(transfer.error || 'Disbursement transfer failed')

  //   const [, tx] = await prisma.$transaction([
  //     prisma.merchantLedger.update({
  //       where: { id: disbursement.ledgerId },
  //       data: { balance: { decrement: amount } },
  //     }),
  //     prisma.ledgerTransaction.create({
  //       data: {
  //         ledgerId: disbursement.ledgerId,
  //         type: 'debit',
  //         amount,
  //         currency: disbursement.currency,
  //         description: 'Payout sent',
  //         meta: {
  //           disbursementId: disbursement.id,
  //           provider: disbursement.provider,
  //           account: disbursement.account,
  //           accountName: disbursement.accountName,
  //           transactionid: transfer.transactionid,
  //           testMode: transfer.testMode,
  //         } as unknown as Prisma.InputJsonValue,
  //       },
  //     }),
  //     prisma.disbursement.update({
  //       where: { id: disbursement.id },
  //       data: {
  //         status: 'paid',
  //         transactionId: transfer.transactionid,
  //         rawResponse: transfer.raw as Prisma.InputJsonValue,
  //         confirmedAt: new Date(),
  //         otpHash: null,
  //       },
  //     }),
  //   ])

  //   await this.markOrdersDisbursed(tenantId)
  //   void this.tenantEvents.recordForTenant(tenantId, 'disbursement_paid', {
  //     disbursementId: disbursement.id,
  //     amount: amount.toString(),
  //     currency: disbursement.currency,
  //     transactionid: transfer.transactionid,
  //     testMode: transfer.testMode,
  //   })
  //   void this.resendService.sendMerchantReceipt({
  //     to: disbursement.tenant.owner?.email || '',
  //     merchantName: disbursement.tenant.owner?.name,
  //     storeName: disbursement.tenant.name,
  //     amount: amount.toFixed(2),
  //     currency: disbursement.currency,
  //     account: disbursement.account,
  //     provider: disbursement.provider,
  //     reference: disbursement.externalRef,
  //   }).catch(() => null)
  //   void this.moolreService.sendSms({
  //     to: this.merchantPhoneFromTenant(disbursement.tenant),
  //     message: `Seltra payout sent: ${disbursement.currency} ${amount.toFixed(2)} to ${disbursement.provider || 'your payout account'}.`,
  //   })

  //   return { success: true, transaction: tx, disbursementId: disbursement.id, testMode: transfer.testMode }
  // }
  async confirmDisbursement(
    authorization: string | undefined,
    body: { tenantId?: string; disbursementId?: string; otp?: string },
  ) {
    const tenantId = await this.resolveTenantId(authorization, body.tenantId)
    if (!body.disbursementId || !body.otp) throw new BadRequestException('Missing disbursement OTP details')

    const disbursement = await prisma.disbursement.findFirst({
      where: { id: body.disbursementId, tenantId },
      include: { tenant: { include: { owner: { include: { application: true } } } }, ledger: true },
    })
    if (!disbursement) throw new NotFoundException('Disbursement request not found')

    // Idempotency guard #1: already fully completed — just tell the client it's done.
    if (disbursement.status === 'paid') {
      return { success: true, disbursementId: disbursement.id, alreadyProcessed: true }
    }

    if (disbursement.status !== 'pending_otp' && disbursement.status !== 'transfer_sent') {
      throw new BadRequestException('Disbursement is not awaiting OTP')
    }

    // Only check OTP/expiry if we haven't already sent the transfer to Moolre.
    // If status is 'transfer_sent', money already moved — we just need to finish
    // the ledger write below, regardless of OTP expiry.
    if (disbursement.status === 'pending_otp') {
      if (!disbursement.otpExpiresAt || disbursement.otpExpiresAt.getTime() < Date.now()) {
        throw new BadRequestException('Disbursement OTP has expired')
      }
      if (disbursement.otpHash !== this.hashOtp(body.otp)) throw new BadRequestException('Invalid disbursement OTP')
    }

    const amount = new Prisma.Decimal(disbursement.amount)
    const ledger = await prisma.merchantLedger.findUnique({ where: { id: disbursement.ledgerId } })
    if (!ledger) throw new BadRequestException('Ledger not found for this disbursement')

    let transactionId = disbursement.transactionId
    let transferRaw: unknown = disbursement.rawResponse
    let testMode = false

    // Idempotency guard #2: only call Moolre if we haven't already sent this transfer.
    if (disbursement.status === 'pending_otp') {
      if (new Prisma.Decimal(ledger.balance).lt(amount)) {
        throw new BadRequestException('Ledger balance is no longer enough for this disbursement')
      }

      const method = this.normalizePayoutMethod(disbursement.tenant.payoutMethod || undefined)
      const transfer = await this.moolreService.initiateTransfer({
        method,
        providerCode: disbursement.providerCode || '',
        amount: amount.toFixed(2),
        account: disbursement.account,
        externalRef: disbursement.externalRef,
        reference: `Seltra payout ${disbursement.tenant.name}`,
        receiverName: disbursement.accountName || undefined,
      })
      if (!transfer.success) throw new BadRequestException(transfer.error || 'Disbursement transfer failed')

      transactionId = transfer.transactionid ?? null
      transferRaw = transfer.raw as Prisma.InputJsonValue
      testMode = Boolean(transfer.testMode)

      // Persist immediately — money has now moved. Even if the ledger
      // transaction below throws, we will never call initiateTransfer
      // again for this disbursement (status is no longer 'pending_otp').
      await prisma.disbursement.update({
        where: { id: disbursement.id },
        data: {
          status: 'transfer_sent',
          transactionId,
          rawResponse: transferRaw as Prisma.InputJsonValue,
          otpHash: null,
        },
      })
    }

    const [, tx] = await prisma.$transaction([
      prisma.merchantLedger.update({
        where: { id: disbursement.ledgerId },
        data: { balance: { decrement: amount } },
      }),
      prisma.ledgerTransaction.create({
        data: {
          ledgerId: disbursement.ledgerId,
          type: 'debit',
          amount,
          currency: disbursement.currency,
          description: 'Payout sent',
          meta: {
            disbursementId: disbursement.id,
            provider: disbursement.provider,
            account: disbursement.account,
            accountName: disbursement.accountName,
            transactionid: transactionId,
            testMode,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.disbursement.update({
        where: { id: disbursement.id },
        data: {
          status: 'paid',
          confirmedAt: new Date(),
        },
      }),
    ])

    await this.markOrdersDisbursed(tenantId)
    void this.tenantEvents.recordForTenant(tenantId, 'disbursement_paid', {
      disbursementId: disbursement.id,
      amount: amount.toString(),
      currency: disbursement.currency,
      transactionid: transactionId,
      testMode,
    })
    void this.resendService.sendMerchantReceipt({
      to: disbursement.tenant.owner?.email || '',
      merchantName: disbursement.tenant.owner?.name,
      storeName: disbursement.tenant.name,
      amount: amount.toFixed(2),
      currency: disbursement.currency,
      account: disbursement.account,
      provider: disbursement.provider,
      reference: disbursement.externalRef,
    }).catch(() => null)
    void this.moolreService.sendSms({
      to: this.merchantPhoneFromTenant(disbursement.tenant),
      message: `Seltra payout sent: ${disbursement.currency} ${amount.toFixed(2)} to ${disbursement.provider || 'your payout account'}.`,
    }).then((sms) => {
      if (!sms.success) {
        console.error('[Payment] payout confirmation SMS failed:', sms.error, sms.raw)
      }
    }).catch((err) => {
      console.error('[Payment] payout confirmation SMS error:', err)
    })

    return { success: true, transaction: tx, disbursementId: disbursement.id, testMode }
  }
  

  async getMerchantSales(authorization: string | undefined, page = 1, perPage = 20, tenantId?: string) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const skip = (page - 1) * perPage
    const where = { tenantId: resolvedTenantId, merchantAmount: { not: null } }
    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: perPage }),
      prisma.order.count({ where }),
    ])
    return {
      data: orders.map((order) => ({ ...order, items: order.items })),
      total, page, perPage,
    }
  }

  async getMerchantCustomers(authorization?: string, tenantId?: string, pageInput = 1, perPageInput = 10) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const page = Math.max(1, pageInput)
    const perPage = Math.min(50, Math.max(1, perPageInput))
    const where = { tenantId: resolvedTenantId }
    const customers = await prisma.customer.findMany({
      where,
      include: {
        orders: { where: { merchantAmount: { not: null } }, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    })
    const total = await prisma.customer.count({ where })

    const data = customers.map((customer) => {
      const totalSpent = customer.orders.reduce((sum, order) => sum.add(order.totalAmount), new Prisma.Decimal(0))
      const lastOrder = customer.orders[0]
      return {
        id: customer.id, tenantId: customer.tenantId, name: customer.name, email: customer.email,
        phone: customer.phone, address: customer.address, city: customer.city, country: customer.country,
        marketingOptIn: customer.marketingOptIn, orderCount: customer.orders.length, totalSpent,
        currency: lastOrder?.currency || 'GHS', lastOrderAt: lastOrder?.createdAt,
        isRecurring: customer.orders.length > 1, createdAt: customer.createdAt, updatedAt: customer.updatedAt,
      }
    })
    return { data, total, page, perPage }
  }

  async resolveTenantId(authorization?: string, requestedTenantId?: string) {
    const userId = await this.userIdFromAuth(authorization)
    if (requestedTenantId) {
      const tenant = await prisma.tenant.findFirst({ where: { id: requestedTenantId, ownerId: userId } })
      if (!tenant) throw new NotFoundException('Store not found')
      return tenant.id
    }
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: userId }, orderBy: { updatedAt: 'desc' } })
    if (!tenant) throw new NotFoundException('No store found for this merchant')
    return tenant.id
  }

  private normalizeItems(items: CheckoutItem[]): NormalizedCheckoutItem[] {
    return (items || []).map((item) => {
      const product = item.product || {}
      const price = Number(item.price ?? product.price ?? 0)
      const quantity = Number(item.quantity || 1)
      return {
        ...(item.type ? { type: item.type } : {}),
        productId: item.productId || product.id,
        productName: item.name || product.name || 'Product',
        quantity, price,
        ...(item.selectedVariants ? { selectedVariants: item.selectedVariants } : {}),
        ...(item.deliveryTier ? { deliveryTier: item.deliveryTier } : {}),
      }
    })
  }

  private withDeliveryTier(items: NormalizedCheckoutItem[], deliveryTier?: DeliveryTierSelection): NormalizedCheckoutItem[] {
    if (!deliveryTier?.id) return items
    const price = Number(deliveryTier.priceFrom || 0)
    return [
      ...items,
      {
        type: 'delivery_tier',
        productId: `delivery:${deliveryTier.id}`,
        productName: deliveryTier.label,
        quantity: 1,
        price,
        deliveryTier,
      },
    ]
  }

  private verifyWebhookSignature(payload: WebhookPayload, signature?: string) {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY
    if (!secret) return
    const expected = createHmac('sha512', secret).update(JSON.stringify(payload)).digest('hex')
    if (!signature || signature !== expected) throw new UnauthorizedException('Invalid Paystack signature')
  }

  private async upsertCustomer(tenantId: string, email: string, name?: string, details: CustomerDetails = {}) {
    const normalizedEmail = email.trim().toLowerCase()
    return prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email: normalizedEmail } },
      update: {
        name: name || undefined, phone: details.customerPhone || undefined,
        address: details.shippingAddress || undefined, city: details.shippingCity || undefined,
        country: details.shippingCountry || undefined, marketingOptIn: Boolean(details.marketingOptIn),
      },
      create: {
        tenantId, email: normalizedEmail, name: name || '',
        phone: details.customerPhone, address: details.shippingAddress,
        city: details.shippingCity, country: details.shippingCountry,
        marketingOptIn: Boolean(details.marketingOptIn),
      },
    })
  }

  private customerDetailsFromMetadata(metadata?: WebhookMetadata): CustomerDetails {
    return {
      customerPhone: metadata?.customerPhone, shippingAddress: metadata?.shippingAddress,
      shippingCity: metadata?.shippingCity, shippingCountry: metadata?.shippingCountry,
      marketingOptIn: Boolean(metadata?.marketingOptIn),
    }
  }

  private customerDetailsFromRecord(metadata?: Record<string, unknown>): CustomerDetails {
    return {
      customerPhone: this.stringFromMeta(metadata, 'customerPhone'),
      shippingAddress: this.stringFromMeta(metadata, 'shippingAddress'),
      shippingCity: this.stringFromMeta(metadata, 'shippingCity'),
      shippingCountry: this.stringFromMeta(metadata, 'shippingCountry'),
      marketingOptIn: Boolean(metadata?.marketingOptIn),
    }
  }

  private checkoutItemsFromMetadata(metadata?: Record<string, unknown>, fallback?: unknown) {
    const items = Array.isArray(metadata?.items) ? metadata.items : Array.isArray(metadata?.cart) ? metadata.cart : fallback
    return this.parseJsonItems(items)
  }

  private parseJsonItems(items: unknown) { return Array.isArray(items) ? items : [] }

  private stringFromMeta(metadata: Record<string, unknown> | undefined, key: string) {
    const value = metadata?.[key]
    return typeof value === 'string' ? value : undefined
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

  private normalizePayoutMethod(method?: string): PayoutMethod {
    const value = (method || '').toLowerCase().replace(/[\s-]+/g, '_')
    if (value === 'bank' || value === 'bank_transfer') return 'bank'
    if (value === 'mobile_money' || value === 'momo') return 'mobile_money'
    throw new BadRequestException('Unsupported payout method')
  }

  private resolvePayoutProvider(method: PayoutMethod, providerCode?: string) {
    const key = (providerCode || '').toLowerCase()
    const direct = method === 'bank' ? GHANA_BANKS.get(key) : GHANA_TELCOS.get(key)
    const byCode = Array.from(method === 'bank' ? GHANA_BANKS.values() : GHANA_TELCOS.values())
      .find((provider) => provider.code.toLowerCase() === key)
    const provider = direct || byCode
    if (!provider) throw new BadRequestException('Unsupported payout provider for Ghana')
    return provider
  }

  private normalizeAccount(account?: string) {
    const cleaned = (account || '').replace(/[^\d]/g, '')
    if (cleaned.length < 8) throw new BadRequestException('Enter a valid payout account number')
    return cleaned
  }

  private payoutFromTenant(tenant: {
    payoutMethod?: string | null
    payoutProvider?: string | null
    payoutProviderCode?: string | null
    payoutAccount?: string | null
    payoutAccountName?: string | null
    payoutValidatedAt?: Date | null
  }) {
    return {
      method: tenant.payoutMethod,
      provider: tenant.payoutProvider,
      providerCode: tenant.payoutProviderCode,
      account: tenant.payoutAccount,
      accountName: tenant.payoutAccountName,
      validatedAt: tenant.payoutValidatedAt,
    }
  }

  private hashOtp(otp: string) {
    return createHash('sha256').update(`${process.env.JWT_SECRET || 'change-me'}:${otp}`).digest('hex')
  }

  private merchantPhoneFromTenant(tenant: { owner?: { application?: { phone?: string | null } | null } | null }) {
    return tenant.owner?.application?.phone
  }

  private async markOrdersDisbursed(tenantId: string) {
    await prisma.order.updateMany({
      where: { tenantId, merchantAmount: { not: null }, disbursed: false },
      data: { disbursed: true, disbursedAt: new Date() },
    })
  }

  private customerNameFromPayload(payload: WebhookPayload) {
    return [payload.data?.customer?.first_name, payload.data?.customer?.last_name].filter(Boolean).join(' ')
  }
}

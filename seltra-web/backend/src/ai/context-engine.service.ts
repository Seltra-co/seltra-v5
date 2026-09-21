//backend/src/ai/context-engine.service.ts
import { Injectable } from '@nestjs/common'
import { prisma } from '../db'
import { loadMerchantContext } from './agents/merchants-context'

@Injectable()
export class ContextEngine {
  async build(tenantId: string, conversationMessage?: string) {
    const [tenant, memory, orders] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          products: {
            select: { id: true, name: true, price: true, currency: true, category: true },
            orderBy: { updatedAt: 'desc' },
            take: 25,
          },
          customers: { select: { id: true }, take: 1 },
        },
      }),
      loadMerchantContext(tenantId),
      prisma.order.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ])

    if (!tenant) return ''

    const paidOrders = orders.filter((order) => order.merchantAmount !== null && order.merchantAmount !== undefined)
    const pendingOrders = orders.filter((order) => order.status === 'pending')
    const revenue = paidOrders.reduce((sum, order) => sum + Number(order.merchantAmount ?? order.totalAmount ?? 0), 0)
    const bestSeller = this.bestSellerFromOrders(orders)

    return [
      'ContextEngine.build():',
      `Merchant owns ${tenant.name}.`,
      tenant.businessType ? `Business type: ${tenant.businessType}.` : '',
      tenant.targetAudience ? `Audience: ${tenant.targetAudience}.` : '',
      memory ? `Merchant memory: tone=${memory.tonePreference}; intents=${memory.recentIntents.join(', ') || 'none'}; key phrases=${memory.keyPhrases.join(', ') || 'none'}.` : '',
      `Catalog: ${tenant.products.length} products.`,
      bestSeller ? `Best seller signal: ${bestSeller}.` : '',
      `Orders: ${orders.length} recent, ${pendingOrders.length} pending, ${paidOrders.length} paid.`,
      `Revenue signal: ${revenue.toFixed(2)} ${tenant.products[0]?.currency ?? 'GHS'}.`,
      conversationMessage ? `Current merchant message: ${conversationMessage}` : '',
    ].filter(Boolean).join('\n')
  }

  private bestSellerFromOrders(orders: Array<{ items: unknown }>) {
    const counts = new Map<string, number>()
    for (const order of orders) {
      const items = Array.isArray(order.items) ? order.items : []
      for (const item of items) {
        const record = item as { productName?: string; name?: string; quantity?: number }
        const name = record.productName || record.name
        if (!name) continue
        counts.set(name, (counts.get(name) ?? 0) + Number(record.quantity || 1))
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
}

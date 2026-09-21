//orders/order-agent.service.ts
import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { MoolreService } from '../payment/moolre.service'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { AgentEventsService } from '../agent/agent-events.service'

type OrderForAgent = {
  id: string
  tenantId: string
  customerName?: string | null
  customerEmail: string
  customerPhone?: string | null
  totalAmount: Prisma.Decimal
  currency: string
  status: string
}

@Injectable()
export class OrderAgentService {
  constructor(
    private readonly moolre: MoolreService,
    private readonly tenantEvents: TenantEventsService,
    private readonly agentEvents: AgentEventsService,
  ) {}

  async onOrderCreated(order: OrderForAgent, provider?: string) {
    const amount = `${order.currency} ${order.totalAmount.toString()}`
    const customer = order.customerName || order.customerEmail

    await this.record(order.tenantId, 'order.created', 'ORDER_CREATED', { orderId: order.id, amount, customer, provider })
  }

  async onPaymentConfirmed(order: OrderForAgent, provider?: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: order.tenantId }, include: { owner: { include: { application: true } } } })
    const amount = `${order.currency} ${Number(order.totalAmount).toFixed(2)}`
    const customer = order.customerName || order.customerEmail
    const merchantMessage = `New sale on ${tenant?.name || 'Seltra'}.\nCustomer: ${customer}\nAmount: ${amount}\nLog in to Seltra to process this order.`
    const customerMessage = `Payment received. Your order from ${tenant?.name || 'this merchant'} has been confirmed and is being prepared. Powered by Seltra.`

    await this.moolre.sendSms({ to: tenant?.owner?.application?.phone, message: merchantMessage }).catch(() => null)
    await this.moolre.sendSms({ to: order.customerPhone, message: customerMessage }).catch(() => null)
    await this.record(order.tenantId, 'payment.completed', 'PAYMENT_COMPLETED', {
      orderId: order.id,
      amount,
      provider,
    })
  }

  async onStatusUpdated(order: OrderForAgent) {
    const message = `Your order is now ${order.status}.`
    await this.moolre.sendSms({ to: order.customerPhone, message }).catch(() => null)
    await this.record(order.tenantId, 'order.status.updated', 'ORDER_STATUS_UPDATED', { orderId: order.id, status: order.status })
  }

  @Cron(CronExpression.EVERY_HOUR)
  async remindPendingOrders() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const orders = await prisma.order.groupBy({
      by: ['tenantId'],
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: cutoff } }],
      },
      _count: { _all: true },
    })

    for (const group of orders) {
      const tenant = await prisma.tenant.findUnique({ where: { id: group.tenantId }, include: { owner: { include: { application: true } } } })
      const message = `Reminder: you have ${group._count._all} pending orders waiting in Seltra.`
      await this.moolre.sendSms({ to: tenant?.owner?.application?.phone, message }).catch(() => null)
      await this.tenantEvents.recordForTenant(group.tenantId, 'order_reminder', {
        count: group._count._all,
        message,
      })
      await this.record(group.tenantId, 'order.reminder', 'SEND_REMINDER', { count: group._count._all })
      await prisma.order.updateMany({ where: { tenantId: group.tenantId, status: 'pending', createdAt: { lt: cutoff } }, data: { lastReminderAt: new Date() } })
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async dailySalesSummary() {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const rows = await prisma.order.groupBy({
      by: ['tenantId', 'currency'],
      where: { merchantAmount: { not: null }, createdAt: { gte: start } },
      _sum: { merchantAmount: true },
      _count: { _all: true },
    })
    for (const row of rows) {
      const tenant = await prisma.tenant.findUnique({ where: { id: row.tenantId }, include: { owner: { include: { application: true } } } })
      const revenue = row._sum.merchantAmount?.toString() ?? '0.00'
      const message = `Daily Seltra sales: ${row._count._all} sales today. Revenue ${row.currency} ${Number(revenue).toFixed(2)}.`
      await this.moolre.sendSms({ to: tenant?.owner?.application?.phone, message }).catch(() => null)
      await this.tenantEvents.recordForTenant(row.tenantId, 'sales_summary', {
        sales: row._count._all,
        revenue,
        currency: row.currency,
      })
      await this.record(row.tenantId, 'sales.summary', 'DAILY_SALES_SUMMARY', { sales: row._count._all, revenue })
    }
  }

  private async record(tenantId: string, type: string, action: string, payload: object) {
    await this.agentEvents.emit({
      tenantId,
      agent: 'OrderAgent',
      type,
      action,
      payload: payload as Prisma.InputJsonValue,
    }).catch(() => null)
  }
}

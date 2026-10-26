import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { prisma } from '../../db'

export type TenantEventType =
  | 'product_added'
  | 'order_placed'
  | 'payment_received'
  | 'order_status_updated'
  | 'invoice_created'
  | 'invoice_paid'
  | 'invoice_sent'
  | 'order_reminder'
  | 'sales_summary'
  | 'login'
  | 'settings_changed'
  | 'theme_updated'
  | 'ai_invocation'
  | 'merchant_onboarded'
  | 'disbursement_requested'
  | 'disbursement_paid'

@Injectable()
export class TenantEventsService {
  private readonly logger = new Logger(TenantEventsService.name)

  async recordForTenant(tenantId: string | null | undefined, type: TenantEventType, meta?: Prisma.InputJsonValue) {
    if (!tenantId) return

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, ownerId: true },
    })
    if (!tenant) {
      this.logger.warn(`Tenant ${tenantId} not found. Skipping ${type}.`)
      return
    }

    await prisma.$transaction(async (tx) => {
      const event = await tx.tenantEvent.create({ data: { tenantId, type, meta: meta as Prisma.InputJsonValue } })
      if (tenant.ownerId) {
        await tx.userNotification.create({
          data: {
            userId: tenant.ownerId,
            tenantId,
            tenantEventId: event.id,
            type,
            meta: meta as Prisma.InputJsonValue,
          },
        })
      }
    })
  }

  async recordForUser(userId: string, type: TenantEventType, meta?: Prisma.InputJsonValue, requestedTenantId?: string | null) {
    const tenant = requestedTenantId
      ? await prisma.tenant.findFirst({ where: { id: requestedTenantId, ownerId: userId }, select: { id: true } })
      : null
    if (requestedTenantId && !tenant) {
      this.logger.warn(`Tenant ${requestedTenantId} is not owned by user ${userId}. Saving ${type} to the user inbox only.`)
    }

    await prisma.$transaction(async (tx) => {
      const event = tenant
        ? await tx.tenantEvent.create({ data: { tenantId: tenant.id, type, meta: meta as Prisma.InputJsonValue } })
        : null
      await tx.userNotification.create({
        data: {
          userId,
          tenantId: tenant?.id,
          tenantEventId: event?.id,
          type,
          meta: meta as Prisma.InputJsonValue,
        },
      })
    })
  }

}

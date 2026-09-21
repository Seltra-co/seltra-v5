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

async recordForTenant(
  tenantId: string | null | undefined,
  type: TenantEventType,
   meta?: Prisma.InputJsonValue,
) {
  if (!tenantId) return

  const exists = await prisma.tenant.findUnique({
    where: {
      id: tenantId,
    },
    select: {
      id: true,
    },
  })

  if (!exists) {
    this.logger.warn(
      `Tenant ${tenantId} not found. Skipping ${type}.`,
    )
    return
  }

  await prisma.tenantEvent.create({
    data: {
      tenantId,
      type,
      meta: meta as Prisma.InputJsonValue,
    },
  })
}

}

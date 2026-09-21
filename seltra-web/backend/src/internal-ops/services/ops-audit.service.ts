import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { prisma } from '../../db'

@Injectable()
export class OpsAuditService {
  private readonly logger = new Logger(OpsAuditService.name)

  requireActor(actor?: string) {
    const label = actor?.trim()
    if (!label) throw new BadRequestException('Missing x-ops-actor')
    return label
  }

  async record(actorLabel: string, action: string, targetType: string, targetId: string, payload?: unknown) {
    try {
      await prisma.opsAuditLog.create({
        data: {
          actorLabel,
          action,
          targetType,
          targetId,
          payload: payload == null ? undefined : (payload as Prisma.InputJsonValue),
        },
      })
    } catch (err) {
      this.logger.error(`Ops audit write failed (${action}, ${targetId})`, err as Error)
    }
  }
}

//backend/src/agent/agent-events.service.ts
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { prisma } from '../db'

@Injectable()
export class AgentEventsService {
  async emit(input: {
    tenantId?: string | null
    agent: string
    type: string
    action?: string
    payload?: Prisma.InputJsonValue
    status?: string
  }) {
    await prisma.agentEvent.create({
      data: {
        tenantId: input.tenantId,
        agent: input.agent,
        type: input.type,
        action: input.action,
        payload: input.payload,
        status: input.status ?? 'recorded',
      },
    })
  }
}

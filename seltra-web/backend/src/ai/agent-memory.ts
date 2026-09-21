//backend/src/ai/agent-memory.ts
import { Prisma } from '@prisma/client'
import { prisma } from '../db'

export interface AgentTurn {
  role: 'user' | 'assistant'
  content: string
  action?: string
  manifestDiff?: unknown
}

export async function getRecentAgentTurns(tenantId: string, limit = 6): Promise<AgentTurn[]> {
  const events = await prisma.agentEvent.findMany({
    where: { tenantId, type: 'reply' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { payload: true, action: true, createdAt: true },
  })

  return events
    .reverse()
    .flatMap((event) => {
      const payload = event.payload as { message?: string; actions?: unknown; replyText?: string; manifestDiff?: unknown } | null
      const turns: AgentTurn[] = []

      if (payload?.message) {
        turns.push({ role: 'user', content: payload.message })
      }
      if (payload?.replyText || event.action) {
        turns.push({
          role: 'assistant',
          content: (payload?.replyText as string) || event.action || 'Action executed',
          action: event.action || undefined,
          manifestDiff: payload?.manifestDiff,
        })
      }

      return turns
    })
}

export async function appendAgentTurn(
  tenantId: string,
  turn: { replyText?: string; manifestDiff?: unknown },
  existingPayload?: Record<string, unknown>,
): Promise<void> {
  // Extended payload with replyText and manifestDiff
  const updated = { ...existingPayload, ...turn }
  await prisma.agentEvent.create({
    data: {
      tenantId,
      agent: 'CommerceAgent',
      type: 'reply',
      payload: updated as unknown as Prisma.InputJsonValue,
    },
  }).catch(() => null)
}

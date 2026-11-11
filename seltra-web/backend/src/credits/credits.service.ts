//backend/src/credits/credits.service.ts
import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db'
import { creditAllowanceForPlan, isCreditWindowExpired } from '../common/credit-plan'
import { creditCost, type ModelRole } from '../ai/model-router'
import { mirrorWorkspaceCredit } from './workspace_credit_mirror'

function canonicalPlan(plan?: string | null) {
  return plan === 'premium' || plan === 'pro' ? 'premium' : 'free'
}

const CREDIT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 }

@Injectable()
export class CreditsService {
  async ensureWorkspaceMirror(userId: string) {
    let account = await prisma.userCredit.findUnique({ where: { userId } })
    if (!account) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
      if (!user) throw new Error('Cannot mirror credits for an unknown user.')
      return this.ensureAccount(userId, user.plan)
    }
    await prisma.$transaction((tx) => mirrorWorkspaceCredit(tx, account!))
    return account
  }

  async ensureAccount(userId: string, plan?: string | null) {
    const normalizedPlan = canonicalPlan(plan)
    const allowance = creditAllowanceForPlan(normalizedPlan)
    let account = await prisma.userCredit.findUnique({ where: { userId } })
    if (!account) {
      try {
        account = await prisma.$transaction(async (tx) => {
          const created = await tx.userCredit.create({ data: { userId, balance: allowance, lifetimeGranted: allowance, windowAllowance: allowance, plan: normalizedPlan } })
          await tx.userCreditLedger.create({ data: { id: randomUUID(), userId, kind: 'grant', delta: allowance, balanceAfter: allowance, meta: { reason: 'initial_user_plan_allowance', tokensPerCredit: 1000 } } })
          await mirrorWorkspaceCredit(tx, created)
          return created
        })
      } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')) throw error
        account = await prisma.userCredit.findUnique({ where: { userId } })
      }
    }
    if (!account) throw new Error('Could not initialize the user credit account.')

    const expired = isCreditWindowExpired(account.windowStartedAt)
    const planChanged = account.plan !== normalizedPlan || account.windowAllowance !== allowance
    if (expired || planChanged) {
      account = await this.grant(userId, allowance, expired ? 'daily_utc_reset' : 'plan_allowance_changed', 'reset', normalizedPlan)
    } else {
      await prisma.$transaction((tx) => mirrorWorkspaceCredit(tx, account!))
    }
    return account
  }

  async getAccountSnapshot(userId: string, plan?: string | null) {
    const normalizedPlan = canonicalPlan(plan)
    const allowance = creditAllowanceForPlan(normalizedPlan)
    const account = await prisma.userCredit.findUnique({ where: { userId } })
    if (!account) return this.ensureAccount(userId, normalizedPlan)
    if (isCreditWindowExpired(account.windowStartedAt) || account.plan !== normalizedPlan || account.windowAllowance !== allowance) {
      return this.grant(userId, allowance, isCreditWindowExpired(account.windowStartedAt) ? 'daily_utc_reset' : 'plan_allowance_changed', 'reset', normalizedPlan)
    }
    // Reads for the session/credits UI do not need to rewrite the legacy
    // workspace mirror. Usage commits and plan grants keep that mirror fresh.
    return account
  }

  async commitUsage(input: { userId: string; runId?: string; projectId?: string; role: ModelRole; tokensIn: number; tokensOut: number; reason?: string }) {
    const charge = creditCost(input.tokensIn, input.tokensOut, input.role)
    return prisma.$transaction(async (tx) => {
      const changed = await tx.userCredit.updateMany({
        where: { userId: input.userId, balance: { gte: charge } },
        data: { balance: { decrement: charge }, lifetimeUsed: { increment: charge } },
      })
      if (changed.count !== 1) {
        const current = await tx.userCredit.findUnique({ where: { userId: input.userId }, select: { balance: true } })
        throw new Error(`INSUFFICIENT_CREDITS:${current?.balance ?? 0}`)
      }
      const updated = await tx.userCredit.findUniqueOrThrow({ where: { userId: input.userId } })
      await tx.userCreditLedger.create({
        data: {
          id: randomUUID(), userId: input.userId, runId: input.runId, projectId: input.projectId,
          kind: 'usage', delta: -charge, balanceAfter: updated.balance, modelRole: input.role,
          tokensIn: input.tokensIn, tokensOut: input.tokensOut,
          meta: input.reason ? { reason: input.reason } : undefined,
        },
      })
      await mirrorWorkspaceCredit(tx, updated)
      return updated
    }, CREDIT_TRANSACTION_OPTIONS)
  }

  async grant(userId: string, amount: number, reason: string, kind: 'grant' | 'reset' = 'grant', plan?: string | null) {
    if (!Number.isInteger(amount) || amount < 0) throw new Error('Credit amount must be a non-negative integer.')
    const normalizedPlan = canonicalPlan(plan)
    return prisma.$transaction(async (tx) => {
      const previous = kind === 'reset' ? await tx.userCredit.findUnique({ where: { userId } }) : null
      const current = await tx.userCredit.upsert({
        where: { userId },
        create: { userId, balance: amount, lifetimeGranted: amount, windowAllowance: amount, plan: normalizedPlan },
        update: kind === 'reset'
          ? { balance: amount, lifetimeGranted: { increment: amount }, windowStartedAt: new Date(), windowAllowance: amount, plan: normalizedPlan }
          : { balance: { increment: amount }, lifetimeGranted: { increment: amount } },
      })
      await tx.userCreditLedger.create({
        data: {
          id: randomUUID(), userId, kind,
          delta: kind === 'reset' ? amount - (previous?.balance ?? 0) : amount,
          balanceAfter: current.balance, meta: { reason },
        },
      })
      await mirrorWorkspaceCredit(tx, current)
      return current
    }, CREDIT_TRANSACTION_OPTIONS)
  }
}

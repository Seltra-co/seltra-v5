const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
require('dotenv').config()

const tokensPerCredit = 1000
function configuredAllowance(plan) {
  const freeDefault = 20_000_000
  const freeTokens = Number(process.env.MODEL_MAX_TOKENS_PER_WORKSPACE ?? freeDefault)
  const safeFreeTokens = Number.isFinite(freeTokens) && freeTokens > 0 ? Math.floor(freeTokens) : freeDefault
  const normalizedPlan = plan === 'premium' || plan === 'pro' ? 'premium' : 'free'
  if (normalizedPlan === 'premium') {
    const proTokens = Number(process.env.SELTRA_PRO_MAX_TOKENS_PER_WORKSPACE ?? safeFreeTokens * 5)
    return Math.ceil((Number.isFinite(proTokens) && proTokens > 0 ? Math.floor(proTokens) : safeFreeTokens * 5) / tokensPerCredit)
  }
  return Math.ceil(safeFreeTokens / tokensPerCredit)
}

const args = process.argv.slice(2)
const value = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const command = args[0]
  if (!['reset', 'grant'].includes(command)) throw new Error('Usage: node scripts/credits.js <reset|grant> --workspace <id> --amount <n> --reason <text>')
  const accountOrProjectId = value('--workspace')
  const amount = Number(value('--amount'))
  const reason = value('--reason') ?? `${command} from CLI`
  if (!accountOrProjectId || !Number.isInteger(amount) || amount < 0) throw new Error('User ID (or project ID) and a non-negative integer credit amount are required.')
  const databaseUrl = process.env.DATABASE_URL || ''
  if (!/ep-winter-salad-aqc12bzz/i.test(databaseUrl)) {
    throw new Error('Refusing to run credit changes outside the migration/staging database branch ep-winter-salad-aqc12bzz.')
  }

  const prisma = new PrismaClient()
  try {
    const user = await prisma.user.findUnique({ where: { id: accountOrProjectId }, select: { id: true, plan: true } })
    const project = user ? null : await prisma.tenant.findFirst({ where: { id: accountOrProjectId }, include: { owner: { select: { id: true, plan: true } } } })
    const userId = user?.id ?? project?.ownerId
    if (!userId) throw new Error('No user-owned credit account matches that user or project ID.')
    const accountPlan = user?.plan ?? project?.owner?.plan ?? 'free'
    const plan = accountPlan === 'premium' || accountPlan === 'pro' ? 'premium' : 'free'
    const defaultAllowance = configuredAllowance(plan)

    const current = await prisma.$transaction(async (tx) => {
      const previous = await tx.userCredit.findUnique({ where: { userId } })
      const now = new Date()
      const credit = await tx.userCredit.upsert({
        where: { userId },
        create: { userId, balance: amount, lifetimeGranted: amount, windowAllowance: defaultAllowance, plan, windowStartedAt: now },
        update: command === 'reset'
          ? { balance: amount, lifetimeGranted: { increment: amount }, windowAllowance: defaultAllowance, plan, windowStartedAt: now }
          : { balance: { increment: amount }, lifetimeGranted: { increment: amount }, windowAllowance: defaultAllowance, plan },
      })
      await tx.userCreditLedger.create({
        data: {
          id: randomUUID(), userId,
          kind: command,
          delta: command === 'reset' ? amount - (previous?.balance ?? 0) : amount,
          balanceAfter: credit.balance,
          meta: { reason, accountPlan: plan, tokensPerCredit },
        },
      })
      await tx.workspaceCredit.upsert({
        where: { workspaceId: userId },
        create: {
          workspaceId: userId,
          balance: credit.balance,
          lifetimeGranted: credit.lifetimeGranted,
          lifetimeUsed: credit.lifetimeUsed,
          windowStartedAt: credit.windowStartedAt,
        },
        update: {
          balance: credit.balance,
          lifetimeGranted: credit.lifetimeGranted,
          lifetimeUsed: credit.lifetimeUsed,
          windowStartedAt: credit.windowStartedAt,
        },
      })
      return credit
    })
    console.log(`${command} completed for user ${userId} (requested by ${accountOrProjectId}): ${amount} credits; balance ${current.balance}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

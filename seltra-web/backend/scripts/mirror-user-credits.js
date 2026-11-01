const { PrismaClient } = require('@prisma/client')
require('dotenv').config()

async function main() {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
  if (!/ep-winter-salad-aqc12bzz/i.test(databaseUrl)) {
    throw new Error('Refusing to backfill outside the approved Neon staging branch ep-winter-salad-aqc12bzz.')
  }

  const prisma = new PrismaClient()
  try {
    const result = await prisma.$transaction(async (tx) => {
      const accounts = await tx.userCredit.findMany({
        select: { userId: true, balance: true, lifetimeGranted: true, lifetimeUsed: true, windowStartedAt: true },
      })
      for (const account of accounts) {
        await tx.workspaceCredit.upsert({
          where: { workspaceId: account.userId },
          create: {
            workspaceId: account.userId,
            balance: account.balance,
            lifetimeGranted: account.lifetimeGranted,
            lifetimeUsed: account.lifetimeUsed,
            windowStartedAt: account.windowStartedAt,
          },
          update: {
            balance: account.balance,
            lifetimeGranted: account.lifetimeGranted,
            lifetimeUsed: account.lifetimeUsed,
            windowStartedAt: account.windowStartedAt,
          },
        })
      }
      const linkedProjects = await tx.$executeRaw`
        UPDATE "Tenant" AS tenant
        SET "creditWorkspaceId" = tenant."ownerId"
        WHERE tenant."ownerId" IS NOT NULL
          AND tenant."creditWorkspaceId" IS DISTINCT FROM tenant."ownerId"
          AND EXISTS (
            SELECT 1 FROM "workspace_credits" AS credits
            WHERE credits."workspaceId" = tenant."ownerId"
          )
      `
      return { accounts: accounts.length, linkedProjects }
    })
    console.log(`Mirrored ${result.accounts} user credit accounts and linked ${result.linkedProjects} owned projects.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

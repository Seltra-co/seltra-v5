import type { Prisma, UserCredit } from '@prisma/client'

/** Keep the per-user workspace row as a mirror; user_credits remains authoritative. */
export async function mirrorWorkspaceCredit(tx: Prisma.TransactionClient, account: Pick<UserCredit, 'userId' | 'balance' | 'lifetimeGranted' | 'lifetimeUsed' | 'windowStartedAt'>) {
  const data = {
    balance: account.balance,
    lifetimeGranted: account.lifetimeGranted,
    lifetimeUsed: account.lifetimeUsed,
    windowStartedAt: account.windowStartedAt,
  }
  await tx.workspaceCredit.upsert({
    where: { workspaceId: account.userId },
    create: { workspaceId: account.userId, ...data },
    update: data,
  })
}

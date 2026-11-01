// packages/db/src/index.ts
import { PrismaClient } from '@prisma/client'
import { withDatabaseTimeouts } from './connection-url'
import { retryDatabaseQuery } from './retry-query'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const safeReadActions = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

const configuredDatabaseUrl = process.env.DATABASE_URL
const client = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error'],
  ...(configuredDatabaseUrl
    ? { datasources: { db: { url: withDatabaseTimeouts(configuredDatabaseUrl) } } }
    : {}),
})

if (!globalForPrisma.prisma) {
  client.$use((params, next) => {
    // P1017 means the server closed this connection. It is safe to retry
    // reads after the pool replaces a stale connection; don't replay writes,
    // whose commit outcome could be ambiguous after a network reset.
    const retryableCodes = safeReadActions.has(params.action) ? ['P1001', 'P1017'] : ['P1001']
    return retryDatabaseQuery(() => next(params), retryableCodes)
  })
}

export const prisma = client

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export * from '@prisma/client'

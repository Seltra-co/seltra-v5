// packages/db/src/index.ts
import { PrismaClient } from '@prisma/client'
import { withDatabaseTimeouts } from './connection-url'
import { retryDatabaseQuery } from './retry-query'
import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestDatabaseMetrics = { queryCount: number; sequentialRounds: number; totalDbMs: number; active: number; cache: Map<string, unknown> }
export const requestDatabaseMetrics = new AsyncLocalStorage<RequestDatabaseMetrics>()

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
    const metrics = requestDatabaseMetrics.getStore()
    let cacheKey: string | undefined
    if (metrics && safeReadActions.has(params.action) && !params.runInTransaction) {
      try { cacheKey = JSON.stringify([params.model, params.action, params.args]) } catch { cacheKey = undefined }
      if (cacheKey && metrics.cache.has(cacheKey)) return Promise.resolve(metrics.cache.get(cacheKey))
    } else if (metrics && !safeReadActions.has(params.action)) {
      metrics.cache.clear()
    }
    return retryDatabaseQuery(async () => {
      const startedAt = performance.now()
      if (metrics) {
        metrics.queryCount++
        if (metrics.active === 0) metrics.sequentialRounds++
        metrics.active++
      }
      try {
        const result = await next(params)
        if (metrics && cacheKey) metrics.cache.set(cacheKey, result)
        return result
      } finally {
        if (metrics) {
          metrics.active--
          metrics.totalDbMs += performance.now() - startedAt
        }
      }
    }, retryableCodes)
  })
}

export const prisma = client

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export * from '@prisma/client'

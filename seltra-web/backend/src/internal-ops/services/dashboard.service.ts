//services/dashboard.service.ts
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { prisma } from '../../db'
import { money, PAID_STATUSES } from '../constants'
import { TopMerchantsQueryDto } from '../dto/merchants-query.dto'

type CachedStatus = { expiresAt: number; value: Record<string, unknown> }
/*
Commerce — GMV, orders, AOV, refunds.
Merchants — Applications, approvals, live stores, footprint.
AI — Invocations, success rate, blueprint generations, agent failures.
Platform — API, database, storefront, latency.
Payments — Revenue, settlements, fees, webhook health.
*/
@Injectable()
export class DashboardService {
  private statusCache?: CachedStatus

  //Get an overview of key metrics for the dashboard
  async overview() {
    const now = Date.now()
    const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000)
    const since24h = new Date(now - 24 * 60 * 60 * 1000)
    const [totalMerchantsStores, activeMerchants, gmv, paidOrders30d, waitlistApplicants, approvedToOnboard, onboarded, aiInvocations24h] =
      await Promise.all([
        prisma.tenant.count(),
        prisma.tenant.count({ where: { status: 'active' } }),
        prisma.order.aggregate({
          where: { status: { in: [...PAID_STATUSES] }, createdAt: { gte: since30d } },
          _sum: { totalAmount: true },
        }),
        prisma.order.count({ where: { status: { in: [...PAID_STATUSES] }, createdAt: { gte: since30d } } }),
        prisma.merchantApplication.count({ where: { status: 'pending' } }),
        prisma.merchantApplication.count({ where: { status: 'approved', merchantId: null } }),
        prisma.merchantApplication.count({ where: { status: 'approved', merchantId: { not: null } } }),
        prisma.tenantEvent.count({ where: { type: 'ai_invocation', createdAt: { gte: since24h } } }),
      ])
    return {
      totalMerchantsStores,
      activeMerchantsStores: activeMerchants,
      gmv30d: money(gmv._sum.totalAmount),
      paidOrders30d,
      waitlistApplicants,
      approvedToOnboard,
      merchantSuccess: onboarded,
      aiInvocations24h,
    }
  }

//Get a time series of GMV and order counts for the past N days
async footprint() {
  const merchants = await prisma.merchantApplication.findMany({
    select: {
      basedIn: true,
      status: true,
    },
  })

  // console.log('Footprint merchants count:', merchants.length, merchants)

  const countries = new Map<
    string,
    {
      country: string
      count: number
      cities: Map<string, number>
    }
  >()

  let unlocated = 0

  for (const merchant of merchants) {
    const location = this.normalizeLocation(merchant.basedIn)

    if (!location) {
      unlocated++
      continue
    }

    const current =
      countries.get(location.country) ??
      {
        country: location.country,
        count: 0,
        cities: new Map<string, number>(),
      }

    current.count++

    if (location.city) {
      current.cities.set(
        location.city,
        (current.cities.get(location.city) ?? 0) + 1,
      )
    }

    countries.set(location.country, current)
  }

  const data = [...countries.values()]
    .sort((a, b) => b.count - a.count)
    .map((country) => ({
      country: country.country,
      count: country.count,
      cities: [...country.cities.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([city, count]) => ({
          city,
          count,
        })),
    }))

  return {
    totalMerchants: merchants.length,
    activeMerchants: merchants.filter(
      (m) => m.status === 'approved',
    ).length,
    countries: data,
    topMarket: data[0]?.country ?? null,
  }
}

//Get a time series of GMV and order counts for the past N days
 async gmvSeries(days: number) {
  const start = this.startDate(days)

  const buckets = new Map<
    string,
    {
      gmv: Prisma.Decimal
      orders: number
    }
  >()

  //Initialize every day
  for (let i = 0; i < days; i++) {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + i)

    buckets.set(this.dateKey(day), {
      gmv: new Prisma.Decimal(0),
      orders: 0,
    })
  }

  const orders = await prisma.order.findMany({
    where: {
      status: {
        in: [...PAID_STATUSES],
      },
      createdAt: {
        gte: start,
      },
    },
    select: {
      createdAt: true,
      totalAmount: true,
    },
  })

  for (const order of orders) {
    const key = this.dateKey(order.createdAt)

    const bucket = buckets.get(key)

    if (!bucket) continue

    bucket.gmv = bucket.gmv.add(order.totalAmount)
    bucket.orders += 1
  }

  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    gmv: money(bucket.gmv),
    orders: bucket.orders,
  }))
}

//Get a time series of tenant events for the past N days
  async activitySeries(days: number) {
    const { start, buckets } = this.countBuckets(days)
    const events = await prisma.tenantEvent.groupBy({
      by: ['createdAt'],
      where: { createdAt: { gte: start } },
      _count: { _all: true },
    })
    for (const event of events) {
      const key = this.dateKey(event.createdAt)
      buckets.set(key, (buckets.get(key) ?? 0) + event._count._all)
    }
    return [...buckets.entries()].map(([date, count]) => ({ date, count }))
  }


//Get a time series of merchant applications for the past N days
async topMerchants(query: TopMerchantsQueryDto) {
  const since = query.days ? this.startDate(query.days) : undefined

const getGroups = (since?: Date) =>
  prisma.order.groupBy({
    by: ['tenantId'],
    where: {
      status: { in: [...PAID_STATUSES] },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    _sum: {
      totalAmount: true,
    },
    orderBy: {
      _sum: {
        totalAmount: 'desc',
      },
    },
    take: query.limit,
  })

let groups = await getGroups(since)

let fallback = false

if (groups.length === 0 && since) {
  fallback = true
  groups = await getGroups()
}

  if (groups.length === 0) {
    return {
      period: fallback ? 'all-time' : `${query.days ?? 'all'}days`,
      fallback,
      data: [],
    }
  }

  const tenants = await prisma.tenant.findMany({
    where: {
      id: {
        in: groups.map((g) => g.tenantId),
      },
    },
  })

  const tenantMap = new Map(
    tenants.map((t) => [t.id, t]),
  )

  return {
    period: fallback ? 'all-time' : `${query.days ?? 'all'}days`,
    fallback,
    data: groups.map((group, index) => {
      const tenant = tenantMap.get(group.tenantId)

      return {
        rank: index + 1,
        tenantId: group.tenantId,
        name: tenant?.name ?? 'Unknown merchant',
        slug: tenant?.slug ?? null,
        gmv: money(group._sum.totalAmount),
      }
    }),
  }
}

//Get a time series of tenant events for the past N days
  async recentEvents(limit: number) {
    const events = await prisma.tenantEvent.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { tenant: { select: { slug: true } } },
    })
    if (events.length === 0) {
      return { message: 'No recent events found' };
    }
    //determine how long ago each event was created and return a human-readable string
    return events.map((event) => ({
      id: event.id,
      type: event.type,
      tenantSlug: event.tenant.slug,
      howLongAgo: (() => {
        const now = Date.now()
        const diff = now - event.createdAt.getTime()
        if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
        if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`
        if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h ago`
        return `${Math.floor(diff / (24 * 60 * 60_000))}d ago`
      })(),
      meta: event.meta,
      createdAt: event.createdAt.toISOString(),
    }))
  }

  //Get a time series of tenant events for the past N days
  async systemStatus() {
    if (this.statusCache && this.statusCache.expiresAt > Date.now()) return this.statusCache.value
    const [db, agentEvent, paymentEvent, storefront] = await Promise.all([
      this.checkDb(),
      prisma.tenantEvent.findFirst({ where: { type: 'ai_invocation' }, orderBy: { createdAt: 'desc' } }),
      prisma.tenantEvent.findFirst({ where: { type: 'payment_received' }, orderBy: { createdAt: 'desc' } }),
      this.checkStorefront(),
    ])
    const now = Date.now()
    const value = {
      api: { status: 'healthy' },
      agent: agentEvent && agentEvent.createdAt.getTime() >= now - 15 * 60_000
        ? { status: 'healthy', lastCheckedAt: agentEvent.createdAt.toISOString() }
        : { status: 'degraded', reason: 'no ai_invocation event in 15m' },
      storefront,
      payments: paymentEvent && paymentEvent.createdAt.getTime() >= now - 24 * 60 * 60_000
        ? { status: 'healthy', lastCheckedAt: paymentEvent.createdAt.toISOString() }
        : { status: 'degraded', reason: 'no payment_received event in 24h' },
      db,
    }
    this.statusCache = { expiresAt: Date.now() + 30_000, value }
    return value
  }

//Get a time series of merchant applications for the past N days
  async recentMerchantApplications(limit: number) {
    const applications = await prisma.merchantApplication.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    })
    if (applications.length === 0) {
      return { message: 'No recent merchant applications found' }
    }

    return applications.map((application) => ({
      id: application.id,
      fullName: application.fullName,
      businessName: application.businessName,
      storeName: application.storeName,
      status: application.status,
    }))
  } 



//Helper functions for system status checks
  private async checkDb() {
    const started = Date.now()
    try {
      await this.timeout(prisma.$queryRaw`SELECT 1`, 3000)
      return { status: 'healthy', latencyMs: Date.now() - started }
    } catch {
      return { status: 'degraded', reason: 'db check timed out or failed', latencyMs: Date.now() - started }
    }
  }

  private async checkStorefront() {
    const base = process.env.FRONTEND_URL || process.env.STOREFRONT_URL
    if (!base) return { status: 'degraded', reason: 'frontend health URL not configured' }
    const started = Date.now()
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${base.replace(/\/$/, '')}/api/health`, { signal: controller.signal })
      clearTimeout(timer)
      return { status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - started }
    } catch {
      return { status: 'degraded', reason: 'storefront health check timed out', latencyMs: Date.now() - started }
    }
  }

  private dayBuckets(days: number) {
    const buckets = new Map<string, Prisma.Decimal>()
    const start = this.startDate(days)
    for (let i = 0; i < days; i += 1) {
      const day = new Date(start)
      day.setUTCDate(start.getUTCDate() + i)
      buckets.set(this.dateKey(day), new Prisma.Decimal(0))
    }
    return { start, buckets }
  }

  private countBuckets(days: number) {
    const buckets = new Map<string, number>()
    const start = this.startDate(days)
    for (let i = 0; i < days; i += 1) {
      const day = new Date(start)
      day.setUTCDate(start.getUTCDate() + i)
      buckets.set(this.dateKey(day), 0)
    }
    return { start, buckets }
  }

  private startDate(days: number) {
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() - days + 1)
    return start
  }

  private dateKey(date: Date) {
    return date.toISOString().slice(0, 10)
  }

  private timeout<T>(promise: Promise<T>, ms: number) {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ])
  }



  private normalizeLocation(value?: string | null) {
  if (!value) return null

  const raw = value.trim()

  if (!raw) return null

  const lower = raw.toLowerCase()

  const countryAliases: Record<string, string> = {
    ghana: 'Ghana',
    nigeria: 'Nigeria',
    kenya: 'Kenya',
    'south africa': 'South Africa',
    'sa': 'South Africa',
    estonia: 'Estonia',
  }

  let country: string | undefined

  for (const alias of Object.keys(countryAliases)) {
    if (lower.includes(alias)) {
      country = countryAliases[alias]
      break
    }
  }

  const city = this.extractCity(raw, country)

  return {
    country: country ?? city ?? 'Unknown',
    city,
  }
}

private extractCity(raw: string, country?: string) {
  let city = raw

  if (country) {
    city = city.replace(new RegExp(country, 'ig'), '')
  }

  city = city
    .replace(/,/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!city) return undefined

  const ignored = new Set([
    'ghana',
    'nigeria',
    'kenya',
    'south africa',
    'sa',
    'estonia',
  ])

  if (ignored.has(city.toLowerCase())) return undefined

  return city
}
}

//services/merchants.service.ts
import { Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { prisma } from '../../db'
import { money, PAID_STATUSES } from '../constants'
import { MerchantPatchDto } from '../dto/merchant-patch.dto'
import { MerchantsQueryDto } from '../dto/merchants-query.dto'
import e from 'express'

type TenantWithOwner = Prisma.TenantGetPayload<{
  include: { owner: true; ledger: true; paymentProviders: true }
}>

@Injectable()
export class MerchantsService {

  //List merchants with optional filtering, sorting, and pagination
  async list(query: MerchantsQueryDto) {
    const rows = await this.filteredRows(query)
    const sorted = this.sortRows(rows, query)
    const total = sorted.length
    const page = query.page
    const pageSize = query.pageSize
    return {
      data: sorted.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }
  }

//Get merchant details by tenant ID
  async detail(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        owner: {
          include: {
            application: true,
          },
        },
        ledger: true,
        paymentProviders: true,
      },
    })
    if (!tenant) throw new NotFoundException('Tenant not found')
    //If the merchant store is removed as "removed" status, then the internal ops API should not return the store details to the ops dashboard
    if (tenant.status === 'removed') throw new NotFoundException('Tenant not found')
    
    const [row] = await this.rowsForTenants([tenant])
    const essentialRows = [row].map((row) => ({
      tenantId: row.tenantId,
      storeName: row.storeName,
      ownerName: row.ownerName,
      ownerEmail: row.ownerEmail,
      businessType: row.businessType,
      basedIn:  tenant.owner?.application?.basedIn ?? null,
    }))

    return {
      data: essentialRows[0],
    }
  }

//Update merchant details by tenant ID
async update(tenantId: string, body: MerchantPatchDto) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      owner: {
        include: {
          application: true,
        },
      },
    },
  })

  if (!tenant) {
    throw new NotFoundException('Tenant not found')
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.businessType !== undefined && {
        businessType: body.businessType,
      }),
      ...(body.status !== undefined && { status: body.status }),
    },
  })

  if (
    body.basedIn !== undefined &&
    tenant.owner?.application
  ) {
    await prisma.merchantApplication.update({
      where: { id: tenant.owner.application.id },
      data: {
        basedIn: body.basedIn,
      },
    })
  }

  return this.detail(tenantId)
}

//Remove a merchant by tenant ID (soft delete)
  async remove(tenantId: string) {
    const existing = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!existing) throw new NotFoundException('Tenant not found')
    const tenant = await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'removed' } })
    return { tenantId: tenant.id, status: tenant.status }
  }

//Export merchants as CSV with optional filtering and sorting
  async exportCsv(query: MerchantsQueryDto) {
    const rows = this.sortRows(await this.filteredRows(query), query)
    if (rows.length > 5000) throw new PayloadTooLargeException('Export is capped at 5,000 rows. Narrow your filters.')
    const header = 'store,slug,owner_name,owner_email,type,status,gmv,orders,last_active,joined'
    const lines = rows.map((row) => [
      row.storeName,
      row.slug,
      row.ownerName,
      row.ownerEmail,
      row.businessType,
      // row.location,
      row.status,
      row.gmv.amount,
      row.orderCount,
      row.lastActive,
      row.joinedAt,
    ].map(this.csv).join(','))
    return [header, ...lines].join('\n')
  }

   //Dashboard fetch merchants for bulk messaging (email, sms) endpoint for the internal ops API
   //return merchants full name, store name, email, phone number for messaging purposes
  //@req GET /internal/ops/merchants/messaging
  //x-internal-api-key
  //x-ops-actor
  async messaging() {
     const merchants = await prisma.merchantApplication.findMany({
      where: { status: { in: ['approved', 'pending'] } },
    })

    if (!merchants || merchants.length === 0) { 
      return {  
        success: false,
        message: 'No merchants found for messaging.',
        data: [],
      }
    }
    
    const filteredMerchants = merchants.map((merchant) => ({
      id: merchant.id,
      fullName: merchant.fullName,
      storeName: merchant.storeName,
      email: merchant.email,
      phoneNumber: merchant.phone,
    }))

    return {
      success: true,
      message: 'Fetched merchants for messaging successfully.',
      data: filteredMerchants,
    }

  }


 //Dashboard fetch a merchant for single messaging (email, sms) endpoint for the internal ops API
//@req GET /internal/ops/merchants/:tenantId/messaging
//x-internal-api-key
//x-ops-actor
async singleMessaging(merchantId: string) {
  const merchant = await prisma.merchantApplication.findUnique({
    where: { id: merchantId },
  })

  if (!merchant) {
    return {
      success: false,
      message: 'No merchant found for messaging.',
      data: null,
    }
  }

  const filteredMerchant = {
    id: merchant.id,
    fullName: merchant.fullName,
    storeName: merchant.storeName,
    email: merchant.email,
    phoneNumber: merchant.phone,
  }

  return {
    success: true,
    message: 'Fetched merchant for messaging successfully.',
    data: filteredMerchant,
  }
}



 //METHODS 
  private async filteredRows(query: MerchantsQueryDto) {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.businessType ? { businessType: { equals: query.businessType, mode: 'insensitive' } } : {}),
      ...(query.country ? { country: { equals: query.country, mode: 'insensitive' } } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { slug: { contains: query.search, mode: 'insensitive' } },
          { owner: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      } : {}),
    }
    //Prevent fetching removed stores with status 'removed'  to ops 
    if (!query.status) {
      where.status = { not: 'removed' }
    }
    const tenants = await prisma.tenant.findMany({
      where,
      include: { owner: true, ledger: true, paymentProviders: true },
      orderBy: { createdAt: 'desc' },
    })
    return this.rowsForTenants(tenants)
  }

  private async rowsForTenants(tenants: TenantWithOwner[]) {
    const tenantIds = tenants.map((tenant) => tenant.id)
    const [orderGroups, lastEvents] = await Promise.all([
      tenantIds.length ? prisma.order.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, status: { in: [...PAID_STATUSES] } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }) : [],
      tenantIds.length ? prisma.tenantEvent.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds } },
        _max: { createdAt: true },
      }) : [],
    ])
    const orderMap = new Map(orderGroups.map((group) => [group.tenantId, group]))
    const eventMap = new Map(lastEvents.map((group) => [group.tenantId, group._max.createdAt]))

    //lastActive should show time/days ago as a human-readable string, 
    const toLastActive = (tenantId: string) => {
      const lastEvent = eventMap.get(tenantId)
      if (!lastEvent) return null
      const diffMs = Date.now() - lastEvent.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      if (diffDays === 0) return 'today'
      if (diffDays === 1) return 'yesterday'
      return `${diffDays} days ago`
    }

    return tenants.map((tenant) => {
      const orders = orderMap.get(tenant.id)
      return {
        tenantId: tenant.id,
        storeName: tenant.name,
        slug: tenant.slug,
        ownerName: tenant.owner?.name ?? null,
        ownerEmail: tenant.owner?.email ?? null,
        businessType: tenant.businessType,
        // location: [tenant.city, tenant.country].filter(Boolean).join(', ') || null,
        status: tenant.status,
        gmv: money(orders?._sum.totalAmount),
        orderCount: orders?._count._all ?? 0,
        lastActive: toLastActive(tenant.id),
        
        joinedAt: tenant.createdAt.toISOString(),
      }
    })
  }

  private sortRows(rows: Awaited<ReturnType<MerchantsService['rowsForTenants']>>, query: MerchantsQueryDto) {
    const dir = query.sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const value = (row: typeof a) => {
        if (query.sortBy === 'gmv') return Number(row.gmv.amount)
        if (query.sortBy === 'orders') return row.orderCount
        if (query.sortBy === 'lastActive') return row.lastActive ? Date.parse(row.lastActive) : 0
        return Date.parse(row.joinedAt)
      }
      return (value(a) - value(b)) * dir
    })
  }

  private csv(value: unknown) {
    const text = value == null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
}

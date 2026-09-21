import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../db'

type NotificationMeta = Record<string, unknown>

@Injectable()
export class NotificationsService {
  constructor(private readonly jwtService: JwtService) {}

  async list(authorization?: string, tenantId?: string) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const events = await prisma.tenantEvent.findMany({
      where: { tenantId: resolvedTenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return events.map((event) => {
      const meta = (event.meta ?? {}) as NotificationMeta
      const rawAmount = typeof meta.amount === 'string' || typeof meta.amount === 'number' ? meta.amount : undefined
      const amount = rawAmount !== undefined ? Number(rawAmount).toFixed(2) : undefined
      const currency = typeof meta.currency === 'string' ? meta.currency : 'GHS'
      const customer = typeof meta.customerName === 'string'
        ? meta.customerName
        : typeof meta.customerEmail === 'string'
          ? meta.customerEmail
          : 'Customer'

      if (event.type === 'order_placed') {
        return {
          id: event.id,
          type: 'order',
          title: 'New order',
          body: `${customer} placed an order${amount ? ` for ${currency} ${amount}` : ''}.`,
          createdAt: event.createdAt,
          meta,
        }
      }

      if (event.type === 'payment_received') {
        return {
          id: event.id,
          type: 'payment',
          title: 'New order',
          body: `${customer} placed an order${amount ? ` for ${currency} ${amount}` : ''}.`,
          createdAt: event.createdAt,
          meta,
        }
      }

      if (event.type === 'login') {
        return {
          id: event.id,
          type: 'security',
          title: 'Merchant login',
          body: `A dashboard login was recorded${typeof meta.email === 'string' ? ` for ${meta.email}` : ''}.`,
          createdAt: event.createdAt,
          meta,
        }
      }

      if (event.type === 'order_status_updated') {
        return {
          id: event.id,
          type: 'order',
          title: 'Order status updated',
          body: `Order ${typeof meta.orderId === 'string' ? meta.orderId.slice(0, 8) : ''} moved to ${meta.status ?? 'a new status'}.`,
          createdAt: event.createdAt,
          meta,
        }
      }

      return {
        id: event.id,
        type: 'announcement',
        title: event.type.replace(/_/g, ' '),
        body: 'Seltra updated your workspace.',
        createdAt: event.createdAt,
        meta,
      }
    })
  }

  private async resolveTenantId(authorization?: string, requestedTenantId?: string) {
    const userId = await this.userIdFromAuth(authorization)
    if (requestedTenantId) {
      const tenant = await prisma.tenant.findFirst({ where: { id: requestedTenantId, ownerId: userId }, select: { id: true } })
      if (!tenant) throw new NotFoundException('Store not found')
      return tenant.id
    }

    const tenant = await prisma.tenant.findFirst({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })
    if (!tenant) throw new NotFoundException('No store found for this merchant')
    return tenant.id
  }

  private async userIdFromAuth(authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing bearer token')
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_SECRET || 'change-me',
      })
      return payload.sub
    } catch {
      throw new UnauthorizedException('Invalid bearer token')
    }
  }
}

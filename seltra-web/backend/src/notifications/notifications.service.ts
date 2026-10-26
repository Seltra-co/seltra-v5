import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../db'

type NotificationMeta = Record<string, unknown>

@Injectable()
export class NotificationsService {
  constructor(private readonly jwtService: JwtService) {}

  async list(authorization?: string, tenantId?: string) {
    const userId = await this.userIdFromAuth(authorization)
    if (tenantId) {
      const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, ownerId: userId }, select: { id: true } })
      if (!tenant) throw new NotFoundException('Store not found')
    }
    const notifications = await prisma.userNotification.findMany({
      where: { userId, ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return notifications.map((notification) => {
      const meta = (notification.meta ?? {}) as NotificationMeta
      const rawAmount = typeof meta.amount === 'string' || typeof meta.amount === 'number' ? meta.amount : undefined
      const amount = rawAmount !== undefined ? Number(rawAmount).toFixed(2) : undefined
      const currency = typeof meta.currency === 'string' ? meta.currency : 'GHS'
      const customer = typeof meta.customerName === 'string'
        ? meta.customerName
        : typeof meta.customerEmail === 'string'
          ? meta.customerEmail
          : 'Customer'

      if (notification.type === 'order_placed') {
        return {
          id: notification.id,
          type: 'order',
          title: 'New order',
          body: `${customer} placed an order${amount ? ` for ${currency} ${amount}` : ''}.`,
          createdAt: notification.createdAt,
          readAt: notification.readAt,
          tenantId: notification.tenantId,
          meta,
        }
      }

      if (notification.type === 'payment_received') {
        return {
          id: notification.id,
          type: 'payment',
          title: 'Payment received',
          body: `${customer} completed a payment${amount ? ` of ${currency} ${amount}` : ''}.`,
          createdAt: notification.createdAt,
          readAt: notification.readAt,
          tenantId: notification.tenantId,
          meta,
        }
      }

      if (notification.type === 'login') {
        return {
          id: notification.id,
          type: 'security',
          title: 'Merchant login',
          body: `A dashboard login was recorded${typeof meta.email === 'string' ? ` for ${meta.email}` : ''}.`,
          createdAt: notification.createdAt,
          readAt: notification.readAt,
          tenantId: notification.tenantId,
          meta,
        }
      }

      if (notification.type === 'order_status_updated') {
        return {
          id: notification.id,
          type: 'order',
          title: 'Order status updated',
          body: `Order ${typeof meta.orderId === 'string' ? meta.orderId.slice(0, 8) : ''} moved to ${meta.status ?? 'a new status'}.`,
          createdAt: notification.createdAt,
          readAt: notification.readAt,
          tenantId: notification.tenantId,
          meta,
        }
      }

      return {
        id: notification.id,
        type: 'announcement',
        title: notification.type.replace(/_/g, ' '),
        body: 'Seltra updated your workspace.',
        createdAt: notification.createdAt,
        readAt: notification.readAt,
        tenantId: notification.tenantId,
        meta,
      }
    })
  }

  async markAllRead(authorization?: string, tenantId?: string) {
    const userId = await this.userIdFromAuth(authorization)
    if (tenantId) {
      const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, ownerId: userId }, select: { id: true } })
      if (!tenant) throw new NotFoundException('Store not found')
    }
    await prisma.userNotification.updateMany({
      where: { userId, ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}) , readAt: null },
      data: { readAt: new Date() },
    })
    return { success: true }
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

//marketing/marketing.service.ts
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { MoolreService } from '../payment/moolre.service'
import { ResendService } from '../resend/resend.service'
import { AgentEventsService } from '../agent/agent-events.service'

type Channel = 'email' | 'sms'
type Audience = 'single' | 'bulk'

@Injectable()
export class MarketingService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly moolre: MoolreService,
    private readonly resend: ResendService,
    private readonly agentEvents: AgentEventsService,
  ) {}

  async history(authorization?: string, tenantId?: string, pageInput = 1, perPageInput = 10) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const page = Math.max(1, pageInput)
    const perPage = Math.min(50, Math.max(1, perPageInput))
    const [rows, total] = await Promise.all([
      prisma.marketingMessage.findMany({
        where: { tenantId: resolvedTenantId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.marketingMessage.count({ where: { tenantId: resolvedTenantId } }),
    ])
    return { data: rows, total, page, perPage }
  }

  async templates(authorization?: string, tenantId?: string, pageInput = 1, perPageInput = 9) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const page = Math.max(1, pageInput)
    const perPage = Math.min(50, Math.max(1, perPageInput))
    const where = { tenantId: resolvedTenantId }
    const [rows, total] = await Promise.all([
      prisma.marketingTemplate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.marketingTemplate.count({ where }),
    ])
    return { data: rows, total, page, perPage }
  }

  async send(authorization: string | undefined, body: {
    tenantId?: string
    channel?: Channel
    audience?: Audience
    customerId?: string
    subject?: string
    message?: string
    marketingOnly?: boolean
    saveAsTemplate?: boolean
    templateName?: string
  }) {
    const tenantId = await this.resolveTenantId(authorization, body.tenantId)
    const channel = body.channel === 'sms' ? 'sms' : 'email'
    const audience = body.audience === 'bulk' ? 'bulk' : 'single'
    const message = body.message?.trim()
    if (!message) throw new BadRequestException('Message is required')
    if (channel === 'email' && !body.subject?.trim()) throw new BadRequestException('Email subject is required')

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
    const where: Prisma.CustomerWhereInput = audience === 'bulk'
      ? { tenantId, ...(body.marketingOnly === false ? {} : { marketingOptIn: true }) }
      : { tenantId, id: body.customerId || '' }
    const customers = await prisma.customer.findMany({ where, orderBy: { updatedAt: 'desc' }, take: audience === 'bulk' ? 500 : 1 })
    if (customers.length === 0) throw new BadRequestException(audience === 'bulk' ? 'No matching customers found' : 'Select a customer')

    const recipients = customers.filter((customer) => channel === 'email' ? customer.email : customer.phone)
    if (recipients.length === 0) throw new BadRequestException(`No customers have ${channel === 'email' ? 'email addresses' : 'phone numbers'}`)

    const results = await Promise.allSettled(recipients.map((customer) => channel === 'email'
      ? this.resend.sendMerchantMessage({
          to: customer.email,
          subject: body.subject || `Update from ${tenant?.name || 'Seltra merchant'}`,
          message,
          storeName: tenant?.name,
        })
      : this.moolre.sendSms({
          to: customer.phone,
          message: `${message}\n\nSent via Seltra`,
        })
    ))
    const sent = results.filter((item) => item.status === 'fulfilled').length
    const failed = results.length - sent
    const singleCustomer = audience === 'single' ? recipients[0] : undefined
    const status = failed === recipients.length ? 'failed' : failed ? 'partial' : 'sent'

    const saved = await prisma.marketingMessage.create({
      data: {
        tenantId,
        channel,
        audience,
        subject: body.subject,
        message,
        customerId: singleCustomer?.id,
        customerName: singleCustomer?.name || singleCustomer?.email,
        recipientCount: recipients.length,
        sent,
        failed,
        status,
      },
    })

    if (body.saveAsTemplate) {
      await this.createTemplate(authorization, {
        tenantId,
        channel,
        name: body.templateName || body.subject || `${channel.toUpperCase()} template`,
        subject: body.subject,
        message,
      })
    }

    await this.agentEvents.emit({
      tenantId,
      agent: 'MarketingAgent',
      type: 'message.sent',
      action: channel === 'email' ? 'SEND_EMAIL' : 'SEND_SMS',
      status,
      payload: {
        channel,
        audience,
        subject: body.subject,
        message,
        customerId: audience === 'single' ? body.customerId : undefined,
        recipientCount: recipients.length,
        sent,
        failed,
      } as Prisma.InputJsonValue,
    })

    return { success: true, channel, audience, recipientCount: recipients.length, sent, failed, message: saved }
  }

  async createTemplate(authorization: string | undefined, body: {
    tenantId?: string
    channel?: Channel
    name?: string
    subject?: string
    message?: string
  }) {
    const tenantId = await this.resolveTenantId(authorization, body.tenantId)
    const channel = body.channel === 'sms' ? 'sms' : 'email'
    const message = body.message?.trim()
    if (!message) throw new BadRequestException('Template message is required')
    return prisma.marketingTemplate.create({
      data: {
        tenantId,
        channel,
        name: body.name?.trim() || body.subject?.trim() || `${channel.toUpperCase()} template`,
        subject: body.subject?.trim() || null,
        message,
      },
    })
  }

  private async resolveTenantId(authorization?: string, requestedTenantId?: string) {
    const userId = await this.userIdFromAuth(authorization)
    if (requestedTenantId) {
      const tenant = await prisma.tenant.findFirst({ where: { id: requestedTenantId, ownerId: userId }, select: { id: true } })
      if (!tenant) throw new NotFoundException('Store not found')
      return tenant.id
    }
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: userId }, orderBy: { updatedAt: 'desc' }, select: { id: true } })
    if (!tenant) throw new NotFoundException('No store found for this merchant')
    return tenant.id
  }

  private async userIdFromAuth(authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing bearer token')
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, { secret: process.env.JWT_SECRET || 'change-me' })
      return payload.sub
    } catch {
      throw new UnauthorizedException('Invalid bearer token')
    }
  }
}

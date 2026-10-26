import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomBytes, randomUUID } from 'node:crypto'
import { prisma } from '../db'
import { resolveUserIdFromAuthorization } from '../auth/resolve-user'
import { planLimits } from '../common/plan-limits'

const CREDIT_LIMIT = Number(process.env.SELTRA_AI_CREDIT_LIMIT || 40)
const CREDIT_WINDOW_MS = Number(process.env.SELTRA_AI_CREDIT_WINDOW_HOURS || 5) * 60 * 60 * 1000

@Injectable()
export class BuilderService {
  private readonly redeemedTickets = new Map<string, number>()
  constructor(private readonly jwt: JwtService) {}

  private coreSecret() {
    const secret = process.env.CORE_TOKEN_SECRET
    if (!secret || secret.length < 32) throw new Error('CORE_TOKEN_SECRET must contain at least 32 characters')
    return secret
  }

  async createSession(authorization: string | undefined, tenantId: string) {
    const userId = await resolveUserIdFromAuthorization(authorization, this.jwt)
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, ownerId: userId },
      include: { owner: { select: { plan: true, email: true } } },
    })
    if (!tenant) throw new ForbiddenException('You do not have access to this workspace.')
    if (tenant.status !== 'active') throw new ForbiddenException('This workspace is not active.')

    let coreWorkspaceKey = tenant.coreWorkspaceKey
    if (!coreWorkspaceKey) {
      // Stable short path/hostname key. Retry only on the extremely unlikely
      // unique collision; the tenant UUID remains the signed workspace id.
      for (let attempt = 0; attempt < 4 && !coreWorkspaceKey; attempt += 1) {
        const candidate = randomBytes(9).toString('hex').slice(0, 12)
        const result = await prisma.tenant.updateMany({
          where: { id: tenant.id, coreWorkspaceKey: null },
          data: { coreWorkspaceKey: candidate },
        })
        if (result.count) coreWorkspaceKey = candidate
        else coreWorkspaceKey = (await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { coreWorkspaceKey: true } }))?.coreWorkspaceKey ?? null
      }
      if (!coreWorkspaceKey) throw new Error('Could not allocate a workspace key')
    }

    const now = Date.now()
    const windowExpired = now - tenant.aiCreditsWindowStart.getTime() > CREDIT_WINDOW_MS
    const used = windowExpired ? 0 : tenant.aiCreditsUsed
    if (windowExpired) {
      await prisma.tenant.update({ where: { id: tenant.id }, data: { aiCreditsUsed: 0, aiCreditsWindowStart: new Date(now) } })
    }
    if (used >= CREDIT_LIMIT) throw new ForbiddenException('AI credits are exhausted for this workspace.')
    const plan = tenant.owner?.plan ?? 'free'
    const coreToken = await this.jwt.signAsync(
      { workspaceId: tenant.id, coreWorkspaceKey: coreWorkspaceKey!, storeSlug: tenant.slug, plan, email: tenant.owner?.email ?? '', jti: randomUUID() },
      { secret: this.coreSecret(), algorithm: 'HS256', issuer: 'seltra-api', audience: 'seltra-core', subject: userId!, expiresIn: '10m' },
    )
    return {
      coreToken,
      expiresIn: 600,
      workspaceId: tenant.id,
      coreWorkspaceKey: coreWorkspaceKey!,
      storeSlug: tenant.slug,
      plan,
      limits: { ...planLimits(plan), aiCredits: { used, limit: CREDIT_LIMIT, resetsAt: new Date((windowExpired ? now : tenant.aiCreditsWindowStart.getTime()) + CREDIT_WINDOW_MS).toISOString() } },
    }
  }

  async listApps(authorization: string | undefined, tenantId: string) {
    const userId = await resolveUserIdFromAuthorization(authorization, this.jwt)
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, ownerId: userId }, select: { id: true } })
    if (!tenant) throw new ForbiddenException('You do not have access to this workspace.')
    return prisma.tenantApp.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' } })
  }

  async createWsTicket(authorization: string | undefined, tenantId: string) {
    const session = await this.createSession(authorization, tenantId)
    const ticket = await this.jwt.signAsync(
      { workspaceId: session.workspaceId, jti: randomUUID() },
      { secret: this.coreSecret(), algorithm: 'HS256', issuer: 'seltra-api', audience: 'seltra-core-ws', subject: session.workspaceId, expiresIn: '30s' },
    )
    return { ticket, expiresIn: 30 }
  }

  async redeemWsTicket(ticket: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ workspaceId: string; jti: string }>(ticket, {
        secret: this.coreSecret(), algorithms: ['HS256'], issuer: 'seltra-api', audience: 'seltra-core-ws',
      })
      if (!payload.workspaceId || !payload.jti || this.redeemedTickets.has(payload.jti)) throw new UnauthorizedException('Invalid websocket ticket.')
      const now = Date.now()
      for (const [id, expiry] of this.redeemedTickets) if (expiry <= now) this.redeemedTickets.delete(id)
      this.redeemedTickets.set(payload.jti, (payload as typeof payload & { exp: number }).exp * 1000)
      const entitlement = await this.entitlement(payload.workspaceId)
      if (!entitlement.active) throw new ForbiddenException('Workspace access is inactive.')
      return { workspaceId: payload.workspaceId, userId: entitlement.userId, coreWorkspaceKey: entitlement.coreWorkspaceKey, storeSlug: entitlement.storeSlug, email: entitlement.email, plan: entitlement.plan }
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) throw error
      throw new UnauthorizedException('Invalid websocket ticket.')
    }
  }

  async syncApp(input: { tenantId: string; coreAppId: number; name: string; status: string; previewUrl?: string; publishedUrl?: string; lastCommitSha?: string; version?: number }) {
    return prisma.tenantApp.upsert({
      where: { tenantId_coreAppId: { tenantId: input.tenantId, coreAppId: input.coreAppId } },
      create: input,
      update: { name: input.name, status: input.status, previewUrl: input.previewUrl, publishedUrl: input.publishedUrl, lastCommitSha: input.lastCommitSha, version: input.version },
    })
  }

  async entitlement(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { owner: { select: { plan: true, email: true } } } })
    if (!tenant) return { active: false, reason: 'workspace_not_found' }
    const expired = Date.now() - tenant.aiCreditsWindowStart.getTime() > CREDIT_WINDOW_MS
    const used = expired ? 0 : tenant.aiCreditsUsed
    return { active: tenant.status === 'active' && used < CREDIT_LIMIT, reason: used >= CREDIT_LIMIT ? 'credits_exhausted' : tenant.status !== 'active' ? 'workspace_inactive' : undefined, tenantId, userId: tenant.ownerId, coreWorkspaceKey: tenant.coreWorkspaceKey, storeSlug: tenant.slug, email: tenant.owner?.email ?? '', plan: tenant.owner?.plan ?? 'free', credits: { used, limit: CREDIT_LIMIT, resetsAt: new Date((expired ? Date.now() : tenant.aiCreditsWindowStart.getTime()) + CREDIT_WINDOW_MS).toISOString() } }
  }

  async reportUsage(input: { tenantId: string; userId: string; tokens?: number; ok: boolean }) {
    const tenant = await prisma.tenant.findFirst({ where: { id: input.tenantId, ownerId: input.userId }, select: { id: true } })
    if (!tenant) throw new UnauthorizedException('Workspace ownership could not be verified.')
    // Credits in the existing Seltra AI flow are request based. Record one
    // credit per successful model invocation, not one per generated token.
    if (input.ok) {
      const credits = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { aiCreditsWindowStart: true } })
      if (credits && Date.now() - credits.aiCreditsWindowStart.getTime() > CREDIT_WINDOW_MS) {
        await prisma.tenant.update({ where: { id: input.tenantId }, data: { aiCreditsUsed: 1, aiCreditsWindowStart: new Date() } })
      } else {
        await prisma.tenant.update({ where: { id: input.tenantId }, data: { aiCreditsUsed: { increment: 1 } } })
      }
    }
    return { recorded: true }
  }
}

import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { DeploymentKind, DeploymentStatus, Prisma, PublishDeployMode, PublishPersistenceStatus, PublishPublicationStatus, PublishRepoVisibility, PublishSourceState, PublishWorkspaceStatus, WorkspacePersistenceOperationStatus } from '@prisma/client'
import { prisma } from '../db'
import { LegacyStoreGuard } from './legacy-store.guard'

type BeginInput = {
  userId: string
  workspaceKey: string
  coreAppId: number
  kind?: DeploymentKind
  rollbackSourceId?: string
  idempotencyKey: string
  confirmReplaceLegacy?: boolean
}

const RESERVED_SLUGS = new Set([
  'www', 'web', 'api', 'admin', 'app', 'mail', 'send', 'dashboard', 'login', 'auth',
  'status', 'help', 'support', 'blog', 'cdn', 'assets', 'static',
])
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
const STATUS_RANK: Record<DeploymentStatus, number> = {
  QUEUED: 0,
  PREPARING_WORKSPACE: 1,
  SAVING_SOURCE: 2,
  BUILDING: 3,
  VERIFYING: 4,
  ACTIVATING: 5,
  LIVE: 6,
  FAILED: 6,
  SUPERSEDED: 6,
  DISABLED: 6,
}

function mode(): PublishDeployMode {
  const configured = process.env.DEPLOY_MODE?.trim().toLowerCase()
  return configured === 'hobby' ? PublishDeployMode.hobby : PublishDeployMode.team
}

function httpError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): HttpException {
  return new HttpException({ code, message, ...extra }, status)
}

function parseLimit(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function protectedSlugs(): Set<string> {
  return new Set((process.env.PUBLISH_PROTECTED_SLUGS ?? '').split(',').map((slug) => slug.trim().toLowerCase()).filter(Boolean))
}

function enabled(): boolean {
  return process.env.PUBLISH_ENABLED === 'true'
}

@Injectable()
export class PublishService implements OnModuleInit {
  private readonly logger = new Logger(PublishService.name)

  constructor(private readonly legacyStoreGuard: LegacyStoreGuard) {}

  onModuleInit() {
    const deployMode = mode()
    if (!process.env.DEPLOY_MODE || !['hobby', 'team'].includes(process.env.DEPLOY_MODE.trim().toLowerCase())) {
      this.logger.warn('DEPLOY_MODE missing or invalid; using team mode.')
    }
    if (!protectedSlugs().size) this.logger.warn('PUBLISH_PROTECTED_SLUGS is empty; legacy slugs are not protected by the configured list.')
  }

  private requireEnabled(): void {
    if (!enabled()) throw new NotFoundException()
  }

  private async resolveOwnedApp(userId: string, appId: string | number, workspaceKey?: string) {
    let tenantApp: any
    if (workspaceKey) {
      const tenant = await prisma.tenant.findFirst({ where: { ownerId: userId, coreWorkspaceKey: workspaceKey } })
      if (!tenant) throw new ForbiddenException('You do not own this workspace.')
      tenantApp = await prisma.tenantApp.findFirst({ where: { tenantId: tenant.id, coreAppId: Number(appId) }, include: { tenant: true } })
    } else if (typeof appId === 'string' && /^[0-9a-f-]{36}$/i.test(appId)) {
      tenantApp = await prisma.tenantApp.findFirst({ where: { id: appId, tenant: { ownerId: userId } }, include: { tenant: true } })
    } else {
      const matches = await prisma.tenantApp.findMany({ where: { coreAppId: Number(appId), tenant: { ownerId: userId } }, include: { tenant: true }, take: 2 })
      if (matches.length > 1) throw new NotFoundException('App not found.')
      tenantApp = matches[0]
    }
    if (!tenantApp) throw new NotFoundException('App not found.')
    if (tenantApp.tenant.ownerId !== userId) throw new ForbiddenException('You do not own this app.')
    return tenantApp
  }

  private assertSlugAllowed(slug: string): void {
    if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug) || protectedSlugs().has(slug)) {
      throw httpError(HttpStatus.UNPROCESSABLE_ENTITY, 'SLUG_PROTECTED', 'This store slug cannot be published.')
    }
  }

  async begin(input: BeginInput) {
    this.requireEnabled()
    if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 200) {
      throw httpError(HttpStatus.BAD_REQUEST, 'INVALID_IDEMPOTENCY_KEY', 'A valid idempotencyKey is required.')
    }
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: input.userId, coreWorkspaceKey: input.workspaceKey } })
    if (!tenant) throw new ForbiddenException('You do not own this workspace.')
    const app = await prisma.tenantApp.findUnique({
      where: { tenantId_coreAppId: { tenantId: tenant.id, coreAppId: input.coreAppId } },
      include: { tenant: true },
    })
    if (!app) throw new NotFoundException('App not found.')
    this.assertSlugAllowed(tenant.slug)

    const existing = await prisma.deployment.findUnique({ where: { tenantAppId_idempotencyKey: { tenantAppId: app.id, idempotencyKey: input.idempotencyKey } } })
    if (existing) return this.beginResponse(app, existing, true)

    const kind = input.kind ?? DeploymentKind.PUBLISH
    const deployMode = mode()
    const legacyState = this.legacyStoreGuard.isLive(tenant)
    if (legacyState === 'UNKNOWN' && deployMode === PublishDeployMode.team) {
      throw httpError(HttpStatus.UNPROCESSABLE_ENTITY, 'V4_GUARD_NOT_CONFIGURED', 'The live V4-store guard must be configured before publishing in team mode.')
    }
    if (legacyState === 'UNKNOWN' && deployMode === PublishDeployMode.hobby) {
      this.logger.warn(`V4 live-store state is unknown for tenant ${tenant.id}; hobby publish proceeds under protected-slug checks.`)
    }
    if (legacyState === 'LIVE' && !input.confirmReplaceLegacy) {
      throw httpError(HttpStatus.CONFLICT, 'LEGACY_STORE_LIVE_CONFIRMATION_REQUIRED', 'Publishing will replace this tenant’s live V4 storefront. Confirm to continue.')
    }

    let rollbackTarget: any = undefined
    if (kind === DeploymentKind.ROLLBACK) {
      rollbackTarget = input.rollbackSourceId ? await prisma.deployment.findFirst({
        where: { id: input.rollbackSourceId, tenantAppId: app.id, verifiedAt: { not: null }, vercelOrigin: { not: null }, status: { in: [DeploymentStatus.SUPERSEDED, DeploymentStatus.LIVE] } },
      }) : null
      if (!rollbackTarget) throw httpError(HttpStatus.UNPROCESSABLE_ENTITY, 'ROLLBACK_TARGET_INVALID', 'This deployment is not eligible for rollback.')
    }

    const now = new Date()
    const active = app.activePublishId ? await prisma.deployment.findUnique({ where: { id: app.activePublishId } }) : null
    if (active && !active.finishedAt && (!active.queueLeaseExpiresAt || active.queueLeaseExpiresAt <= now) && now.getTime() - active.createdAt.getTime() > 20 * 60_000) {
      await prisma.$transaction([
        prisma.deployment.update({ where: { id: active.id }, data: { status: DeploymentStatus.FAILED, errorCode: 'TIMEOUT', errorMessage: 'Publish timed out.', finishedAt: now, queueLeaseOwner: null, queueLeaseToken: null, queueLeaseExpiresAt: null } }),
        prisma.tenantApp.updateMany({ where: { id: app.id, activePublishId: active.id }, data: { activePublishId: null } }),
      ])
    } else if (active && !active.finishedAt) {
      throw httpError(HttpStatus.CONFLICT, 'PUBLISH_IN_PROGRESS', 'A publish is already in progress.', { deploymentId: active.id })
    } else if (app.activePublishId) {
      await prisma.tenantApp.updateMany({ where: { id: app.id, activePublishId: app.activePublishId }, data: { activePublishId: null } })
    }

    const [hourlyCount, dailyCount] = await Promise.all([
      prisma.deployment.count({ where: { tenantId: tenant.id, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }),
      prisma.deployment.count({ where: { tenantId: tenant.id, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } } }),
    ])
    if (hourlyCount >= parseLimit('PUBLISH_MAX_PER_HOUR', 10) || dailyCount >= parseLimit('PUBLISH_MAX_PER_DAY', 20)) {
      throw httpError(HttpStatus.TOO_MANY_REQUESTS, 'QUOTA_EXCEEDED', 'The publish quota has been reached.')
    }

    const deploymentId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const row = await prisma.$transaction(async (tx) => {
      const deployment = await tx.deployment.create({
        data: {
          tenantId: tenant.id,
          tenantAppId: app.id,
          slug: tenant.slug,
          kind,
          status: DeploymentStatus.QUEUED,
          idempotencyKey: input.idempotencyKey,
          triggeredByUserId: input.userId,
          ...(rollbackTarget ? {
            rollbackSourceId: rollbackTarget.id,
            sourceCommitSha: rollbackTarget.sourceCommitSha,
            vercelProjectId: app.vercelProjectId,
            vercelDeploymentId: rollbackTarget.vercelDeploymentId,
            vercelOrigin: rollbackTarget.vercelOrigin,
          } : {}),
          ...(app.liveDeploymentId ? { previousDeploymentId: app.liveDeploymentId } : {}),
          deployMode,
          repoVisibility: mode() === PublishDeployMode.hobby ? PublishRepoVisibility.public : PublishRepoVisibility.private,
          lastEventSeq: 1,
          events: { create: { seq: 1, status: DeploymentStatus.QUEUED, message: 'Publish queued.' } },
        },
      })
      const updated = await tx.tenantApp.updateMany({ where: { id: app.id, activePublishId: null }, data: { activePublishId: deployment.id } })
      if (updated.count !== 1) throw httpError(HttpStatus.CONFLICT, 'PUBLISH_IN_PROGRESS', 'A publish is already in progress.')
      return deployment
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      .catch(async (error: any) => {
        if (error?.code === 'P2002' || error?.code === 'P2034') {
          const raced = await prisma.deployment.findUnique({ where: { tenantAppId_idempotencyKey: { tenantAppId: app.id, idempotencyKey: input.idempotencyKey } } })
          if (raced) return raced
          const current = await prisma.tenantApp.findUnique({ where: { id: app.id }, select: { activePublishId: true } })
          if (current?.activePublishId) throw httpError(HttpStatus.CONFLICT, 'PUBLISH_IN_PROGRESS', 'A publish is already in progress.', { deploymentId: current.activePublishId })
        }
        throw error
      })
    return this.beginResponse(app, row, false, rollbackTarget)
  }

  async assertNoActiveRun(input: { userId: string; workspaceKey: string }) {
    this.requireEnabled()
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: input.userId, coreWorkspaceKey: input.workspaceKey }, select: { id: true } })
    if (!tenant) throw new ForbiddenException('You do not own this workspace.')
    const run = await prisma.run.findFirst({ where: { projectId: tenant.id, state: { in: ['queued', 'running', 'waiting_for_user', 'stopping', 'paused_no_credits'] } }, select: { id: true } })
    if (run) throw httpError(HttpStatus.CONFLICT, 'AGENT_RUN_ACTIVE', 'Wait for the current app build to finish before publishing.')
    return { active: false }
  }

  private queueLeaseWhere(input: { workerId?: string; leaseToken?: string }, deployment: any): Record<string, unknown> {
    if (!input.workerId && !input.leaseToken) return {}
    if (!input.workerId || !input.leaseToken || deployment.queueLeaseOwner !== input.workerId || deployment.queueLeaseToken !== input.leaseToken || !deployment.queueLeaseExpiresAt || deployment.queueLeaseExpiresAt <= new Date()) {
      throw httpError(HttpStatus.CONFLICT, 'PUBLISH_LEASE_LOST', 'This Core worker no longer owns the publish lease.')
    }
    return { queueLeaseOwner: input.workerId, queueLeaseToken: input.leaseToken, queueLeaseExpiresAt: { gt: new Date() } }
  }

  async claimNext(input: { workerId: string; leaseSeconds: number; maxConcurrent: number }) {
    this.requireEnabled()
    const workerId = input.workerId?.trim()
    if (!workerId || workerId.length > 128 || !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 30 || input.leaseSeconds > 300 || !Number.isInteger(input.maxConcurrent) || input.maxConcurrent < 1 || input.maxConcurrent > 100) {
      throw httpError(HttpStatus.BAD_REQUEST, 'INVALID_QUEUE_CLAIM', 'Queue claim settings are invalid.')
    }
    const now = new Date()
    const maxConcurrent = Math.min(input.maxConcurrent, parseLimit('PUBLISH_MAX_CONCURRENT', 3))
    return prisma.$transaction(async (tx: any) => {
      const leaseCount = await tx.deployment.count({ where: { finishedAt: null, queueLeaseExpiresAt: { gt: now } } })
      if (leaseCount >= maxConcurrent) return { job: null }
      const eligible = await tx.deployment.findFirst({
        where: {
          finishedAt: null,
          status: { in: [DeploymentStatus.QUEUED, DeploymentStatus.PREPARING_WORKSPACE, DeploymentStatus.SAVING_SOURCE, DeploymentStatus.BUILDING, DeploymentStatus.VERIFYING, DeploymentStatus.ACTIVATING] },
          OR: [{ queueLeaseExpiresAt: null }, { queueLeaseExpiresAt: { lte: now } }],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      if (!eligible) return { job: null }
      const token = randomUUID()
      const updated = await tx.deployment.updateMany({
        where: { id: eligible.id, finishedAt: null, OR: [{ queueLeaseExpiresAt: null }, { queueLeaseExpiresAt: { lte: now } }] },
        data: { queueLeaseOwner: workerId, queueLeaseToken: token, queueLeaseExpiresAt: new Date(now.getTime() + input.leaseSeconds * 1000), attemptCount: { increment: 1 } },
      })
      if (updated.count !== 1) return { job: null }
      const deployment = await tx.deployment.findUnique({ where: { id: eligible.id }, include: { tenantApp: { include: { tenant: { include: { owner: { select: { email: true, plan: true } } } } } } } })
      const rollbackTarget = deployment.rollbackSourceId ? await tx.deployment.findUnique({ where: { id: deployment.rollbackSourceId }, select: { id: true, vercelOrigin: true, vercelDeploymentId: true } }) : null
      return { job: { ...deployment, leaseToken: token, ...(rollbackTarget ? { rollbackTarget } : {}) } }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: any) => {
      if (error?.code === 'P2034') return { job: null }
      throw error
    })
  }

  async renewQueueLease(input: { deploymentId: string; workerId: string; leaseToken: string; leaseSeconds: number }) {
    this.requireEnabled()
    const leaseSeconds = Math.max(30, Math.min(300, input.leaseSeconds))
    const until = new Date(Date.now() + leaseSeconds * 1000)
    const result = await prisma.deployment.updateMany({
      where: { id: input.deploymentId, queueLeaseOwner: input.workerId, queueLeaseToken: input.leaseToken, finishedAt: null },
      data: { queueLeaseExpiresAt: until },
    })
    return { renewed: result.count === 1, leaseExpiresAt: result.count === 1 ? until : null }
  }

  async releaseQueueLease(input: { deploymentId: string; workerId: string; leaseToken: string; retryAfterSeconds?: number }) {
    this.requireEnabled()
    const seconds = Math.max(5, Math.min(300, input.retryAfterSeconds ?? 15))
    const result = await prisma.deployment.updateMany({
      where: { id: input.deploymentId, queueLeaseOwner: input.workerId, queueLeaseToken: input.leaseToken, finishedAt: null },
      data: { queueLeaseOwner: null, queueLeaseToken: null, queueLeaseExpiresAt: new Date(Date.now() + seconds * 1000) },
    })
    return { released: result.count === 1 }
  }

  async reserveVercelBudget(input: { deploymentId: string; workerId: string; leaseToken: string }) {
    this.requireEnabled()
    const now = new Date()
    const hourlyLimit = Math.min(300, parseLimit('VERCEL_DEPLOYS_PER_HOUR_BUDGET', 300))
    const fiveMinuteLimit = Math.min(120, parseLimit('VERCEL_DEPLOYS_PER_5_MINUTES_BUDGET', 120))
    const dailyLimit = Math.min(6000, parseLimit('VERCEL_DEPLOYS_PER_DAY_BUDGET', 6000))
    return prisma.$transaction(async (tx: any) => {
      const deployment = await tx.deployment.findUnique({ where: { id: input.deploymentId } })
      if (!deployment) throw new NotFoundException('Deployment not found.')
      if (deployment.queueLeaseOwner !== input.workerId || deployment.queueLeaseToken !== input.leaseToken || !deployment.queueLeaseExpiresAt || deployment.queueLeaseExpiresAt <= now || deployment.finishedAt) {
        throw httpError(HttpStatus.CONFLICT, 'PUBLISH_LEASE_LOST', 'This Core worker no longer owns the publish lease.')
      }
      if (deployment.vercelRequestedAt) return { allowed: true, reserved: false, reservedAt: deployment.vercelRequestedAt }
      const [hourly, fiveMinute, daily] = await Promise.all([
        tx.deployment.count({ where: { vercelRequestedAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }),
        tx.deployment.count({ where: { vercelRequestedAt: { gte: new Date(now.getTime() - 5 * 60_000) } } }),
        tx.deployment.count({ where: { vercelRequestedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } } }),
      ])
      if (hourly >= hourlyLimit || fiveMinute >= fiveMinuteLimit || daily >= dailyLimit) return { allowed: false, reserved: false, retryAfterSeconds: 60 }
      const updated = await tx.deployment.updateMany({
        where: { id: deployment.id, queueLeaseOwner: input.workerId, queueLeaseToken: input.leaseToken, queueLeaseExpiresAt: { gt: now }, vercelRequestedAt: null, finishedAt: null },
        data: { vercelRequestedAt: now },
      })
      if (updated.count !== 1) throw httpError(HttpStatus.CONFLICT, 'PUBLISH_LEASE_LOST', 'This Core worker no longer owns the publish lease.')
      return { allowed: true, reserved: true, reservedAt: now }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: any) => {
      if (error?.code === 'P2034') return { allowed: false, reserved: false, retryAfterSeconds: 5 }
      throw error
    })
  }

  async reconciliationProjects() {
    this.requireEnabled()
    const apps = await prisma.tenantApp.findMany({ where: { vercelProjectId: { not: null } }, select: { id: true, vercelProjectId: true, tenant: { select: { slug: true } }, deployments: { where: { vercelDeploymentId: { not: null } }, select: { vercelDeploymentId: true } } } })
    return apps.map((app: any) => ({ appId: app.id, projectId: app.vercelProjectId, slug: app.tenant.slug, knownDeploymentIds: app.deployments.map((item: any) => item.vercelDeploymentId).filter(Boolean) }))
  }

  async recordUnexpectedProviderDeployment(input: { projectId: string; deploymentId: string; readyState?: string; url?: string; sourceSha?: string; reconciliationStatus?: string }) {
    this.requireEnabled()
    const where = { provider_deploymentId: { provider: 'vercel', deploymentId: input.deploymentId } }
    const existing = await prisma.publishProviderEvent.findUnique({ where })
    const reconciliationStatus = input.reconciliationStatus && input.reconciliationStatus !== 'DETECTED'
      ? input.reconciliationStatus
      : existing?.reconciliationStatus ?? 'DETECTED'
    await prisma.publishProviderEvent.upsert({
      where,
      create: { provider: 'vercel', projectId: input.projectId, deploymentId: input.deploymentId, eventType: 'UNEXPECTED_PRODUCTION_DEPLOYMENT', reconciliationStatus, readyState: input.readyState?.slice(0, 40), url: input.url?.slice(0, 253), sourceSha: input.sourceSha?.slice(0, 64) },
      update: { lastSeenAt: new Date(), reconciliationStatus, readyState: input.readyState?.slice(0, 40), url: input.url?.slice(0, 253), sourceSha: input.sourceSha?.slice(0, 64) },
    })
    return { firstSeen: !existing, reconciliationStatus }
  }

  async saveProject(input: { userId: string; workspaceKey: string; coreAppId: number; projectId: string; projectName: string }) {
    this.requireEnabled()
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    await prisma.tenantApp.update({ where: { id: app.id }, data: { vercelProjectId: input.projectId, vercelProjectName: input.projectName } })
    return { ok: true }
  }

  private async beginResponse(app: any, deployment: any, reused: boolean, rollbackTarget?: any) {
    const current = app.liveDeploymentId ? await prisma.deployment.findUnique({ where: { id: app.liveDeploymentId } }) : null
    return {
      deploymentId: deployment.id,
      reused,
      status: deployment.status,
      finishedAt: deployment.finishedAt,
      lastEventSeq: deployment.lastEventSeq,
      slug: deployment.slug,
      rootDomain: process.env.PUBLISH_ROOT_DOMAIN || 'seltra.co',
      github: { repoId: app.githubRepoId, fullName: app.githubRepoFullName },
      vercel: { projectId: app.vercelProjectId, projectName: app.vercelProjectName },
      current: current ? { deploymentId: current.id, vercelOrigin: current.vercelOrigin } : null,
      ...(rollbackTarget ? { rollbackTarget: { id: rollbackTarget.id, vercelOrigin: rollbackTarget.vercelOrigin, vercelDeploymentId: rollbackTarget.vercelDeploymentId } } : {}),
    }
  }

  async progress(input: { deploymentId: string; seq: number; status: DeploymentStatus; message?: string; patch?: Record<string, unknown>; workerId?: string; leaseToken?: string }) {
    this.requireEnabled()
    const current = await prisma.deployment.findUnique({ where: { id: input.deploymentId } })
    if (!current) throw new NotFoundException('Deployment not found.')
    if (!Number.isSafeInteger(input.seq) || input.seq < 1) throw httpError(HttpStatus.BAD_REQUEST, 'INVALID_EVENT_SEQUENCE', 'seq must be a positive integer.')
    if (input.seq <= current.lastEventSeq) return { ignored: true }
    const leaseWhere = this.queueLeaseWhere(input, current)
    if (current.finishedAt || STATUS_RANK[input.status] < STATUS_RANK[current.status]) {
      throw httpError(HttpStatus.CONFLICT, 'STATUS_REGRESSION', 'Publish status cannot move backwards or continue after completion.')
    }
    const allowedPatch = ['sourceCommitSha', 'vercelProjectId', 'vercelDeploymentId', 'vercelOrigin', 'healthStatus', 'healthCheckedAt', 'verifiedAt', 'timings']
    const data: Record<string, unknown> = {}
    const eventData: Record<string, unknown> = {}
    for (const key of allowedPatch) if (input.patch && Object.prototype.hasOwnProperty.call(input.patch, key)) {
      data[key] = input.patch[key]
      eventData[key] = input.patch[key]
    }
    await prisma.$transaction([
      prisma.deployment.update({ where: { id: current.id, ...leaseWhere }, data: { status: input.status, lastEventSeq: input.seq, ...data } }),
      prisma.publishEvent.create({ data: { deploymentId: current.id, seq: input.seq, status: input.status, message: input.message?.slice(0, 500), ...(Object.keys(eventData).length ? { data: eventData as Prisma.InputJsonObject } : {}) } }),
    ])
    if (typeof input.patch?.vercelProjectId === 'string') await prisma.tenantApp.update({ where: { id: current.tenantAppId }, data: { vercelProjectId: input.patch.vercelProjectId } })
    return { ignored: false }
  }

  async finish(input: { deploymentId: string; outcome: 'LIVE' | 'FAILED'; errorCode?: string; errorMessage?: string; buildLogTail?: string; workerId?: string; leaseToken?: string }) {
    this.requireEnabled()
    const deployment = await prisma.deployment.findUnique({ where: { id: input.deploymentId }, include: { tenantApp: true } })
    if (!deployment) throw new NotFoundException('Deployment not found.')
    const targetStatus = input.outcome === 'LIVE' ? DeploymentStatus.LIVE : DeploymentStatus.FAILED
    if (deployment.finishedAt) {
      if (deployment.status === targetStatus) return { repeated: true }
      throw httpError(HttpStatus.CONFLICT, 'DEPLOYMENT_ALREADY_FINISHED', 'Deployment already finished with a different outcome.')
    }
    const leaseWhere = this.queueLeaseWhere(input, deployment)
    const now = new Date()
    if (input.outcome === 'FAILED') {
      await prisma.$transaction([
        prisma.deployment.update({ where: { id: deployment.id, ...leaseWhere }, data: {
          status: DeploymentStatus.FAILED, errorCode: input.errorCode?.slice(0, 100) ?? 'INTERNAL',
          errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
          buildLogTail: input.buildLogTail?.slice(-8192) ?? null,
          finishedAt: now, lastEventSeq: deployment.lastEventSeq + 1, queueLeaseOwner: null, queueLeaseToken: null, queueLeaseExpiresAt: null,
        } }),
        prisma.publishEvent.create({ data: { deploymentId: deployment.id, seq: deployment.lastEventSeq + 1, status: DeploymentStatus.FAILED, message: input.errorCode?.slice(0, 500) ?? 'Publish failed.', data: { errorCode: input.errorCode ?? 'INTERNAL' } } }),
        prisma.tenantApp.updateMany({ where: { id: deployment.tenantAppId, activePublishId: deployment.id }, data: { activePublishId: null } }),
      ])
      return { outcome: 'FAILED' }
    }
    if (!deployment.vercelOrigin || !deployment.verifiedAt) throw httpError(HttpStatus.CONFLICT, 'DEPLOYMENT_NOT_VERIFIED', 'A deployment must pass health verification before it can go live.')
    await prisma.$transaction(async (tx) => {
      if (deployment.previousDeploymentId) await tx.deployment.updateMany({ where: { id: deployment.previousDeploymentId, tenantAppId: deployment.tenantAppId, status: DeploymentStatus.LIVE }, data: { status: DeploymentStatus.SUPERSEDED } })
      await tx.deployment.update({ where: { id: deployment.id, ...leaseWhere }, data: { status: DeploymentStatus.LIVE, liveAt: now, publicVerifiedAt: now, finishedAt: now, lastEventSeq: deployment.lastEventSeq + 1, queueLeaseOwner: null, queueLeaseToken: null, queueLeaseExpiresAt: null } })
      await tx.publishEvent.create({ data: { deploymentId: deployment.id, seq: deployment.lastEventSeq + 1, status: DeploymentStatus.LIVE, message: 'Publish completed and the public hostname was verified.' } })
      await tx.tenantApp.update({ where: { id: deployment.tenantAppId }, data: {
        activePublishId: null,
        liveDeploymentId: deployment.id,
        lastKnownGoodDeploymentId: deployment.id,
        publicationStatus: PublishPublicationStatus.PUBLISHED,
        publishedUrl: `https://${deployment.slug}.${process.env.PUBLISH_ROOT_DOMAIN || 'seltra.co'}`,
        lastCommitSha: deployment.sourceCommitSha,
        deploymentUrl: deployment.vercelOrigin,
      } })
    })
    return { outcome: 'LIVE' }
  }

  async beginUnpublish(input: { userId: string; coreAppId: number; workspaceKey: string; idempotencyKey: string }) {
    this.requireEnabled()
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    await prisma.tenantApp.update({ where: { id: app.id }, data: { publicationStatus: PublishPublicationStatus.UNPUBLISHING } })
    return { coreAppId: app.coreAppId, slug: app.tenant.slug, idempotencyKey: input.idempotencyKey }
  }

  async finishUnpublish(input: { userId: string; coreAppId: number; workspaceKey: string }) {
    this.requireEnabled()
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    await prisma.tenantApp.update({ where: { id: app.id }, data: { publicationStatus: PublishPublicationStatus.UNPUBLISHED, liveDeploymentId: null, publishedUrl: null } })
    return { publicationStatus: PublishPublicationStatus.UNPUBLISHED }
  }

  async pushResult(input: { userId: string; workspaceKey: string; coreAppId: number; sha?: string; kind: 'COMPLETE' | 'INTERRUPTED'; error?: string }) {
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    const degraded = Boolean(input.error)
    await prisma.tenantApp.update({ where: { id: app.id }, data: {
      lastPushedSha: input.sha ?? app.lastPushedSha,
      commitSha: input.sha ?? app.commitSha,
      lastPushedAt: degraded ? app.lastPushedAt : new Date(),
      lastPushError: input.error?.slice(0, 500) ?? null,
      sourceState: input.kind === 'COMPLETE' ? PublishSourceState.COMPLETE : PublishSourceState.INTERRUPTED,
      persistenceStatus: degraded ? PublishPersistenceStatus.DEGRADED : PublishPersistenceStatus.OK,
    } })
    return { ok: true }
  }

  async persistenceBegin(input: { userId: string; workspaceKey: string; operationId: string; reason: string }) {
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: input.userId, coreWorkspaceKey: input.workspaceKey }, select: { id: true } })
    if (!tenant) throw new ForbiddenException('You do not own this workspace.')
    const existing = await prisma.workspacePersistenceOperation.findUnique({ where: { tenantId_operationId: { tenantId: tenant.id, operationId: input.operationId } } })
    if (existing?.status === WorkspacePersistenceOperationStatus.SAFE_TO_DESTROY) return { operationId: input.operationId, status: existing.status, idempotent: true }
    const operation = existing
      ? await prisma.workspacePersistenceOperation.update({ where: { id: existing.id }, data: { status: WorkspacePersistenceOperationStatus.PERSISTING, errorCode: null } })
      : await prisma.workspacePersistenceOperation.create({ data: { tenantId: tenant.id, workspaceKey: input.workspaceKey, operationId: input.operationId, reason: input.reason, status: WorkspacePersistenceOperationStatus.PERSISTING } })
    await prisma.tenantApp.updateMany({ where: { tenantId: tenant.id }, data: { persistenceStatus: PublishPersistenceStatus.PENDING, workspaceStatus: PublishWorkspaceStatus.PERSISTING } })
    return { operationId: operation.operationId, status: operation.status, idempotent: Boolean(existing) }
  }

  async persistenceTransition(input: { userId: string; workspaceKey: string; operationId: string; status: 'SOURCE_VERIFIED' | 'SNAPSHOT_VERIFIED' | 'SAFE_TO_DESTROY' | 'DEGRADED'; githubRevisions?: Record<string, string>; snapshotVersion?: string; manifestKey?: string; bundleKey?: string; bundleSha256?: string; errorCode?: string }) {
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: input.userId, coreWorkspaceKey: input.workspaceKey }, select: { id: true } })
    if (!tenant) throw new ForbiddenException('You do not own this workspace.')
    const operation = await prisma.workspacePersistenceOperation.findUnique({ where: { tenantId_operationId: { tenantId: tenant.id, operationId: input.operationId } } })
    if (!operation || operation.workspaceKey !== input.workspaceKey) throw new NotFoundException('Persistence operation not found.')
    if (operation.status === WorkspacePersistenceOperationStatus.SAFE_TO_DESTROY) return { operationId: input.operationId, status: operation.status, idempotent: true }

    const next = input.status as WorkspacePersistenceOperationStatus
    if (next === WorkspacePersistenceOperationStatus.DEGRADED) {
      await prisma.workspacePersistenceOperation.update({ where: { id: operation.id }, data: { status: next, errorCode: (input.errorCode || 'PERSISTENCE_FAILED').slice(0, 80) } })
      await prisma.tenantApp.updateMany({ where: { tenantId: tenant.id }, data: { persistenceStatus: PublishPersistenceStatus.DEGRADED } })
      return { operationId: input.operationId, status: next }
    }
    if (next === WorkspacePersistenceOperationStatus.SOURCE_VERIFIED) {
      if (operation.status !== WorkspacePersistenceOperationStatus.PERSISTING || !input.githubRevisions || !Object.keys(input.githubRevisions).length || Object.values(input.githubRevisions).some((sha) => !/^[a-f0-9]{40,64}$/i.test(sha))) throw new ConflictException('Verified GitHub revisions are required before advancing the journal.')
      await prisma.workspacePersistenceOperation.update({ where: { id: operation.id }, data: { status: next, githubRevisions: input.githubRevisions } })
      return { operationId: input.operationId, status: next }
    }
    if (next === WorkspacePersistenceOperationStatus.SNAPSHOT_VERIFIED) {
      if (operation.status !== WorkspacePersistenceOperationStatus.SOURCE_VERIFIED || !operation.githubRevisions || !input.snapshotVersion || !input.manifestKey || !input.bundleKey || !input.bundleSha256 || !/^[a-f0-9]{64}$/i.test(input.bundleSha256)) throw new ConflictException('Verified GitHub and R2 snapshot references are required before advancing the journal.')
      await prisma.workspacePersistenceOperation.update({ where: { id: operation.id }, data: { status: next, snapshotVersion: input.snapshotVersion, manifestKey: input.manifestKey, bundleKey: input.bundleKey, bundleSha256: input.bundleSha256 } })
      return { operationId: input.operationId, status: next }
    }
    if (operation.status !== WorkspacePersistenceOperationStatus.SNAPSHOT_VERIFIED || !operation.githubRevisions || !operation.snapshotVersion || !operation.manifestKey || !operation.bundleKey || !operation.bundleSha256) throw new ConflictException('All verified source and snapshot references are required before SAFE_TO_DESTROY.')
    await prisma.$transaction([
      prisma.workspacePersistenceOperation.update({ where: { id: operation.id }, data: { status: WorkspacePersistenceOperationStatus.SAFE_TO_DESTROY, completedAt: new Date(), errorCode: null } }),
      prisma.tenantApp.updateMany({ where: { tenantId: tenant.id }, data: { persistenceStatus: PublishPersistenceStatus.OK, workspaceStatus: PublishWorkspaceStatus.SAFE_TO_DESTROY, lastSnapshotAt: new Date() } }),
    ])
    return { operationId: input.operationId, status: WorkspacePersistenceOperationStatus.SAFE_TO_DESTROY }
  }

  async persistenceLatest(workspaceKey: string) {
    const tenant = await prisma.tenant.findUnique({ where: { coreWorkspaceKey: workspaceKey }, select: { id: true } })
    if (!tenant) throw new NotFoundException('Workspace not found.')
    const operation = await prisma.workspacePersistenceOperation.findFirst({ where: { tenantId: tenant.id, workspaceKey, status: WorkspacePersistenceOperationStatus.SAFE_TO_DESTROY }, orderBy: { completedAt: 'desc' } })
    if (!operation) return { status: 'NONE' }
    return { operationId: operation.operationId, status: operation.status, snapshotVersion: operation.snapshotVersion, manifestKey: operation.manifestKey, bundleKey: operation.bundleKey, bundleSha256: operation.bundleSha256, githubRevisions: operation.githubRevisions }
  }

  async repositoryInfo(input: { userId: string; workspaceKey: string; coreAppId: number }) {
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    return {
      tenantAppId: app.id,
      tenantId: app.tenantId,
      coreAppId: app.coreAppId,
      name: app.name,
      slug: app.tenant.slug,
      githubRepoId: app.githubRepoId,
      githubRepoFullName: app.githubRepoFullName,
      repoUrl: app.repoUrl,
      githubRepoVisibility: app.githubRepoVisibility,
      githubDefaultBranch: app.githubDefaultBranch,
      lastPushedSha: app.lastPushedSha,
      commitSha: app.commitSha,
      vercelProjectId: app.vercelProjectId,
      vercelProjectName: app.vercelProjectName,
      deploymentUrl: app.deploymentUrl,
    }
  }

  async repositorySaved(input: { userId: string; workspaceKey: string; coreAppId: number; githubRepoId: string; githubRepoFullName: string; githubRepoVisibility: 'public' | 'private'; githubDefaultBranch?: string }) {
    const expectedVisibility = mode() === PublishDeployMode.hobby ? 'public' : 'private'
    if (input.githubRepoVisibility !== expectedVisibility) throw httpError(HttpStatus.CONFLICT, 'REPOSITORY_VISIBILITY_REQUIRED', `Source repositories must be ${expectedVisibility} in the configured deploy mode.`)
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    await prisma.tenantApp.update({ where: { id: app.id }, data: {
      githubRepoId: input.githubRepoId,
      githubRepoFullName: input.githubRepoFullName,
      repoUrl: `https://github.com/${input.githubRepoFullName}`,
      githubRepoVisibility: input.githubRepoVisibility,
      ...(input.githubDefaultBranch ? { githubDefaultBranch: input.githubDefaultBranch } : {}),
    } })
    return { ok: true }
  }

  async acquireEditLease(input: { userId: string; workspaceKey: string; coreAppId: number; holderSessionId: string; ttlSeconds?: number }) {
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + Math.min(120, Math.max(30, input.ttlSeconds ?? 60)) * 1000)
    const result = await prisma.tenantApp.updateMany({
      where: { id: app.id, OR: [{ editLeaseExpiresAt: null }, { editLeaseExpiresAt: { lte: now } }, { editLeaseHolderSessionId: input.holderSessionId }] },
      data: { editLeaseHolderSessionId: input.holderSessionId, editLeaseExpiresAt: expiresAt },
    })
    if (result.count !== 1) throw new ConflictException({ code: 'EDIT_LOCKED', message: 'Another session is editing this app.' })
    return { acquired: true, holderSessionId: input.holderSessionId, expiresAt }
  }

  async renewEditLease(input: { userId: string; workspaceKey: string; coreAppId: number; holderSessionId: string; ttlSeconds?: number }) {
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + Math.min(120, Math.max(30, input.ttlSeconds ?? 60)) * 1000)
    const result = await prisma.tenantApp.updateMany({ where: { id: app.id, editLeaseHolderSessionId: input.holderSessionId, editLeaseExpiresAt: { gt: now } }, data: { editLeaseExpiresAt: expiresAt } })
    if (result.count !== 1) throw new ConflictException({ code: 'EDIT_LOCKED', message: 'The edit lease expired or belongs to another session.' })
    return { renewed: true, holderSessionId: input.holderSessionId, expiresAt }
  }

  async releaseEditLease(input: { userId: string; workspaceKey: string; coreAppId: number; holderSessionId: string }) {
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    const result = await prisma.tenantApp.updateMany({ where: { id: app.id, editLeaseHolderSessionId: input.holderSessionId }, data: { editLeaseHolderSessionId: null, editLeaseExpiresAt: null } })
    return { released: result.count === 1 }
  }

  async workspaceState(input: { userId: string; workspaceKey: string; coreAppId: number; workspaceStatus: PublishWorkspaceStatus; snapshotAt?: string }) {
    const app = await this.resolveOwnedApp(input.userId, input.coreAppId, input.workspaceKey)
    await prisma.tenantApp.update({ where: { id: app.id }, data: { workspaceStatus: input.workspaceStatus, ...(input.snapshotAt ? { lastSnapshotAt: new Date(input.snapshotAt) } : {}) } })
    return { ok: true }
  }

  async status(userId: string, appId: string | number) {
    this.requireEnabled()
    const app = await this.resolveOwnedApp(userId, appId)
    const recent = await prisma.deployment.findMany({ where: { tenantAppId: app.id }, orderBy: { createdAt: 'desc' }, take: 10 })
    const active = app.activePublishId ? recent.find((deployment: any) => deployment.id === app.activePublishId) ?? await prisma.deployment.findUnique({ where: { id: app.activePublishId } }) : null
    const queuePosition = active?.status === DeploymentStatus.QUEUED ? await prisma.deployment.count({ where: { status: DeploymentStatus.QUEUED, createdAt: { lt: active.createdAt } } }) + 1 : undefined
    return {
      enabled: true,
      deployMode: mode(),
      publicationStatus: app.publicationStatus,
      liveUrl: app.publishedUrl,
      repoUrl: app.repoUrl,
      commitSha: app.commitSha ?? app.lastPushedSha,
      vercelProjectId: app.vercelProjectId,
      deploymentUrl: app.deploymentUrl,
      live: app.liveDeploymentId ? await prisma.deployment.findUnique({ where: { id: app.liveDeploymentId } }) : null,
      current: active,
      ...(queuePosition ? { queuePosition } : {}),
      workspaceStatus: app.workspaceStatus,
      persistenceStatus: app.persistenceStatus,
      recent,
    }
  }

  async deployments(userId: string, appId: string | number, limit = 10, cursor?: string) {
    this.requireEnabled()
    const app = await this.resolveOwnedApp(userId, appId)
    const take = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 10))
    const rows = await prisma.deployment.findMany({ where: { tenantAppId: app.id }, orderBy: { createdAt: 'desc' }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
    const hasMore = rows.length > take
    const page = hasMore ? rows.slice(0, take) : rows
    return { items: page.map((item: any) => ({ ...item, rollbackEligible: Boolean(item.verifiedAt && item.vercelOrigin && [DeploymentStatus.LIVE, DeploymentStatus.SUPERSEDED].includes(item.status)) })), nextCursor: hasMore ? page.at(-1)?.id : null }
  }

  async deployment(userId: string, deploymentId: string, sinceSeq = 0) {
    this.requireEnabled()
    const deployment = await prisma.deployment.findFirst({ where: { id: deploymentId, tenantApp: { tenant: { ownerId: userId } } } })
    if (!deployment) throw new NotFoundException('Deployment not found.')
    const events = await prisma.publishEvent.findMany({ where: { deploymentId, seq: { gt: Math.max(0, sinceSeq) } }, orderBy: { seq: 'asc' } })
    return { ...deployment, events }
  }

  async publicRepos() {
    return prisma.tenantApp.findMany({ where: { githubRepoVisibility: PublishRepoVisibility.public }, select: { id: true, tenantId: true, name: true, githubRepoFullName: true, githubRepoVisibility: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } })
  }
}

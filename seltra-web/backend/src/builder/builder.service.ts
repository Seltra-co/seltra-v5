import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { prisma } from '../db'
import { Prisma } from '@prisma/client'
import { resolveUserIdFromAuthorization } from '../auth/resolve-user'
import { planLimits } from '../common/plan-limits'
import { CreditsService } from '../credits/credits.service'
import { creditAllowanceForPlan, nextUtcCreditReset } from '../common/credit-plan'
import { provisionEngineKey } from '../engine/engine-key'
import { deterministicPromptIntent, resolvePromptIntent } from './prompt-intent'

function workspaceFileMime(filePath: string) {
  const extension = filePath.toLowerCase().split('.').pop()
  const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' }
  return extension ? types[extension] : undefined
}

@Injectable()
export class BuilderService {
  private readonly logger = new Logger(BuilderService.name)
  private readonly redeemedTickets = new Map<string, number>()
  constructor(private readonly jwt: JwtService, private readonly credits: CreditsService) {}

  private coreSecret() {
    const secret = process.env.CORE_TOKEN_SECRET
    if (!secret || secret.length < 32) throw new Error('CORE_TOKEN_SECRET must contain at least 32 characters')
    return secret
  }

  private async measureSessionStage<T>(projectId: string, requestId: string, stage: string, work: () => Promise<T>): Promise<T> {
    const startedAt = Date.now()
    try { return await work() }
    finally { this.logger.log(JSON.stringify({ event: 'core_project_session_stage', requestId, projectId, stage, durationMs: Date.now() - startedAt })) }
  }

  async createSession(authorization: string | undefined, tenantId: string) {
    const requestStartedAt = Date.now()
    const requestId = randomUUID()
    this.logger.log(JSON.stringify({ event: 'core_project_phase', requestId, projectId: tenantId, phase: 'project session request', at: new Date(requestStartedAt).toISOString() }))
    const userId = await this.measureSessionStage(tenantId, requestId, 'authorization', () => resolveUserIdFromAuthorization(authorization, this.jwt))
    if (!userId) throw new ForbiddenException('Authentication is required to start a builder session.')
    const tenant = await this.measureSessionStage(tenantId, requestId, 'tenant lookup', () => prisma.tenant.findFirst({
      where: { id: tenantId, ownerId: userId },
      include: { owner: { select: { plan: true, email: true } } },
    }))
    if (!tenant) throw new ForbiddenException('You do not have access to this workspace.')
    if (tenant.status !== 'active') throw new ForbiddenException('This workspace is not active.')
    const plan = tenant.owner?.plan ?? 'free'
    const creditAccount = await this.measureSessionStage(tenantId, requestId, 'credit snapshot', () => this.credits.getAccountSnapshot(userId, plan))

    let coreWorkspaceKey = tenant.coreWorkspaceKey
    if (!coreWorkspaceKey) {
      // Stable short path/hostname key. Retry only on the extremely unlikely
      // unique collision; the tenant UUID remains the signed workspace id.
      await this.measureSessionStage(tenantId, requestId, 'workspace key allocation', async () => {
      for (let attempt = 0; attempt < 4 && !coreWorkspaceKey; attempt += 1) {
        const candidate = randomBytes(9).toString('hex').slice(0, 12)
        const result = await prisma.tenant.updateMany({
          where: { id: tenant.id, coreWorkspaceKey: null },
          data: { coreWorkspaceKey: candidate },
        })
        if (result.count) coreWorkspaceKey = candidate
        else coreWorkspaceKey = (await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { coreWorkspaceKey: true } }))?.coreWorkspaceKey ?? null
      }
      })
      if (!coreWorkspaceKey) throw new Error('Could not allocate a workspace key')
    }

    const used = Math.max(0, creditAccount.windowAllowance - Math.min(creditAccount.balance, creditAccount.windowAllowance))
    const coreToken = await this.measureSessionStage(tenantId, requestId, 'core token signing', () => this.jwt.signAsync(
      { workspaceId: tenant.id, creditWorkspaceId: userId, coreWorkspaceKey: coreWorkspaceKey!, storeSlug: tenant.slug, plan, email: tenant.owner?.email ?? '', jti: randomUUID() },
      { secret: this.coreSecret(), algorithm: 'HS256', issuer: 'seltra-api', audience: 'seltra-core', subject: userId!, expiresIn: '10m' },
    ))
    const response = {
      coreToken,
      expiresIn: 600,
      workspaceId: tenant.id,
      creditWorkspaceId: userId,
      coreWorkspaceKey: coreWorkspaceKey!,
      storeSlug: tenant.slug,
      plan,
      limits: { ...planLimits(plan), aiCredits: { used, limit: creditAccount.windowAllowance, balance: creditAccount.balance, resetsAt: nextUtcCreditReset().toISOString() } },
    }
    this.logger.log(JSON.stringify({ event: 'core_project_phase', requestId, projectId: tenantId, phase: 'project session response', at: new Date().toISOString(), durationMs: Date.now() - requestStartedAt }))
    return response
  }

  async promptIntent(authorization: string | undefined, prompt: string) {
    const userId = await resolveUserIdFromAuthorization(authorization, this.jwt)
    if (!userId) throw new ForbiddenException('Authentication is required to name a project.')
    const startedAt = Date.now()
    const account = process.env.MODEL_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID
    const apiKey = process.env.MODEL_API_KEY ?? process.env.CLOUDFLARE_API_TOKEN
    const baseUrl = account
      ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1`
      : (process.env.MODEL_BASE_URL ?? '')
    const model = process.env.AI_MODEL_FAST ?? process.env.AI_MODEL_DEFAULT ?? ''
    const result = await resolvePromptIntent({ prompt, baseUrl, model, apiKey, timeoutMs: 1_200 })
    this.logger.log(JSON.stringify({ event: 'builder_intent_ready', durationMs: Date.now() - startedAt, modelConfigured: Boolean(model && apiKey && baseUrl), source: result.intent ? 'model' : 'fallback' }))
    return result ?? deterministicPromptIntent(prompt)
  }

  async getCredits(authorization: string | undefined, tenantId?: string) {
    const userId = await resolveUserIdFromAuthorization(authorization, this.jwt)
    if (!userId) throw new ForbiddenException('Authentication is required to read credits.')
    let plan: string | null | undefined
    if (tenantId) {
      const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, ownerId: userId }, include: { owner: { select: { plan: true } } } })
      if (!tenant) throw new ForbiddenException('You do not have access to this project.')
      plan = tenant.owner?.plan
    } else {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
      if (!user) throw new ForbiddenException('User account was not found.')
      plan = user.plan
    }
    const account = await this.credits.getAccountSnapshot(userId, plan ?? 'free')
    const used = Math.max(0, account.windowAllowance - Math.min(account.balance, account.windowAllowance))
    return { used, limit: account.windowAllowance, balance: account.balance, resetsAt: nextUtcCreditReset().toISOString(), plan: account.plan }
  }

  async listApps(authorization: string | undefined, tenantId: string) {
    const userId = await resolveUserIdFromAuthorization(authorization, this.jwt)
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, ownerId: userId }, select: { id: true } })
    if (!tenant) throw new ForbiddenException('You do not have access to this workspace.')
    return prisma.tenantApp.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' } })
  }

  async createWsTicket(authorization: string | undefined, tenantId: string, coreToken?: string) {
    const startedAt = Date.now()
    const session = coreToken
      ? await this.jwt.verifyAsync<{ workspaceId?: string }>(coreToken, {
          secret: this.coreSecret(), algorithms: ['HS256'], issuer: 'seltra-api', audience: 'seltra-core',
        }).then((claims) => {
          if (claims.workspaceId !== tenantId) throw new UnauthorizedException('Invalid Core session.')
          return { workspaceId: claims.workspaceId }
        })
      : await this.createSession(authorization, tenantId)
    const ticket = await this.jwt.signAsync(
      { workspaceId: session.workspaceId, jti: randomUUID() },
      { secret: this.coreSecret(), algorithm: 'HS256', issuer: 'seltra-api', audience: 'seltra-core-ws', subject: session.workspaceId, expiresIn: '30s' },
    )
    this.logger.log(JSON.stringify({ event: 'core_project_phase', projectId: tenantId, phase: 'ticket issued', at: new Date().toISOString(), durationMs: Date.now() - startedAt, reusedCoreSession: Boolean(coreToken) }))
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
      const engineApiKey = await provisionEngineKey(payload.workspaceId)
      return { workspaceId: payload.workspaceId, creditWorkspaceId: entitlement.creditWorkspaceId, userId: entitlement.userId, coreWorkspaceKey: entitlement.coreWorkspaceKey, storeSlug: entitlement.storeSlug, email: entitlement.email, plan: entitlement.plan, engineApiKey }
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) throw error
      throw new UnauthorizedException('Invalid websocket ticket.')
    }
  }

  async syncApp(input: { tenantId: string; coreAppId: number; name: string; corePath?: string; status: string; previewUrl?: string; publishedUrl?: string; lastCommitSha?: string; version?: number }) {
    return prisma.tenantApp.upsert({
      where: { tenantId_coreAppId: { tenantId: input.tenantId, coreAppId: input.coreAppId } },
      create: input,
      update: { name: input.name, corePath: input.corePath, status: input.status, previewUrl: input.previewUrl, publishedUrl: input.publishedUrl, lastCommitSha: input.lastCommitSha, version: input.version },
    })
  }

  async syncCoreAppState(authorization: string | undefined, input: { tenantId: string; coreAppId: number; name?: string; corePath?: string; status?: string; previewUrl?: string; eventType?: string; blueprint?: Record<string, unknown>; approved?: boolean }) {
    const userId = await resolveUserIdFromAuthorization(authorization, this.jwt)
    const tenant = await prisma.tenant.findFirst({ where: { id: input.tenantId, ownerId: userId }, select: { id: true } })
    if (!tenant) throw new ForbiddenException('You do not have access to this workspace.')
    const eventType = input.eventType && /^[a-z0-9._-]{1,80}$/i.test(input.eventType) ? input.eventType : 'app.state.updated'
    if (input.blueprint && Buffer.byteLength(JSON.stringify(input.blueprint)) > 64 * 1024) throw new ForbiddenException('Blueprint payload exceeds the storage limit.')
    const visuals = Array.isArray(input.blueprint?.visuals)
      ? input.blueprint.visuals.filter((visual): visual is Record<string, unknown> => typeof visual === 'object' && visual !== null)
      : []
    const app = await prisma.$transaction(async (tx) => {
      const savedApp = await tx.tenantApp.upsert({
      where: { tenantId_coreAppId: { tenantId: input.tenantId, coreAppId: input.coreAppId } },
      create: {
        tenantId: input.tenantId,
        coreAppId: input.coreAppId,
        ...(input.corePath ? { corePath: input.corePath.slice(0, 500) } : {}),
        name: input.name?.trim().slice(0, 120) || `App ${input.coreAppId}`,
        status: input.status ?? 'draft',
        ...(eventType === 'app.build.completed' ? { version: 1 } : {}),
        ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
        ...(input.blueprint ? { blueprint: input.blueprint as Prisma.InputJsonObject } : {}),
        ...(input.approved ? { blueprintApprovedAt: new Date() } : {}),
      },
      update: {
        ...(input.name ? { name: input.name.trim().slice(0, 120) } : {}),
        ...(input.corePath ? { corePath: input.corePath.slice(0, 500) } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(eventType === 'app.build.completed' ? { version: 1 } : {}),
        ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
        ...(input.blueprint ? { blueprint: input.blueprint as Prisma.InputJsonObject } : {}),
        ...(input.approved ? { blueprintApprovedAt: new Date() } : {}),
      },
      })
      if (eventType !== 'app.reconnected') await tx.agentEvent.create({
        data: {
        tenantId: input.tenantId,
        agent: 'supervisor',
        type: eventType,
        action: input.approved ? 'approve_blueprint' : undefined,
        status: 'recorded',
        payload: {
          appId: input.coreAppId,
          appName: savedApp.name,
          ...(input.blueprint ? { blueprint: input.blueprint as Prisma.InputJsonObject } : {}),
          ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
          ...(input.approved ? { approved: true } : {}),
        },
        },
      })
      for (const visual of visuals) {
        const visualId = typeof visual.id === 'string' ? visual.id.slice(0, 160) : ''
        if (!visualId) continue
        const storageRef = `core:${input.coreAppId}:${visualId}`
        const exists = await tx.projectAsset.findFirst({ where: { projectId: input.tenantId, storageRef }, select: { id: true } })
        if (exists) continue
        await tx.projectAsset.create({ data: {
          projectId: input.tenantId,
          kind: typeof visual.type === 'string' ? visual.type.slice(0, 40) : 'other',
          prompt: typeof visual.prompt === 'string' ? visual.prompt.slice(0, 4000) : null,
          storageRef,
        } })
      }
      return savedApp
    })
    return app
  }

  async syncWorkspaceFiles(input: { tenantId: string; workspaceId?: string; coreAppId?: number; runId?: string; files: Array<{ path: string; content: string }> }) {
    const batchSize = 4
    const textFiles = input.files.filter((file) => !file.content.includes('\0'))
    const activeRun = input.runId
      ? await prisma.run.findFirst({ where: { id: input.runId, projectId: input.tenantId, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) } })
      : await prisma.run.findFirst({
        where: { projectId: input.tenantId, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}), state: { in: ['queued', 'running', 'waiting_for_user', 'stopping', 'paused_no_credits'] } },
        orderBy: { createdAt: 'desc' },
      })
    const latestRun = !input.runId && !activeRun
      ? await prisma.run.findFirst({ where: { projectId: input.tenantId, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      : null
    const runId = activeRun?.id ?? latestRun?.id
    const existing = await prisma.projectFile.findMany({
      where: { projectId: input.tenantId, path: { in: textFiles.map((file) => file.path.replaceAll('\\', '/')) } },
      select: { path: true, contentHash: true },
    })
    const priorHashes = new Map(existing.map((file) => [file.path, file.contentHash]))
    const manifestChanges = new Map<string, string>()
    for (let offset = 0; offset < textFiles.length; offset += batchSize) {
      const batch = textFiles.slice(offset, offset + batchSize)
      await Promise.all(batch.map(async (file) => {
        const normalizedPath = file.path.replaceAll('\\', '/')
        const encodedImage = file.content.startsWith('base64:')
        const binary = encodedImage ? Buffer.from(file.content.slice(7), 'base64') : undefined
        const contentHash = createHash('sha256').update(binary ?? file.content).digest('hex')
        if (priorHashes.get(normalizedPath) === contentHash) return
        // Content-addressed blobs are immutable. INSERT .. ON CONFLICT avoids
        // Prisma's read-then-create upsert race when multiple files or gateway
        // sessions submit identical bytes at the same time.
        await prisma.fileBlob.createMany({
          data: [{ hash: contentHash, content: file.content }],
          skipDuplicates: true,
        })
        await prisma.projectFile.upsert({
          where: { projectId_path: { projectId: input.tenantId, path: normalizedPath } },
          update: { contentHash, size: binary?.byteLength ?? Buffer.byteLength(file.content), mime: workspaceFileMime(normalizedPath), storageRef: encodedImage ? contentHash : undefined, inlineContent: file.content, lastRunId: runId },
          create: { projectId: input.tenantId, path: normalizedPath, contentHash, size: binary?.byteLength ?? Buffer.byteLength(file.content), mime: workspaceFileMime(normalizedPath), storageRef: encodedImage ? contentHash : null, inlineContent: file.content, lastRunId: runId },
        })
        const mime = workspaceFileMime(normalizedPath)
        if (encodedImage && mime?.startsWith('image/')) {
          const storageRef = `core:${input.coreAppId ?? 'unknown'}:${normalizedPath}`
          const asset = await prisma.projectAsset.findFirst({ where: { projectId: input.tenantId, storageRef }, select: { id: true } })
          const data = { kind: normalizedPath.includes('/.dyad/media/') ? 'generated_image' : 'image', storageRef }
          if (asset) await prisma.projectAsset.update({ where: { id: asset.id }, data })
          else await prisma.projectAsset.create({ data: { projectId: input.tenantId, ...data } })
        }
        priorHashes.set(normalizedPath, contentHash)
        manifestChanges.set(normalizedPath, contentHash)
      }))
    }
    if (runId) {
      if (manifestChanges.size) {
        await prisma.$transaction(async (tx) => {
          const run = await tx.run.findUnique({ where: { id: runId }, select: { state: true } })
          if (!run) return
          const updated = await tx.run.update({
            where: { id: runId },
            data: { lastEventSeq: { increment: 1 }, lastHeartbeatAt: new Date(), ...(run.state === 'completed' || run.state === 'failed' || run.state === 'stopped' ? {} : { phase: 'build' }) },
            select: { lastEventSeq: true },
          })
          await tx.runEvent.create({ data: {
            runId,
            seq: updated.lastEventSeq,
            type: 'files.persisted',
            phase: 'build',
            agent: 'supervisor',
            payload: { changed: manifestChanges.size, paths: Array.from(manifestChanges.keys()).slice(0, 50) },
          } })
        })
      }
      const files = await prisma.projectFile.findMany({ where: { projectId: input.tenantId }, select: { path: true, contentHash: true } })
      const manifest = Object.fromEntries(files.map((file) => [file.path, file.contentHash]))
      const apps = await prisma.tenantApp.findMany({ where: { tenantId: input.tenantId }, select: { id: true, coreAppId: true, corePath: true, name: true } })
      for (const app of apps) {
        const appSlug = app.corePath?.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)
          || app.name.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80)
        if (!appSlug) continue
        const prefix = `apps/${appSlug}/`
        const appFiles = Object.fromEntries(Object.entries(manifest)
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, hash]) => [path.slice(prefix.length), hash]))
        if (Object.keys(appFiles).length) {
          await prisma.tenantApp.update({ where: { id: app.id }, data: { appManifest: { coreAppId: app.coreAppId, appName: app.name, files: appFiles, updatedAt: new Date().toISOString() } } })
        }
      }
      const latest = await prisma.projectSnapshot.findFirst({ where: { projectId: input.tenantId, runId }, orderBy: { createdAt: 'desc' }, select: { manifest: true } })
      if (manifestChanges.size || !latest) {
        await prisma.projectSnapshot.create({
          data: {
            projectId: input.tenantId,
            runId,
            label: manifestChanges.size ? `Workspace sync · ${manifestChanges.size} changed file(s)` : 'Workspace checkpoint',
            kind: 'auto',
            manifest,
          },
        })
      }
    }
    return { synced: textFiles.length, changed: manifestChanges.size, snapshotted: Boolean(manifestChanges.size && runId) }
  }

  async entitlement(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { owner: { select: { plan: true, email: true } } } })
    if (!tenant) return { active: false, reason: 'workspace_not_found' }
    if (!tenant.ownerId) return { active: false, reason: 'workspace_owner_missing' }
    const plan = tenant.owner?.plan ?? 'free'
    const account = await this.credits.ensureAccount(tenant.ownerId, plan)
    const engineApiKey = await provisionEngineKey(tenantId)
    const used = Math.max(0, account.windowAllowance - Math.min(account.balance, account.windowAllowance))
    const exhausted = account.balance <= 0
    return { active: tenant.status === 'active', reason: exhausted ? 'credits_exhausted' : tenant.status !== 'active' ? 'workspace_inactive' : undefined, tenantId, creditWorkspaceId: tenant.ownerId, userId: tenant.ownerId, coreWorkspaceKey: tenant.coreWorkspaceKey, storeSlug: tenant.slug, email: tenant.owner?.email ?? '', plan, engineApiKey, credits: { used, limit: account.windowAllowance, balance: account.balance, resetsAt: nextUtcCreditReset().toISOString() } }
  }

  async reportUsage(input: { tenantId: string; workspaceId?: string; userId: string; runId?: string; role?: string; tokens?: number; tokensIn?: number; tokensOut?: number; ok: boolean }) {
    const tenant = await prisma.tenant.findFirst({
      where: { id: input.tenantId, ownerId: input.userId },
      select: { id: true, ownerId: true, creditWorkspaceId: true, coreWorkspaceKey: true },
    })
    if (!tenant) throw new UnauthorizedException('Workspace ownership could not be verified.')
    // Meter actual model usage in weighted tokens. The account owns the budget,
    // so every project draws from the same user balance.
    if (input.ok) {
      const role = input.role && ['reasoning', 'default', 'fast', 'vision', 'image'].includes(input.role)
        ? input.role as 'reasoning' | 'default' | 'fast' | 'vision' | 'image'
        : 'default'
      const reportedWorkspaceIds = new Set([
        tenant.id,
        tenant.ownerId,
        tenant.creditWorkspaceId,
        tenant.coreWorkspaceKey,
      ].filter((value): value is string => Boolean(value)))
      if (input.workspaceId && !reportedWorkspaceIds.has(input.workspaceId)) {
        throw new UnauthorizedException('The reported credit account does not match the authenticated user.')
      }
      await this.credits.commitUsage({
        userId: input.userId,
        projectId: tenant.id,
        runId: input.runId,
        role,
        tokensIn: Math.max(0, input.tokensIn ?? input.tokens ?? 0),
        tokensOut: Math.max(0, input.tokensOut ?? 0),
        reason: 'core_model_call',
      })
    }
    return { recorded: true }
  }
}

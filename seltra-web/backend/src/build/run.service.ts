//build/run.service.ts
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../db'
import { resolveUserIdFromAuthorization } from '../auth/resolve-user'
import { Prisma } from '@prisma/client'
import { Observable } from 'rxjs'

export type PersistedRunState = 'queued' | 'running' | 'waiting_for_user' | 'stopping' | 'stopped' | 'interrupted' | 'failed' | 'paused_no_credits' | 'completed'

type WorkflowPhase = 'planning' | 'awaiting_approval' | 'preparing' | 'building' | 'verifying' | 'ready' | 'failed'

function workflowPhase(type: string, phase: string | null): WorkflowPhase {
  if (type === 'run.failed' || phase === 'failed') return 'failed'
  if (type === 'run.summary' || type === 'preview.ready' || phase === 'ready') return 'ready'
  if (phase === 'planning' || phase === 'awaiting_approval' || phase === 'preparing' || phase === 'building' || phase === 'verifying') return phase
  if (type === 'run.completed') return 'verifying'
  if (type === 'blueprint.ready' || type === 'questionnaire.requested' || type === 'run.waiting_for_user') return 'awaiting_approval'
  if (type === 'blueprint.approved' || type === 'assets.planned' || type === 'asset.updated' || type === 'questionnaire.answered' || phase === 'preparing') return 'preparing'
  if (/preview\.|verify|step\.progress/.test(type) || phase === 'verify' || phase === 'verifying') return 'verifying'
  if (phase === 'build' || phase === 'building' || type.startsWith('run.')) return 'building'
  return 'planning'
}

function workflowEventType(type: string): string {
  if (type === 'phase.changed') return 'phase_changed'
  if (type === 'blueprint.ready' || type === 'blueprint.approved') return 'phase_changed'
  if (type === 'step.progress') return 'task_updated'
  if (type === 'assets.planned' || type === 'asset.updated' || type === 'asset.generated' || type === 'asset.failed') return 'asset_updated'
  if (/^preview\./.test(type)) return 'preview_state'
  if (type === 'run.failed') return 'error'
  if (type === 'run.summary') return 'message'
  if (type.startsWith('run.')) return 'phase_changed'
  return 'status'
}

function workflowPayload(type: string, payload: unknown): Record<string, unknown> {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  if (type === 'preview.ready') return { state: 'ready', reason: null }
  if (type === 'preview.restoring') return { state: 'restoring', reason: 'Preview is reconnecting.' }
  if (type === 'preview.failed') return { state: 'unavailable', reason: 'The preview could not start.' }
  if (type === 'assets.planned') return { slot: 'visuals', state: value.complete === true ? 'ready' : 'planned', url: null }
  if (type === 'asset.updated' || type === 'asset.generated' || type === 'asset.failed') {
    const validStates = new Set(['generating', 'generated', 'fallback', 'skipped', 'failed'])
    return {
      slot: typeof value.slot === 'string' ? value.slot.slice(0, 80) : 'asset',
      state: type === 'asset.generated' ? 'generated' : type === 'asset.failed' ? 'failed' : typeof value.state === 'string' && validStates.has(value.state) ? value.state : 'pending',
      url: typeof value.url === 'string' && /^(?:public)?\/assets\/[a-z0-9._/-]+$/i.test(value.url) ? value.url.slice(0, 240) : null,
      ...(typeof value.prompt === 'string' ? { prompt: value.prompt.slice(0, 4000) } : {}),
      ...(typeof value.error === 'string' ? { error: value.error.replace(/[\r\n]+/g, ' ').slice(0, 240) } : {}),
    }
  }
  if (type === 'run.failed') return { code: typeof value.code === 'string' ? value.code : 'BUILD_FAILED', user_message: 'The build could not be completed. Retry to continue.', retryable: true }
  if (type === 'run.summary') {
    const todos = Array.isArray(value.todos) ? value.todos : []
    const completed = todos.filter((todo) => todo && typeof todo === 'object' && (todo as Record<string, unknown>).status === 'completed').length
    const total = todos.length
    return { summary: typeof value.summary === 'string' ? value.summary : total ? `Build complete. ${completed} of ${total} steps are complete; the preview passed its HTTP 200 check.` : 'Build complete. The preview passed its HTTP 200 check.' }
  }
  if (type === 'step.progress') {
    const todos = Array.isArray(value.todos) ? value.todos.slice(0, 6).map((todo) => {
      if (!todo || typeof todo !== 'object') return null
      const task = todo as Record<string, unknown>
      return { id: task.id, title: task.content, state: task.status }
    }).filter(Boolean) : []
    return { tasks: todos }
  }
  if (type === 'status') {
    const text = typeof value.message === 'string' ? value.message : typeof value.status === 'string' ? value.status : ''
    return text ? { message: text.replace(/[\r\n]+/g, ' ').slice(0, 160) } : {}
  }
  return {}
}

@Injectable()
export class RunService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RunService.name)
  private reaperTimer?: NodeJS.Timeout
  private reaperRunning = false
  constructor(private readonly jwt: JwtService) {}

  onModuleInit() {
    void this.runReaperSafely()
    this.reaperTimer = setInterval(() => void this.runReaperSafely(), 10_000)
    this.reaperTimer.unref()
  }

  onModuleDestroy() {
    if (this.reaperTimer) clearInterval(this.reaperTimer)
  }

  private async ownerId(projectId: string, authorization?: string) {
    const userId = await resolveUserIdFromAuthorization(authorization, this.jwt)
    if (!userId) throw new ForbiddenException('Authentication is required.')
    const tenant = await prisma.tenant.findFirst({ where: { id: projectId, ownerId: userId }, select: { id: true } })
    if (!tenant) throw new ForbiddenException('You do not have access to this project.')
    return userId
  }

  async start(projectId: string, workspaceId: string | undefined, authorization: string | undefined, idempotencyKey?: string) {
    const userId = await this.ownerId(projectId, authorization)
    if (idempotencyKey) {
      const existing = await prisma.run.findUnique({ where: { idempotencyKey } })
      if (existing) {
        if (existing.projectId !== projectId || existing.userId !== userId) throw new ConflictException('This idempotency key is already assigned to another project run.')
        return existing
      }
    }
    const active = await prisma.run.findFirst({
      where: { projectId, state: { in: ['queued', 'running', 'waiting_for_user', 'stopping', 'paused_no_credits'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (active) return active
    try {
      return await prisma.run.create({ data: {
        projectId,
        workspaceId,
        userId,
        state: 'queued',
        idempotencyKey,
      } })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      if (idempotencyKey) {
        const existing = await prisma.run.findUnique({ where: { idempotencyKey } })
        if (existing) {
          if (existing.projectId !== projectId || existing.userId !== userId) throw new ConflictException('This idempotency key is already assigned to another project run.')
          return existing
        }
      }
      const racedActive = await prisma.run.findFirst({
        where: { projectId, state: { in: ['queued', 'running', 'waiting_for_user', 'stopping', 'paused_no_credits'] } },
        orderBy: { createdAt: 'desc' },
      })
      if (racedActive) return racedActive
      throw error
    }
  }

  async active(projectId: string, authorization?: string) {
    await this.ownerId(projectId, authorization)
    return prisma.run.findFirst({
      // Include completed runs so an older failed run cannot keep presenting
      // a resume action after a later build succeeded.
      where: { projectId, state: { in: ['queued', 'running', 'waiting_for_user', 'stopping', 'paused_no_credits', 'stopped', 'interrupted', 'failed', 'completed'] } },
      orderBy: { createdAt: 'desc' },
      include: { events: { orderBy: { seq: 'asc' }, take: 300 } },
    })
  }

  async snapshot(runId: string, authorization?: string) {
    const run = await prisma.run.findUnique({ where: { id: runId }, include: { events: { orderBy: { seq: 'asc' } } } })
    if (!run) throw new NotFoundException('Run not found.')
    await this.ownerId(run.projectId, authorization)
    return run
  }

  async append(runId: string, event: { type: string; phase?: string; agent?: string; payload: Record<string, unknown>; state?: PersistedRunState; eventKey?: string }, authorization?: string) {
    const run = await prisma.run.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException('Run not found.')
    await this.ownerId(run.projectId, authorization)
    if (event.type === 'run.heartbeat') {
      return prisma.run.update({ where: { id: runId }, data: { lastHeartbeatAt: new Date() } })
    }
    try {
    return await prisma.$transaction(async (tx) => {
      if (event.eventKey) {
        const existing = await tx.runEvent.findUnique({ where: { runId_eventKey: { runId, eventKey: event.eventKey } } })
        if (existing) return existing
      }
      const failures = event.type === 'run.completed' ? await this.completionFailures(tx, runId, run.projectId) : []
      const storedType = failures.length ? 'run.failed' : event.type
      const storedState = failures.length ? 'failed' : event.state
      const storedPayload = failures.length
        ? { code: 'COMPLETION_GATE_FAILED', message: 'Required build evidence is missing or failed.', evidenceFailures: failures }
        : event.payload
      const [sequence] = await tx.$queryRaw<Array<{ lastEventSeq: number }>>`UPDATE runs SET "lastEventSeq" = "lastEventSeq" + 1, "lastHeartbeatAt" = NOW(), "updatedAt" = NOW()${storedState ? Prisma.sql`, "state" = ${storedState}` : Prisma.empty}${event.phase ? Prisma.sql`, "phase" = ${event.phase}` : Prisma.empty}${storedType === 'run.completed' || storedType === 'run.failed' || storedType === 'run.stopped' ? Prisma.sql`, "endedAt" = NOW()` : Prisma.empty} WHERE id = ${runId} RETURNING "lastEventSeq"`
      if (!sequence) throw new NotFoundException('Run not found.')
      const seq = sequence.lastEventSeq
      const created = await tx.runEvent.create({ data: {
        runId,
        seq,
        eventKey: event.eventKey,
        type: storedType,
        phase: event.phase,
        agent: event.agent,
        payload: storedPayload as Prisma.InputJsonObject,
      } })
      if (event.type === 'file.written') {
        const path = event.payload.path
        const bytes = event.payload.bytes
        const sha256 = event.payload.sha256
        if (typeof path !== 'string' || !path.trim() || path.startsWith('/') || path.split(/[\\/]/).includes('..') || !Number.isSafeInteger(bytes) || (bytes as number) < 0 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
          throw new ConflictException('File-write evidence is invalid.')
        }
        const coreAppId = Number(event.payload.appId)
        const app = Number.isSafeInteger(coreAppId) && coreAppId > 0
          ? await tx.tenantApp.findUnique({ where: { tenantId_coreAppId: { tenantId: run.projectId, coreAppId } }, select: { corePath: true } })
          : null
        const appRoot = app?.corePath?.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
        const filePath = [appRoot, path.replaceAll('\\', '/').replace(/^\/+/, '')].filter(Boolean).join('/')
        await tx.projectFile.upsert({
          where: { projectId_path: { projectId: run.projectId, path: filePath } },
          update: { contentHash: sha256.toLowerCase(), size: bytes as number, lastRunId: runId },
          create: { projectId: run.projectId, path: filePath, contentHash: sha256.toLowerCase(), size: bytes as number, lastRunId: runId },
        })
      }
      if ((event.type === 'asset.updated' || event.type === 'asset.generated' || event.type === 'asset.failed') && typeof event.payload.slot === 'string') {
        const slot = event.payload.slot.slice(0, 80)
        const appId = Number(event.payload.appId)
        const state = event.type === 'asset.generated' ? 'generated' : event.type === 'asset.failed' ? 'failed' : typeof event.payload.state === 'string' ? event.payload.state.slice(0, 32) : 'pending'
        const storageRef = Number.isSafeInteger(appId) && appId > 0 ? `core:${appId}:${slot}` : `run:${runId}:${slot}`
        const assetData = {
          kind: 'generated_image',
          slot,
          status: state,
          sourceUrl: typeof event.payload.url === 'string' ? event.payload.url.slice(0, 500) : null,
          error: typeof event.payload.error === 'string' ? event.payload.error.slice(0, 1000) : null,
          storageRef,
        }
        const asset = await tx.projectAsset.findFirst({ where: { projectId: run.projectId, storageRef }, select: { id: true } })
        if (asset) await tx.projectAsset.update({ where: { id: asset.id }, data: assetData })
        else await tx.projectAsset.create({ data: { projectId: run.projectId, ...assetData } })
      }
      if (storedType === 'run.failed') {
        await tx.tenantApp.updateMany({
          where: { tenantId: run.projectId, lastRunId: runId },
          data: {
            status: 'failed',
            errorCode: typeof storedPayload.code === 'string' ? storedPayload.code : 'BUILD_FAILED',
            errorDetail: typeof storedPayload.message === 'string' ? storedPayload.message : 'The build failed.',
          },
        })
      }
      if (storedType === 'run.completed') {
        await this.createWorkspaceSnapshot(tx, run.projectId, runId, 'final')
        const summarySeq = seq + 1
        await tx.runEvent.create({
          data: {
            runId,
            seq: summarySeq,
            type: 'run.summary',
            phase: 'ready',
            agent: 'supervisor',
            payload: { summary: 'Build completed: production build, browser QA, workspace manifest, and preview readiness were verified.' },
          },
        })
        await tx.run.update({ where: { id: runId }, data: { lastEventSeq: summarySeq } })
      }
      return created
    })
    } catch (error) {
      if (event.eventKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.runEvent.findUnique({ where: { runId_eventKey: { runId, eventKey: event.eventKey } } })
        if (existing) return existing
      }
      throw error
    }
  }

  async appendInternal(runId: string, event: { type: string; phase?: string; agent?: string; payload: Record<string, unknown>; state?: PersistedRunState; eventKey?: string }) {
    const run = await prisma.run.findUnique({ where: { id: runId } })
    if (!run) return null
    try {
    return await prisma.$transaction(async (tx) => {
      if (event.eventKey) {
        const existing = await tx.runEvent.findUnique({ where: { runId_eventKey: { runId, eventKey: event.eventKey } } })
        if (existing) return existing
      }
      const failures = event.type === 'run.completed' ? await this.completionFailures(tx, runId, run.projectId) : []
      const storedType = failures.length ? 'run.failed' : event.type
      const storedState = failures.length ? 'failed' : event.state
      const storedPayload = failures.length
        ? { code: 'COMPLETION_GATE_FAILED', message: 'Required build evidence is missing or failed.', evidenceFailures: failures }
        : event.payload
      const updated = await tx.run.update({
        where: { id: runId },
        data: {
          lastEventSeq: { increment: 1 },
          lastHeartbeatAt: new Date(),
          ...(storedState ? { state: storedState } : {}),
          ...(event.phase ? { phase: event.phase } : {}),
          ...(storedType === 'run.completed' || storedType === 'run.failed' || storedType === 'run.stopped' ? { endedAt: new Date() } : {}),
        },
      })
      await tx.runEvent.create({
        data: {
          runId,
          seq: updated.lastEventSeq,
          eventKey: event.eventKey,
          type: storedType,
          phase: event.phase,
          agent: event.agent,
          payload: storedPayload as Prisma.InputJsonObject,
        },
      })
      if (storedType === 'run.failed') {
        await tx.tenantApp.updateMany({
          where: { tenantId: run.projectId, lastRunId: runId },
          data: {
            status: 'failed',
            errorCode: typeof storedPayload.code === 'string' ? storedPayload.code : 'BUILD_FAILED',
            errorDetail: typeof storedPayload.message === 'string' ? storedPayload.message : 'The build failed.',
          },
        })
      }
      return tx.runEvent.findUniqueOrThrow({ where: { runId_seq: { runId, seq: updated.lastEventSeq } } })
    })
    } catch (error) {
      if (event.eventKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.runEvent.findUnique({ where: { runId_eventKey: { runId, eventKey: event.eventKey } } })
        if (existing) return existing
      }
      throw error
    }
  }

  private async completionFailures(tx: Prisma.TransactionClient, runId: string, projectId: string): Promise<string[]> {
    const [events, apps, fileCount, assets] = await Promise.all([
      tx.runEvent.findMany({ where: { runId }, select: { type: true, payload: true } }),
      tx.tenantApp.findMany({ where: { tenantId: projectId, lastRunId: runId }, select: { status: true, previewUrl: true } }),
      tx.projectFile.count({ where: { projectId, lastRunId: runId } }),
      tx.projectAsset.findMany({ where: { projectId, kind: 'generated_image', status: 'generated' }, select: { sourceUrl: true } }),
    ])
    const payload = (type: string) => {
      const event = events.find((item) => item.type === type)
      return event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown>
        : null
    }
    const build = payload('build.result')
    const qa = payload('browser.qa')
    const manifest = payload('manifest.verified')
    const preview = payload('preview.ready')
    const app = apps.find((item) => item.status === 'preview_ready' && typeof item.previewUrl === 'string')
    const failures: string[] = []
    if (build?.executed !== true || build.exitCode !== 0) failures.push('build.result must record an executed build with exitCode 0')
    if (!qa || !Array.isArray(qa.consoleErrors) || qa.consoleErrors.length !== 0 || !Array.isArray(qa.failedRequests) || qa.failedRequests.length !== 0 || typeof qa.screenshotPath !== 'string' || typeof qa.screenshotBytes !== 'number' || !Number.isSafeInteger(qa.screenshotBytes) || qa.screenshotBytes <= 0 || typeof qa.screenshotSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(qa.screenshotSha256)) failures.push('browser.qa must record a clean browser result and a saved screenshot')
    if (manifest?.verified !== true || manifest.pagesRouted !== true || manifest.assetsVerified !== true || manifest.packageScriptsValid !== true || !Array.isArray(manifest.mismatches) || manifest.mismatches.length !== 0) failures.push('manifest.verified must confirm routes, referenced assets, package scripts, and a clean workspace diff')
    if (fileCount === 0) failures.push('the run has no persisted file manifest rows')
    if (assets.some((asset) => typeof asset.sourceUrl !== 'string' || !asset.sourceUrl)) failures.push('a generated asset is missing its URL')
    if (!preview || preview.status !== 200 || typeof preview.previewUrl !== 'string' || !preview.previewUrl) failures.push('preview.ready must record HTTP 200 and a preview URL')
    if (!app || !app.previewUrl || /[?&](?:preview_)?token=/i.test(app.previewUrl)) failures.push('TenantApp must be preview_ready with a canonical token-free previewUrl')
    return failures
  }

  async stop(runId: string, authorization?: string) {
    const run = await prisma.run.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException('Run not found.')
    await this.ownerId(run.projectId, authorization)
    return prisma.$transaction(async (tx) => {
      const filesWritten = await tx.projectFile.count({ where: { projectId: run.projectId, lastRunId: runId } })
      const checkpoint = { ...(run.checkpoint && typeof run.checkpoint === 'object' ? run.checkpoint as Record<string, unknown> : {}), stoppedAt: new Date().toISOString(), filesWritten }
      const stopped = await tx.run.update({
        where: { id: runId },
        data: { state: 'stopped', endedAt: new Date(), phase: run.phase, checkpoint },
      })
      const seq = stopped.lastEventSeq + 1
      await tx.runEvent.create({
        data: {
          runId,
          seq,
          type: 'run.stopped',
          phase: run.phase,
          payload: { reason: 'user_stop', filesWritten },
        },
      })
      await this.createWorkspaceSnapshot(tx, run.projectId, runId, 'stopped')
      await tx.run.update({ where: { id: runId }, data: { lastEventSeq: seq } })
      return stopped
    })
  }

  async continueRun(runId: string, authorization?: string) {
    const previous = await prisma.run.findUnique({ where: { id: runId } })
    if (!previous) throw new NotFoundException('Run not found.')
    await this.ownerId(previous.projectId, authorization)
    const existing = await prisma.run.findFirst({
      where: { resumesRunId: previous.id, state: { in: ['queued', 'running', 'waiting_for_user', 'stopping', 'paused_no_credits'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return existing
    let mappedWorkspaceId: string | null = null
    try {
      const workspaceMapping = await prisma.$queryRaw<Array<{ creditWorkspaceId: string | null }>>`
        SELECT "creditWorkspaceId" FROM "Tenant" WHERE "id" = ${previous.projectId} LIMIT 1
      `
      mappedWorkspaceId = workspaceMapping[0]?.creditWorkspaceId ?? null
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code !== '42703') throw error
    }
    return prisma.run.create({ data: {
      projectId: previous.projectId,
      workspaceId: mappedWorkspaceId ?? previous.workspaceId,
      userId: previous.userId,
      state: 'queued',
      ...(previous.checkpoint !== null ? { checkpoint: previous.checkpoint as Prisma.InputJsonValue } : {}),
      resumesRunId: previous.id,
    } })
  }

  async reaper() {
    // Keep the sweep bounded. A burst of interactive transactions can exhaust
    // Prisma's pool and used to take down the whole API process.
    // Browser timers can be throttled during tab suspension or a brief API/Core
    // reconnect. Give the dashboard enough time to reattach before declaring
    // the worker lost. Runs waiting for a person have no worker lease to reap.
    // Core may be waiting on a slow model/provider or recovering a websocket.
    // Keep a generous floor so a short regional/network interruption does not
    // mark a live build as lost before the dashboard can reconnect.
    const configuredTtl = Number(process.env.RUN_LEASE_TTL_SECONDS ?? 900)
    const ttlSeconds = Number.isFinite(configuredTtl) ? Math.max(900, configuredTtl) : 900
    const cutoff = new Date(Date.now() - ttlSeconds * 1000)
    const stale = await prisma.run.findMany({
      where: { state: { in: ['queued', 'running', 'stopping'] }, lastHeartbeatAt: { lt: cutoff } },
      orderBy: { lastHeartbeatAt: 'asc' },
      take: 50,
    })
    let reaped = 0
    for (const run of stale) {
      const claimed = await prisma.$transaction(async (tx) => {
        // Re-check in the transaction so a concurrent heartbeat or another API
        // instance's reaper cannot interrupt a live run or emit duplicate events.
        const result = await tx.run.updateMany({
          where: { id: run.id, state: { in: ['queued', 'running', 'stopping'] }, lastHeartbeatAt: { lt: cutoff } },
          data: { state: 'interrupted', endedAt: new Date(), error: { code: 'LEASE_EXPIRED', reason: 'Worker lease expired; checkpoint preserved.' } },
        })
        if (result.count === 0) return false
        const interrupted = await tx.run.update({ where: { id: run.id }, data: { lastEventSeq: { increment: 1 } } })
        await tx.runEvent.create({ data: {
          runId: run.id,
          seq: interrupted.lastEventSeq,
          type: 'run.interrupted',
          phase: run.phase,
          payload: { reason: 'lease_expired', ttlSeconds },
        } })
        await this.createWorkspaceSnapshot(tx, run.projectId, run.id, 'interrupted')
        return true
      })
      if (claimed) reaped += 1
    }
    return reaped
  }

  private async runReaperSafely() {
    if (this.reaperRunning) return
    this.reaperRunning = true
    try {
      const count = await this.reaper()
      if (count > 0) this.logger.warn(`Marked ${count} stale run(s) interrupted.`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.logger.error(`Run lease sweep failed; API remains available: ${detail}`)
    } finally {
      this.reaperRunning = false
    }
  }

  stream(runId: string, authorization: string | undefined, after: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      let cursor = after
      let closed = false
      let pulse = 0
      const poll = async () => {
        if (closed) return
        pulse += 1
        try {
          if (cursor === after && pulse === 1) {
            await this.ownerIdForRun(runId, authorization)
          }
          const run = await prisma.run.findUnique({
            where: { id: runId },
            include: { events: { where: { seq: { gt: cursor } }, orderBy: { seq: 'asc' } } },
          })
          if (!run) {
            observer.error(new NotFoundException('Run not found.'))
            return
          }
          for (const event of run.events) {
            cursor = event.seq
            const type = workflowEventType(event.type)
            const phase = workflowPhase(event.type, event.phase)
            observer.next({
              id: String(event.seq),
              type: 'run-event',
              data: {
                runId,
                seq: event.seq,
                ts: event.ts.toISOString(),
                phase,
                type,
                actor: event.agent === 'planner' || event.agent === 'builder' ? event.agent : 'supervisor',
                payload: workflowPayload(event.type, event.payload),
              },
            })
          }
          if (pulse % 10 === 0) observer.next({ type: 'heartbeat', data: { ts: new Date().toISOString(), cursor } })
          if (run.state === 'completed' || run.state === 'failed' || run.state === 'stopped') {
            observer.complete()
          }
        } catch (error) {
          observer.error(error)
        }
      }
      void poll()
      const timer = setInterval(() => void poll(), 1_000)
      return () => {
        closed = true
        clearInterval(timer)
      }
    })
  }

  private async ownerIdForRun(runId: string, authorization?: string) {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { projectId: true } })
    if (!run) throw new NotFoundException('Run not found.')
    await this.ownerId(run.projectId, authorization)
  }

  private async createWorkspaceSnapshot(tx: Prisma.TransactionClient, projectId: string, runId: string, kind: 'final' | 'stopped' | 'interrupted') {
    const files = await tx.projectFile.findMany({ where: { projectId }, select: { path: true, contentHash: true } })
    const manifest = Object.fromEntries(files.map((file) => [file.path, file.contentHash]))
    await tx.projectSnapshot.create({
      data: {
        projectId,
        runId,
        label: kind === 'final' ? 'Build completed' : kind === 'stopped' ? 'Build stopped' : 'Build interrupted',
        kind,
        manifest,
      },
    })
  }

  async files(projectId: string, authorization?: string) {
    await this.ownerId(projectId, authorization)
    return prisma.projectFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
  }

  async snapshots(projectId: string, authorization?: string) {
    await this.ownerId(projectId, authorization)
    return prisma.projectSnapshot.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } })
  }

  async restore(projectId: string, authorization?: string) {
    await this.ownerId(projectId, authorization)
    const snapshot = await prisma.projectSnapshot.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } })
    const files = await prisma.projectFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
    return { snapshot, files }
  }
}

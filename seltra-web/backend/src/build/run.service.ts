import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../db'
import { resolveUserIdFromAuthorization } from '../auth/resolve-user'
import { Prisma } from '@prisma/client'
import { Observable } from 'rxjs'

export type PersistedRunState = 'queued' | 'running' | 'waiting_for_user' | 'stopping' | 'stopped' | 'interrupted' | 'failed' | 'paused_no_credits' | 'completed'

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

  async append(runId: string, event: { type: string; phase?: string; agent?: string; payload: Record<string, unknown>; state?: PersistedRunState }, authorization?: string) {
    const run = await prisma.run.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException('Run not found.')
    await this.ownerId(run.projectId, authorization)
    if (event.type === 'run.heartbeat') {
      return prisma.run.update({ where: { id: runId }, data: { lastHeartbeatAt: new Date() } })
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.run.update({
        where: { id: runId },
        data: {
          lastEventSeq: { increment: 1 },
          lastHeartbeatAt: new Date(),
          ...(event.state ? { state: event.state } : {}),
          ...(event.phase ? { phase: event.phase } : {}),
          ...(event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.stopped' ? { endedAt: new Date() } : {}),
        },
      })
      const seq = updated.lastEventSeq
      await tx.runEvent.create({ data: {
        runId,
        seq,
        type: event.type,
        phase: event.phase,
        agent: event.agent,
        payload: event.payload as Prisma.InputJsonObject,
      } })
      if (event.type === 'run.completed') await this.createWorkspaceSnapshot(tx, run.projectId, runId, 'final')
      return updated
    })
  }

  async appendInternal(runId: string, event: { type: string; phase?: string; agent?: string; payload: Record<string, unknown>; state?: PersistedRunState }) {
    const run = await prisma.run.findUnique({ where: { id: runId } })
    if (!run) return null
    return prisma.$transaction(async (tx) => {
      const updated = await tx.run.update({
        where: { id: runId },
        data: {
          lastEventSeq: { increment: 1 },
          lastHeartbeatAt: new Date(),
          ...(event.state ? { state: event.state } : {}),
          ...(event.phase ? { phase: event.phase } : {}),
          ...(event.state ? { state: event.state } : {}),
          ...(event.phase ? { phase: event.phase } : {}),
          ...(event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.stopped' ? { endedAt: new Date() } : {}),
        },
      })
      await tx.runEvent.create({
        data: {
          runId,
          seq: updated.lastEventSeq,
          type: event.type,
          phase: event.phase,
          agent: event.agent,
          payload: event.payload as Prisma.InputJsonObject,
        },
      })
      return updated
    })
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
            observer.next({
              id: String(event.seq),
              type: event.type === 'error' ? 'run-error' : 'run-event',
              data: { seq: event.seq, ts: event.ts, type: event.type, phase: event.phase, agent: event.agent, payload: event.payload },
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

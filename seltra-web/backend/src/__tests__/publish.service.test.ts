import { ConflictException, HttpException, NotFoundException } from '@nestjs/common'
import { DeploymentKind, DeploymentStatus, PublishDeployMode, PublishPublicationStatus } from '@prisma/client'
import { prisma } from '../db'
import { LegacyStoreGuard } from '../publish/legacy-store.guard'
import { PublishService } from '../publish/publish.service'

jest.mock('../db', () => ({
  prisma: {
    tenant: { findFirst: jest.fn(), findUnique: jest.fn() },
    tenantApp: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    deployment: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    publishEvent: { create: jest.fn(), findMany: jest.fn() },
    publishProviderEvent: { findUnique: jest.fn(), upsert: jest.fn() },
    workspacePersistenceOperation: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const db = prisma as any
const tenant = { id: 'tenant-1', ownerId: 'user-1', coreWorkspaceKey: 'workspace-1', slug: 'merchant-one', status: 'active', storeUrl: 'merchant-one.seltra.co', storefrontCode: '<html/>', storefrontGeneratedAt: new Date() }
const app = { id: 'tenant-app-1', tenantId: tenant.id, coreAppId: 7, tenant, activePublishId: null, liveDeploymentId: null, githubRepoVisibility: null, githubRepoId: null, githubRepoFullName: null, vercelProjectId: null, vercelProjectName: null, publicationStatus: 'UNPUBLISHED', workspaceStatus: 'ACTIVE', persistenceStatus: 'OK' }
const beginInput = { userId: 'user-1', workspaceKey: 'workspace-1', coreAppId: 7, idempotencyKey: 'request-1' }

describe('PublishService', () => {
  let service: PublishService
  let legacy: LegacyStoreGuard

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.PUBLISH_ENABLED = 'true'
    process.env.DEPLOY_MODE = 'hobby'
    delete process.env.PUBLISH_PROTECTED_SLUGS
    process.env.PUBLISH_MAX_PER_HOUR = '10'
    process.env.PUBLISH_MAX_PER_DAY = '30'
    legacy = new LegacyStoreGuard()
    service = new PublishService(legacy)
    db.tenant.findFirst.mockResolvedValue(tenant)
    db.tenantApp.findUnique.mockResolvedValue(app)
    db.deployment.findUnique.mockResolvedValue(null)
    db.deployment.findFirst.mockResolvedValue(null)
    db.deployment.count.mockResolvedValue(0)
    db.tenantApp.updateMany.mockResolvedValue({ count: 1 })
    db.deployment.create.mockResolvedValue({ id: 'deployment-1', slug: tenant.slug, previousDeploymentId: null })
    db.$transaction.mockImplementation(async (operation: any) => {
      if (Array.isArray(operation)) return Promise.all(operation)
      return operation({
        deployment: { create: db.deployment.create, update: db.deployment.update, updateMany: db.deployment.updateMany },
        publishEvent: { create: db.publishEvent.create },
        tenantApp: { update: db.tenantApp.update, updateMany: db.tenantApp.updateMany },
      })
    })
  })

  afterEach(() => {
    delete process.env.PUBLISH_ENABLED
    delete process.env.DEPLOY_MODE
    delete process.env.PUBLISH_PROTECTED_SLUGS
    delete process.env.PUBLISH_MAX_PER_HOUR
    delete process.env.PUBLISH_MAX_PER_DAY
  })

  it('returns 404 while publishing is disabled', async () => {
    process.env.PUBLISH_ENABLED = 'false'
    await expect(service.begin(beginInput)).rejects.toBeInstanceOf(NotFoundException)
    expect(db.tenant.findFirst).not.toHaveBeenCalled()
  })

  it('rejects a non-owner before looking up an app', async () => {
    db.tenant.findFirst.mockResolvedValue(null)
    await expect(service.begin(beginInput)).rejects.toMatchObject({ status: 403 })
    expect(db.tenantApp.findUnique).not.toHaveBeenCalled()
  })

  it('returns a protected slug as 422', async () => {
    process.env.PUBLISH_PROTECTED_SLUGS = 'merchant-one,other'
    await expect(service.begin(beginInput)).rejects.toMatchObject({ status: 422, response: expect.objectContaining({ code: 'SLUG_PROTECTED' }) })
  })

  it('rejects reserved route slugs as 422', async () => {
    db.tenant.findFirst.mockResolvedValue({ ...tenant, slug: 'api' })
    await expect(service.begin(beginInput)).rejects.toMatchObject({ status: 422, response: expect.objectContaining({ code: 'SLUG_PROTECTED' }) })
    expect(db.deployment.create).not.toHaveBeenCalled()
  })

  it('fails closed for an unknown V4 guard in team mode', async () => {
    process.env.DEPLOY_MODE = 'team'
    await expect(service.begin(beginInput)).rejects.toMatchObject({ status: 422, response: expect.objectContaining({ code: 'V4_GUARD_NOT_CONFIGURED' }) })
  })

  it('requires explicit confirmation when the legacy V4 store is live', async () => {
    jest.spyOn(legacy, 'isLive').mockReturnValue('LIVE')
    await expect(service.begin(beginInput)).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'LEGACY_STORE_LIVE_CONFIRMATION_REQUIRED' }) })
    expect(db.deployment.create).not.toHaveBeenCalled()
  })

  it('acquires an edit lease for the owner session', async () => {
    db.tenantApp.findFirst.mockResolvedValue(app)
    db.tenantApp.updateMany.mockResolvedValue({ count: 1 })
    const result = await service.acquireEditLease({ userId: 'user-1', workspaceKey: 'workspace-1', coreAppId: 7, holderSessionId: 'session-1' })
    expect(result.acquired).toBe(true)
    expect(db.tenantApp.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: app.id, OR: expect.arrayContaining([{ editLeaseHolderSessionId: 'session-1' }]) }),
      data: expect.objectContaining({ editLeaseHolderSessionId: 'session-1' }),
    }))
  })

  it('rejects an edit lease held by another session', async () => {
    db.tenantApp.findFirst.mockResolvedValue(app)
    db.tenantApp.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.acquireEditLease({ userId: 'user-1', workspaceKey: 'workspace-1', coreAppId: 7, holderSessionId: 'session-2' }))
      .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'EDIT_LOCKED' }) })
  })

  it('returns the existing deployment for the same idempotency key', async () => {
    const existing = { id: 'deployment-existing', slug: tenant.slug, previousDeploymentId: null }
    db.deployment.findUnique.mockResolvedValueOnce(existing)
    const result = await service.begin(beginInput)
    expect(result.deploymentId).toBe(existing.id)
    expect(result.reused).toBe(true)
    expect(db.deployment.create).not.toHaveBeenCalled()
  })

  it('claims the oldest queued deployment with an expiring unique lease', async () => {
    const queued = { id: 'deployment-queue-1', status: DeploymentStatus.QUEUED, createdAt: new Date(), finishedAt: null }
    const job = { ...queued, tenantApp: { coreAppId: 7, tenant: { id: tenant.id, ownerId: tenant.ownerId, coreWorkspaceKey: tenant.coreWorkspaceKey, slug: tenant.slug, owner: { email: 'owner@example.test', plan: 'free' } } } }
    const count = jest.fn().mockResolvedValue(0)
    const findFirst = jest.fn().mockResolvedValue(queued)
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const findUnique = jest.fn().mockResolvedValue(job)
    db.$transaction.mockImplementationOnce((operation: any) => operation({ deployment: { count, findFirst, updateMany, findUnique } }))
    const result = await service.claimNext({ workerId: 'core-a', leaseSeconds: 120, maxConcurrent: 2 })
    expect(result.job).toMatchObject({ id: queued.id, leaseToken: expect.any(String) })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: queued.id }), data: expect.objectContaining({ queueLeaseOwner: 'core-a', attemptCount: { increment: 1 } }) }))
  })

  it('does not exceed the global queue lease concurrency limit', async () => {
    const findFirst = jest.fn()
    db.$transaction.mockImplementationOnce((operation: any) => operation({ deployment: { count: jest.fn().mockResolvedValue(2), findFirst } }))
    await expect(service.claimNext({ workerId: 'core-b', leaseSeconds: 120, maxConcurrent: 2 })).resolves.toEqual({ job: null })
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('rejects progress from a worker after its queue lease expires or changes owner', async () => {
    db.deployment.findUnique.mockResolvedValue({ id: 'deployment-1', lastEventSeq: 1, status: DeploymentStatus.QUEUED, finishedAt: null, queueLeaseOwner: 'core-b', queueLeaseToken: 'new-lease', queueLeaseExpiresAt: new Date(Date.now() + 60_000) })
    await expect(service.progress({ deploymentId: 'deployment-1', seq: 2, status: DeploymentStatus.BUILDING, workerId: 'core-a', leaseToken: 'old-lease' }))
      .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'PUBLISH_LEASE_LOST' }) })
  })

  it('records unexpected production deployments idempotently', async () => {
    db.publishProviderEvent.findUnique.mockResolvedValue(null)
    db.publishProviderEvent.upsert.mockResolvedValue({ id: 'provider-event-1' })
    await expect(service.recordUnexpectedProviderDeployment({ projectId: 'prj_1', deploymentId: 'dpl_12345678', readyState: 'READY', url: 'app.vercel.app', sourceSha: 'a'.repeat(40) }))
      .resolves.toEqual({ firstSeen: true, reconciliationStatus: 'DETECTED' })
    expect(db.publishProviderEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ eventType: 'UNEXPECTED_PRODUCTION_DEPLOYMENT' }) }))
  })

  it('reserves Vercel build budget once under the current queue lease', async () => {
    const lease = { queueLeaseOwner: 'core-a', queueLeaseToken: 'lease-a', queueLeaseExpiresAt: new Date(Date.now() + 60_000), finishedAt: null, vercelRequestedAt: null }
    const count = jest.fn().mockResolvedValue(0)
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    db.$transaction.mockImplementationOnce((operation: any) => operation({ deployment: { findUnique: jest.fn().mockResolvedValue(lease), count, updateMany } }))
    await expect(service.reserveVercelBudget({ deploymentId: 'deployment-1', workerId: 'core-a', leaseToken: 'lease-a' })).resolves.toMatchObject({ allowed: true, reserved: true })
    expect(count).toHaveBeenCalledTimes(3)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vercelRequestedAt: expect.any(Date) }) }))
  })

  it('waits when the global Vercel rate budget is exhausted', async () => {
    const lease = { queueLeaseOwner: 'core-a', queueLeaseToken: 'lease-a', queueLeaseExpiresAt: new Date(Date.now() + 60_000), finishedAt: null, vercelRequestedAt: null }
    const count = jest.fn().mockResolvedValueOnce(300).mockResolvedValue(0)
    const updateMany = jest.fn()
    db.$transaction.mockImplementationOnce((operation: any) => operation({ deployment: { findUnique: jest.fn().mockResolvedValue(lease), count, updateMany } }))
    await expect(service.reserveVercelBudget({ deploymentId: 'deployment-1', workerId: 'core-a', leaseToken: 'lease-a' })).resolves.toMatchObject({ allowed: false, retryAfterSeconds: 60 })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('returns the active id for an in-flight deployment', async () => {
    db.tenantApp.findUnique.mockResolvedValue({ ...app, activePublishId: 'active-deployment' })
    db.deployment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'active-deployment', createdAt: new Date(), finishedAt: null })
    await expect(service.begin(beginInput)).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'PUBLISH_IN_PROGRESS', deploymentId: 'active-deployment' }) })
  })

  it('enforces the hourly tenant quota', async () => {
    process.env.PUBLISH_MAX_PER_HOUR = '1'
    db.deployment.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    await expect(service.begin(beginInput)).rejects.toMatchObject({ status: 429, response: expect.objectContaining({ code: 'QUOTA_EXCEEDED' }) })
    expect(db.deployment.create).not.toHaveBeenCalled()
  })

  it('records a queued deployment with deploy mode and private repo visibility', async () => {
    const result = await service.begin(beginInput)
    expect(result.deploymentId).toBe('deployment-1')
    expect(db.deployment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: tenant.id,
      tenantAppId: app.id,
      status: DeploymentStatus.QUEUED,
      deployMode: PublishDeployMode.hobby,
      repoVisibility: 'public',
      events: { create: { seq: 1, status: DeploymentStatus.QUEUED, message: 'Publish queued.' } },
    }) }))
  })

  it('records public repository metadata in hobby mode', async () => {
    db.tenantApp.findFirst.mockResolvedValue(app)
    await service.repositorySaved({ userId: 'user-1', workspaceKey: 'workspace-1', coreAppId: 7, githubRepoId: 'repo-1', githubRepoFullName: 'Seltra-Cloud/app-1', githubRepoVisibility: 'public' })
    expect(db.tenantApp.update).toHaveBeenCalledWith({ where: { id: app.id }, data: expect.objectContaining({ githubRepoVisibility: 'public' }) })
  })

  it('keeps team repository metadata private', async () => {
    process.env.DEPLOY_MODE = 'team'
    db.tenantApp.findFirst.mockResolvedValue(app)
    await expect(service.repositorySaved({ userId: 'user-1', workspaceKey: 'workspace-1', coreAppId: 7, githubRepoId: 'repo-1', githubRepoFullName: 'Seltra-Cloud/app-1', githubRepoVisibility: 'public' }))
      .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'REPOSITORY_VISIBILITY_REQUIRED' }) })
    expect(db.tenantApp.update).not.toHaveBeenCalled()
  })

  it('requires verified source and snapshot references before SAFE_TO_DESTROY', async () => {
    const operation = { id: 'op-row', operationId: 'op-1', workspaceKey: 'workspace-1', status: 'PERSISTING', githubRevisions: null, snapshotVersion: null, bundleKey: null, bundleSha256: null }
    db.workspacePersistenceOperation.findUnique.mockResolvedValue(operation)
    await expect(service.persistenceTransition({ userId: 'user-1', workspaceKey: 'workspace-1', operationId: 'op-1', status: 'SAFE_TO_DESTROY' })).rejects.toBeInstanceOf(ConflictException)
    db.workspacePersistenceOperation.findUnique.mockResolvedValue({ ...operation, status: 'SNAPSHOT_VERIFIED', githubRevisions: { '7': 'a'.repeat(40) }, snapshotVersion: 'v1', manifestKey: 'workspaces/k/snapshots/v1.json', bundleKey: 'workspaces/k/snapshots/v1.tgz', bundleSha256: 'b'.repeat(64) })
    await service.persistenceTransition({ userId: 'user-1', workspaceKey: 'workspace-1', operationId: 'op-1', status: 'SAFE_TO_DESTROY' })
    expect(db.workspacePersistenceOperation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'op-row' }, data: expect.objectContaining({ status: 'SAFE_TO_DESTROY', completedAt: expect.any(Date) }) }))
  })

  it('marks stale active deployments timed out before creating a new one', async () => {
    const stale = { id: 'old-deployment', createdAt: new Date(Date.now() - 21 * 60_000), finishedAt: null }
    db.tenantApp.findUnique.mockResolvedValue({ ...app, activePublishId: stale.id })
    db.deployment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(stale)
    await service.begin(beginInput)
    expect(db.deployment.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: stale.id }, data: expect.objectContaining({ errorCode: 'TIMEOUT', status: DeploymentStatus.FAILED }) }))
  })

  it('treats a repeated progress sequence as idempotent and rejects regression', async () => {
    db.deployment.findUnique.mockResolvedValue({ id: 'deployment-1', status: DeploymentStatus.BUILDING, lastEventSeq: 3, finishedAt: null })
    await expect(service.progress({ deploymentId: 'deployment-1', seq: 3, status: DeploymentStatus.BUILDING })).resolves.toEqual({ ignored: true })
    await expect(service.progress({ deploymentId: 'deployment-1', seq: 4, status: DeploymentStatus.SAVING_SOURCE })).rejects.toMatchObject({ status: 409 })
    expect(db.publishEvent.create).not.toHaveBeenCalled()
  })

  it('accepts rollback only for a verified deployment of the same app', async () => {
    await expect(service.begin({ ...beginInput, kind: DeploymentKind.ROLLBACK, rollbackSourceId: 'invalid' })).rejects.toMatchObject({ status: 422, response: expect.objectContaining({ code: 'ROLLBACK_TARGET_INVALID' }) })
    expect(db.deployment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'invalid', tenantAppId: app.id, verifiedAt: { not: null } }) }))
  })

  it('finishes failed without changing live publication fields', async () => {
    db.deployment.findUnique.mockResolvedValue({ id: 'deployment-1', tenantAppId: app.id, finishedAt: null, tenantApp: app })
    await service.finish({ deploymentId: 'deployment-1', outcome: 'FAILED', errorCode: 'BUILD_FAILED' })
    expect(db.deployment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: DeploymentStatus.FAILED, errorCode: 'BUILD_FAILED' }) }))
    expect(db.tenantApp.update).not.toHaveBeenCalled()
    expect(db.tenantApp.updateMany).toHaveBeenCalledWith({ where: { id: app.id, activePublishId: 'deployment-1' }, data: { activePublishId: null } })
  })

  it('requires health verification before LIVE and then supersedes the previous live row', async () => {
    db.deployment.findUnique.mockResolvedValue({ id: 'deployment-2', tenantAppId: app.id, finishedAt: null, sourceCommitSha: 'sha2', vercelOrigin: 'deployment.vercel.app', verifiedAt: new Date(), previousDeploymentId: 'deployment-1', slug: tenant.slug, tenantApp: app })
    await service.finish({ deploymentId: 'deployment-2', outcome: 'LIVE' })
    expect(db.deployment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'deployment-1', tenantAppId: app.id, status: DeploymentStatus.LIVE }, data: { status: DeploymentStatus.SUPERSEDED } }))
    expect(db.tenantApp.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ liveDeploymentId: 'deployment-2', lastKnownGoodDeploymentId: 'deployment-2', lastCommitSha: 'sha2', publicationStatus: PublishPublicationStatus.PUBLISHED }) }))
  })
})

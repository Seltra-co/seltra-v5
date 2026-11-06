import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { ApiExcludeController } from '@nestjs/swagger'
import { BuilderService } from '../builder/builder.service'
import { CoreServiceGuard } from './core-service.guard'
import { PublishService } from '../publish/publish.service'
import { DeploymentKind, DeploymentStatus, PublishWorkspaceStatus } from '@prisma/client'

class CoreUsageDto {
  @IsString() tenantId!: string
  @IsString() workspaceId!: string
  @IsString() userId!: string
  @IsString() role!: string
  @IsString() model!: string
  @IsOptional() @IsInt() @Min(0) tokens?: number
  @IsOptional() @IsInt() @Min(0) tokensIn?: number
  @IsOptional() @IsInt() @Min(0) tokensOut?: number
  @IsBoolean() cached!: boolean
  @IsBoolean() ok!: boolean
  @IsString() runId!: string
}

class WsTicketDto {
  @IsString() ticket!: string
}

class PublishBeginDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
  @IsInt() @Min(1) coreAppId!: number
  @IsOptional() @IsEnum(DeploymentKind) kind?: DeploymentKind
  @IsOptional() @IsString() rollbackSourceId?: string
  @IsString() @MaxLength(200) idempotencyKey!: string
  @IsOptional() @IsBoolean() confirmReplaceLegacy?: boolean
}

class PublishActiveRunDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
}

class PublishQueueClaimDto {
  @IsString() workerId!: string
  @IsInt() @Min(30) leaseSeconds!: number
  @IsInt() @Min(1) maxConcurrent!: number
}

class PublishQueueLeaseDto {
  @IsString() deploymentId!: string
  @IsString() workerId!: string
  @IsString() leaseToken!: string
  @IsOptional() @IsInt() @Min(5) leaseSeconds?: number
  @IsOptional() @IsInt() @Min(5) retryAfterSeconds?: number
}

class PublishQueueBudgetDto {
  @IsString() deploymentId!: string
  @IsString() workerId!: string
  @IsString() leaseToken!: string
}

class UnexpectedProviderDeploymentDto {
  @IsString() projectId!: string
  @IsString() deploymentId!: string
  @IsOptional() @IsString() readyState?: string
  @IsOptional() @IsString() url?: string
  @IsOptional() @IsString() sourceSha?: string
  @IsOptional() @IsString() reconciliationStatus?: string
}

class PublishProjectDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
  @IsInt() @Min(1) coreAppId!: number
  @IsString() projectId!: string
  @IsString() projectName!: string
}

class PublishUserAppDto {
  @IsString() userId!: string
  @IsString() appId!: string
  @IsOptional() @IsInt() @Min(1) limit?: number
  @IsOptional() @IsString() cursor?: string
}

class PublishUserDeploymentDto {
  @IsString() userId!: string
  @IsString() deploymentId!: string
  @IsOptional() @IsInt() @Min(0) sinceSeq?: number
}

class PublishProgressDto {
  @IsString() deploymentId!: string
  @IsInt() @Min(1) seq!: number
  @IsEnum(DeploymentStatus) status!: DeploymentStatus
  @IsOptional() @IsString() @MaxLength(500) message?: string
  @IsOptional() @IsObject() patch?: Record<string, unknown>
  @IsOptional() @IsString() workerId?: string
  @IsOptional() @IsString() leaseToken?: string
}

class PublishFinishDto {
  @IsString() deploymentId!: string
  @IsIn(['LIVE', 'FAILED']) outcome!: 'LIVE' | 'FAILED'
  @IsOptional() @IsString() errorCode?: string
  @IsOptional() @IsString() errorMessage?: string
  @IsOptional() @IsString() buildLogTail?: string
  @IsOptional() @IsString() workerId?: string
  @IsOptional() @IsString() leaseToken?: string
}

class PublishUnpublishDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
  @IsInt() @Min(1) coreAppId!: number
  @IsString() @MaxLength(200) idempotencyKey!: string
}

class GithubPushResultDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
  @IsInt() @Min(1) coreAppId!: number
  @IsOptional() @IsString() sha?: string
  @IsIn(['COMPLETE', 'INTERRUPTED']) kind!: 'COMPLETE' | 'INTERRUPTED'
  @IsOptional() @IsString() error?: string
}

class PublishRepositoryDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
  @IsInt() @Min(1) coreAppId!: number
  @IsOptional() @IsString() githubRepoId?: string
  @IsOptional() @IsString() githubRepoFullName?: string
  @IsOptional() @IsIn(['public', 'private']) githubRepoVisibility?: 'public' | 'private'
  @IsOptional() @IsString() githubDefaultBranch?: string
}

class EditLeaseDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
  @IsInt() @Min(1) coreAppId!: number
  @IsString() @MaxLength(128) holderSessionId!: string
  @IsOptional() @IsInt() @Min(30) ttlSeconds?: number
}

class WorkspacePublishStateDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
  @IsInt() @Min(1) coreAppId!: number
  @IsEnum(PublishWorkspaceStatus) workspaceStatus!: PublishWorkspaceStatus
  @IsOptional() @IsDateString() snapshotAt?: string
}

class WorkspacePersistenceBeginDto {
  @IsString() userId!: string
  @IsString() workspaceKey!: string
  @IsString() @MaxLength(128) operationId!: string
  @IsString() @MaxLength(32) reason!: string
}

class WorkspacePersistenceLatestDto {
  @IsString() workspaceKey!: string
}

class WorkspacePersistenceTransitionDto extends WorkspacePersistenceBeginDto {
  @IsIn(['SOURCE_VERIFIED', 'SNAPSHOT_VERIFIED', 'SAFE_TO_DESTROY', 'DEGRADED']) status!: 'SOURCE_VERIFIED' | 'SNAPSHOT_VERIFIED' | 'SAFE_TO_DESTROY' | 'DEGRADED'
  @IsOptional() @IsObject() githubRevisions?: Record<string, string>
  @IsOptional() @IsString() snapshotVersion?: string
  @IsOptional() @IsString() manifestKey?: string
  @IsOptional() @IsString() bundleKey?: string
  @IsOptional() @IsString() bundleSha256?: string
  @IsOptional() @IsString() errorCode?: string
}

@ApiExcludeController()
@UseGuards(CoreServiceGuard)
@Controller('internal/core')
export class CoreInternalController {
  constructor(private readonly builder: BuilderService, private readonly publish: PublishService) {}

  @Get('entitlement/:tenantId')
  entitlement(@Param('tenantId') tenantId: string) {
    return this.builder.entitlement(tenantId)
  }

  @Post('usage')
  usage(@Body() body: CoreUsageDto) {
    return this.builder.reportUsage(body)
  }

  @Post('ws-ticket/redeem')
  redeemWsTicket(@Body() body: WsTicketDto) {
    return this.builder.redeemWsTicket(body.ticket)
  }

  @Post('publish/begin')
  publishBegin(@Body() body: PublishBeginDto) { return this.publish.begin(body) }

  @Post('publish/active-run')
  publishActiveRun(@Body() body: PublishActiveRunDto) { return this.publish.assertNoActiveRun(body) }

  @Post('publish/queue/claim')
  publishQueueClaim(@Body() body: PublishQueueClaimDto) { return this.publish.claimNext(body) }

  @Post('publish/queue/renew')
  publishQueueRenew(@Body() body: PublishQueueLeaseDto) { return this.publish.renewQueueLease({ ...body, leaseSeconds: body.leaseSeconds ?? 120 }) }

  @Post('publish/queue/release')
  publishQueueRelease(@Body() body: PublishQueueLeaseDto) { return this.publish.releaseQueueLease(body) }

  @Post('publish/queue/reserve-vercel')
  publishQueueReserveVercel(@Body() body: PublishQueueBudgetDto) { return this.publish.reserveVercelBudget(body) }

  @Post('publish/reconciliation/projects')
  publishReconciliationProjects() { return this.publish.reconciliationProjects() }

  @Post('publish/reconciliation/unexpected')
  publishUnexpectedDeployment(@Body() body: UnexpectedProviderDeploymentDto) { return this.publish.recordUnexpectedProviderDeployment(body) }

  @Post('publish/project')
  publishProject(@Body() body: PublishProjectDto) { return this.publish.saveProject(body) }

  @Post('publish/status')
  publishStatus(@Body() body: PublishUserAppDto) { return this.publish.status(body.userId, body.appId) }

  @Post('publish/history')
  publishHistory(@Body() body: PublishUserAppDto) { return this.publish.deployments(body.userId, body.appId, body.limit, body.cursor) }

  @Post('publish/deployment')
  publishDeployment(@Body() body: PublishUserDeploymentDto) { return this.publish.deployment(body.userId, body.deploymentId, body.sinceSeq) }

  @Post('publish/progress')
  publishProgress(@Body() body: PublishProgressDto) { return this.publish.progress(body) }

  @Post('publish/finish')
  publishFinish(@Body() body: PublishFinishDto) { return this.publish.finish(body) }

  @Post('publish/unpublish/begin')
  publishUnpublishBegin(@Body() body: PublishUnpublishDto) { return this.publish.beginUnpublish(body) }

  @Post('publish/unpublish/finish')
  publishUnpublishFinish(@Body() body: PublishUnpublishDto) { return this.publish.finishUnpublish(body) }

  @Post('github/push-result')
  githubPushResult(@Body() body: GithubPushResultDto) { return this.publish.pushResult(body) }

  @Post('publish/repository-info')
  publishRepositoryInfo(@Body() body: Pick<PublishRepositoryDto, 'userId' | 'workspaceKey' | 'coreAppId'>) { return this.publish.repositoryInfo(body) }

  @Post('publish/repository-saved')
  publishRepositorySaved(@Body() body: PublishRepositoryDto) {
    if (!body.githubRepoId || !body.githubRepoFullName || !body.githubRepoVisibility) throw new Error('Repository metadata is incomplete.')
    return this.publish.repositorySaved({ ...body, githubRepoId: body.githubRepoId, githubRepoFullName: body.githubRepoFullName, githubRepoVisibility: body.githubRepoVisibility })
  }

  @Post('publish/edit-lease/acquire')
  publishEditLeaseAcquire(@Body() body: EditLeaseDto) { return this.publish.acquireEditLease(body) }

  @Post('publish/edit-lease/renew')
  publishEditLeaseRenew(@Body() body: EditLeaseDto) { return this.publish.renewEditLease(body) }

  @Post('publish/edit-lease/release')
  publishEditLeaseRelease(@Body() body: EditLeaseDto) { return this.publish.releaseEditLease(body) }

  @Post('workspace/state')
  publishWorkspaceState(@Body() body: WorkspacePublishStateDto) { return this.publish.workspaceState(body) }

  @Post('workspace-persistence/begin')
  workspacePersistenceBegin(@Body() body: WorkspacePersistenceBeginDto) { return this.publish.persistenceBegin(body) }

  @Post('workspace-persistence/transition')
  workspacePersistenceTransition(@Body() body: WorkspacePersistenceTransitionDto) { return this.publish.persistenceTransition(body) }

  @Post('workspace-persistence/latest')
  workspacePersistenceLatest(@Body() body: WorkspacePersistenceLatestDto) { return this.publish.persistenceLatest(body.workspaceKey) }
}

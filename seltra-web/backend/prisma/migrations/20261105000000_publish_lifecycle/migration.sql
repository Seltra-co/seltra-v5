-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'PREPARING_WORKSPACE', 'SAVING_SOURCE', 'BUILDING', 'VERIFYING', 'ACTIVATING', 'LIVE', 'FAILED', 'SUPERSEDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DeploymentKind" AS ENUM ('PUBLISH', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "PublishDeployMode" AS ENUM ('hobby', 'team');

-- CreateEnum
CREATE TYPE "PublishRepoVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "PublishSourceState" AS ENUM ('COMPLETE', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "PublishPersistenceStatus" AS ENUM ('OK', 'PENDING', 'DEGRADED');

-- CreateEnum
CREATE TYPE "PublishWorkspaceStatus" AS ENUM ('ACTIVE', 'IDLE', 'PERSISTING', 'EVICTED', 'RESTORING', 'FAILED');

-- CreateEnum
CREATE TYPE "PublishPublicationStatus" AS ENUM ('UNPUBLISHED', 'PUBLISHED', 'UNPUBLISHING');

-- AlterTable
ALTER TABLE "TenantApp" ADD COLUMN     "activePublishId" TEXT,
ADD COLUMN     "githubDefaultBranch" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN     "githubRepoFullName" TEXT,
ADD COLUMN     "githubRepoId" TEXT,
ADD COLUMN     "githubRepoVisibility" "PublishRepoVisibility",
ADD COLUMN     "lastKnownGoodDeploymentId" TEXT,
ADD COLUMN     "lastPushError" TEXT,
ADD COLUMN     "lastPushedAt" TIMESTAMP(3),
ADD COLUMN     "lastPushedSha" TEXT,
ADD COLUMN     "lastSnapshotAt" TIMESTAMP(3),
ADD COLUMN     "liveDeploymentId" TEXT,
ADD COLUMN     "persistenceStatus" "PublishPersistenceStatus" NOT NULL DEFAULT 'OK',
ADD COLUMN     "publicationStatus" "PublishPublicationStatus" NOT NULL DEFAULT 'UNPUBLISHED',
ADD COLUMN     "sourceState" "PublishSourceState",
ADD COLUMN     "vercelProjectId" TEXT,
ADD COLUMN     "vercelProjectName" TEXT,
ADD COLUMN     "workspaceStatus" "PublishWorkspaceStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantAppId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "DeploymentKind" NOT NULL DEFAULT 'PUBLISH',
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT,
    "triggeredByUserId" TEXT NOT NULL,
    "sourceCommitSha" TEXT,
    "vercelProjectId" TEXT,
    "vercelDeploymentId" TEXT,
    "vercelOrigin" TEXT,
    "healthStatus" TEXT,
    "healthCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "publicVerifiedAt" TIMESTAMP(3),
    "rollbackSourceId" TEXT,
    "previousDeploymentId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "buildLogTail" TEXT,
    "lastEventSeq" INTEGER NOT NULL DEFAULT 0,
    "timings" JSONB,
    "deployMode" "PublishDeployMode" NOT NULL DEFAULT 'team',
    "repoVisibility" "PublishRepoVisibility",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "liveAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishEvent" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "DeploymentStatus" NOT NULL,
    "message" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deployment_tenantAppId_createdAt_idx" ON "Deployment"("tenantAppId", "createdAt");

-- CreateIndex
CREATE INDEX "Deployment_slug_status_idx" ON "Deployment"("slug", "status");

-- CreateIndex
CREATE INDEX "Deployment_tenantId_createdAt_idx" ON "Deployment"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_tenantAppId_idempotencyKey_key" ON "Deployment"("tenantAppId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishEvent_deploymentId_createdAt_idx" ON "PublishEvent"("deploymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishEvent_deploymentId_seq_key" ON "PublishEvent"("deploymentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "TenantApp_activePublishId_key" ON "TenantApp"("activePublishId");

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_tenantAppId_fkey" FOREIGN KEY ("tenantAppId") REFERENCES "TenantApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishEvent" ADD CONSTRAINT "PublishEvent_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


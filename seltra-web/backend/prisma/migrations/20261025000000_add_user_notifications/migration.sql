CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "tenantEventId" TEXT,
    "type" "TenantEventType" NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserNotification_tenantEventId_key" ON "UserNotification"("tenantEventId");
CREATE INDEX "UserNotification_userId_createdAt_idx" ON "UserNotification"("userId", "createdAt");
CREATE INDEX "UserNotification_tenantId_createdAt_idx" ON "UserNotification"("tenantId", "createdAt");

ALTER TABLE "UserNotification"
    ADD CONSTRAINT "UserNotification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserNotification"
    ADD CONSTRAINT "UserNotification_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserNotification"
    ADD CONSTRAINT "UserNotification_tenantEventId_fkey"
    FOREIGN KEY ("tenantEventId") REFERENCES "TenantEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "UserNotification" ("id", "userId", "tenantId", "tenantEventId", "type", "meta", "createdAt")
SELECT gen_random_uuid()::text, tenant."ownerId", event."tenantId", event."id", event."type", event."meta", event."createdAt"
FROM "TenantEvent" AS event
JOIN "Tenant" AS tenant ON tenant."id" = event."tenantId"
WHERE tenant."ownerId" IS NOT NULL;

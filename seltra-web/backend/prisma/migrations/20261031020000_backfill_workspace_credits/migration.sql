-- Move the existing free-window allowance into the ledger-backed model. The
-- current legacy default is 40 requests per five-hour window. Preserve each
-- tenant's remaining allowance and record the historical use as one auditable
-- migration adjustment; no legacy counters are read after this migration.
ALTER TABLE "workspace_credits"
  ADD COLUMN IF NOT EXISTS "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

WITH source AS (
  SELECT
    t."id" AS "workspaceId",
    CASE WHEN t."aiCreditsWindowStart" >= CURRENT_TIMESTAMP - INTERVAL '5 hours'
      THEN t."aiCreditsWindowStart" ELSE CURRENT_TIMESTAMP END AS "windowStartedAt",
    LEAST(40, GREATEST(0, CASE
      WHEN t."aiCreditsWindowStart" >= CURRENT_TIMESTAMP - INTERVAL '5 hours'
        THEN t."aiCreditsUsed"
      ELSE 0
    END)) AS "used"
  FROM "Tenant" t
  WHERE t."creditWorkspaceId" IS NULL
), inserted AS (
  INSERT INTO "workspace_credits" ("workspaceId", "balance", "lifetimeGranted", "lifetimeUsed", "windowStartedAt", "updatedAt")
  SELECT "workspaceId", 40 - "used", 40, "used", "windowStartedAt", CURRENT_TIMESTAMP
  FROM source
  ON CONFLICT ("workspaceId") DO NOTHING
  RETURNING "workspaceId", "balance", "lifetimeUsed"
)
INSERT INTO "credit_ledger" ("id", "workspaceId", "kind", "delta", "balanceAfter", "meta", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text || g."workspaceId"), g."workspaceId", g."kind", g."delta", g."balanceAfter", g."meta", CURRENT_TIMESTAMP
FROM (
  SELECT "workspaceId", 'grant'::text AS "kind", 40 AS "delta", 40 AS "balanceAfter", '{"reason":"legacy_allowance_migration","source":"SELTRA_AI_CREDIT_LIMIT default 40"}'::jsonb AS "meta"
  FROM inserted
  UNION ALL
  SELECT "workspaceId", 'migration'::text, -"lifetimeUsed", "balance", jsonb_build_object('reason', 'legacy_usage_migration', 'requests', "lifetimeUsed")
  FROM inserted
  WHERE "lifetimeUsed" > 0
) g;

UPDATE "Tenant" t
SET "creditWorkspaceId" = t."id"
WHERE t."creditWorkspaceId" IS NULL
  AND EXISTS (SELECT 1 FROM "workspace_credits" c WHERE c."workspaceId" = t."id");

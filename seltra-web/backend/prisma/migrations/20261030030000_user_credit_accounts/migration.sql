-- Credits belong to the account owner and are shared across that user's projects.
-- Keep the former workspace tables as historical records; the application now
-- writes only to these per-user account and ledger tables.
CREATE TABLE IF NOT EXISTS "user_credits" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "lifetimeGranted" INTEGER NOT NULL DEFAULT 0,
  "lifetimeUsed" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "windowAllowance" INTEGER NOT NULL DEFAULT 0,
  "plan" TEXT NOT NULL DEFAULT 'free',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "user_credit_ledger" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user_credits"("userId") ON DELETE CASCADE,
  "runId" TEXT,
  "projectId" TEXT,
  "kind" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "modelRole" TEXT,
  "tokensIn" INTEGER NOT NULL DEFAULT 0,
  "tokensOut" INTEGER NOT NULL DEFAULT 0,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "user_credit_ledger_userId_createdAt_idx" ON "user_credit_ledger"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "user_credit_ledger_runId_idx" ON "user_credit_ledger"("runId");

-- 20M workspace tokens = 20,000 credits (one credit per 1,000 weighted tokens).
-- The default Pro allowance is 5x and both values are configurable at runtime.
WITH allowances AS (
  SELECT "id", CASE WHEN "plan" IN ('premium', 'pro') THEN 100000 ELSE 20000 END AS allowance,
         CASE WHEN "plan" IN ('premium', 'pro') THEN 'premium' ELSE 'free' END AS normalized_plan
  FROM "User"
), inserted AS (
  INSERT INTO "user_credits" ("userId", "balance", "lifetimeGranted", "lifetimeUsed", "windowStartedAt", "windowAllowance", "plan", "updatedAt")
  SELECT "id", allowance, allowance, 0, CURRENT_TIMESTAMP, allowance, normalized_plan, CURRENT_TIMESTAMP
  FROM allowances
  ON CONFLICT ("userId") DO NOTHING
  RETURNING "userId", "balance"
)
INSERT INTO "user_credit_ledger" ("id", "userId", "kind", "delta", "balanceAfter", "meta", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text || inserted."userId"), inserted."userId", 'grant', inserted."balance", inserted."balance",
       jsonb_build_object('reason', 'initial_user_plan_allowance', 'unit', 'credits_per_1000_weighted_tokens'), CURRENT_TIMESTAMP
FROM inserted;

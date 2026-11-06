# P3A Report - Per-app Vercel projects and deployment orchestration

## 1. Files created or changed

- `seltra-web/core/server/src/publish/vercel.ts` - project lookup/creation, repository linkage validation, public build-variable synchronization, SHA-pinned deployment, log polling/redaction, rate-limit retries, deployment listing, and cancellation.
- `seltra-web/core/server/src/publish/orchestrator.ts` - queue worker, lease heartbeat, restart resume, persistence/deployment orchestration, route activation/rollback, Vercel budget reservation, and unexpected-deployment reconciliation.
- `seltra-web/core/server/src/main.ts` - authenticated publish endpoints, queue worker startup, runtime restoration for recovered jobs, and Backend-backed SSE.
- `seltra-web/backend/src/publish/publish.service.ts` and `src/core-internal/core-internal.controller.ts` - durable leases, global concurrency and Vercel request budgets, fencing checks, reconciliation records, and publish status/events.
- `seltra-web/backend/prisma/schema.prisma` and migrations `20261105130000_workspace_persistence_journal` and `20261105140000_publish_queue_recovery` - additive workspace persistence journal, deployment lease, attempt, budget timestamp, and provider audit fields. Both migrations are applied to the configured Neon staging branch.
- `seltra-web/core/src/seltra_publish/vercel.test.ts` and `orchestrator.test.ts` - mocked provider, budget/reconciliation, and restart-resume tests.
- `seltra-web/backend/src/__tests__/publish.service.test.ts` - queue lease, budget, stale worker, and audit-record cases.

## 2. Commands run

- `npx.cmd prisma format` and `npx.cmd prisma generate` in `seltra-web/backend` - PASS.
- `npm.cmd test -- --runTestsByPath src/__tests__/publish.service.test.ts` in `seltra-web/backend` - PASS, 25 tests.
- `npx.cmd tsc --noEmit` in `seltra-web/backend` - PASS.
- `npm.cmd run ts:main` in `seltra-web/core` - PASS after final lease propagation fix.
- `vitest run src/seltra_publish/vercel.test.ts src/seltra_publish/orchestrator.test.ts src/web/publish_security.test.ts` in `seltra-web/core` - PASS, 13 tests.

## 3. Deviations and why

- D0-B S1-S3 and S5 remain unrun. No provider API or merchant project was touched, so the specification's prerequisite gate still prevents live publishing.
- Backend now owns expiring leases and concurrency limits. Core reclaims queued and nonterminal jobs after lease expiry and resumes from Backend status and sequence. Lease tokens fence stale workers from status and terminal writes.
- Workspace-capacity and Vercel-budget waits release the lease for delayed retry. Global request reservations are idempotent and enforce hourly, five-minute, and daily caps.
- The reconciler compares production deployments with Backend IDs and the active R2 route. It persists unexpected deployments and cancels only unexpected in-progress deployments not referenced by the active route. Ready deployments remain recorded for review.
- Neon initially rejected the workspace migration because its SQL began with a UTF-8 BOM. The BOM was removed, Prisma recorded the failed attempt as rolled back, and both pending migrations then applied successfully.

## 4. Open questions

- Verify S1-S3 and S5, then run disposable provider tests for private Git linkage, push-trigger suppression, build status/log events, and cancellation.
- Confirm operational alert delivery for persisted unexpected-deployment records; current Core logs first detection and Backend stores deduplicated status.
- Verify actual provider rate-limit headers and tune lower budgets if the account's observed limits require it.

## 5. What could not be verified

- Real GitHub/Vercel project creation, automatic deployment suppression, provider cancellation, immutable-origin health checks, live route activation, retention, or billing behavior.
- Destructive recovery and production routing.

**Status: durable queue, restart recovery, budgets, and unexpected-deployment handling are implemented and mock-tested; D0 provider gate remains closed and `PUBLISH_ENABLED` must stay false.**

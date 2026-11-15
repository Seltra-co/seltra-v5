# Publish P1B Report

## 1. Files created or changed

- `seltra-web/core/server/src/config.ts` — resolves Amendment 1 environment names and aliases, normalizes GitHub key and R2 endpoint, and validates required publishing configuration without logging secret values.
- `seltra-web/core/server/src/publish/github.ts` — GitHub App token handling, repository setup, private/public visibility rules, clone and fast-forward-only push; credentials are supplied to Git transiently.
- `seltra-web/core/server/src/publish/r2.ts` — signed Cloudflare R2 object operations; `R2_TOKEN` is not read.
- `seltra-web/core/server/src/publish/archive.ts` — bounded tar/gzip snapshot archive creation and safe extraction.
- `seltra-web/core/server/src/publish/snapshot.ts` — save points, encrypted runtime key wrapping, snapshot manifest-last writes, restore, retries, degraded persistence and alert handling.
- `seltra-web/core/server/src/publish/runtime_rpc.ts`, `seltra-web/core/src/web/rpc_server.ts`, `runtime_main.ts` — authenticated child RPC transport and snapshot/commit handlers.
- `seltra-web/core/src/seltra_publish/workspace_rpc.ts` — SQLite backup and app commit with platform-owned `vercel.json`, pre-push validation, explicit author identity and commit trailers.
- `seltra-web/core/server/src/publish/validator.ts` — app file and repository checks, platform-owned Vercel configuration, secret scan, and rejection of cron jobs and external rewrites.
- `seltra-web/core/server/src/publish/edit_lease.ts` — Core client for Backend edit lease operations.
- `seltra-web/core/server/src/main.ts`, `workspace_supervisor.ts`, `security.ts` — publish feature gate, save-point and shutdown hooks, restore-before-start, persistence-before-idle-stop, and gateway routes.
- `seltra-web/backend/prisma/schema.prisma`, `seltra-web/backend/prisma/migrations/20261105120000_publish_edit_lease/migration.sql` — additive edit lease fields and migration.
- `seltra-web/backend/src/publish/publish.service.ts`, `src/core-internal/core-internal.controller.ts`, `src/core-internal/core-internal.module.ts`, `src/app.module.ts`, `src/internal-ops/controllers/dashboard.controller.ts` — repository state and guarded edit lease APIs.
- `seltra-web/core/src/seltra_publish/durability.test.ts`, `seltra-web/core/src/web/publish_security.test.ts`, `seltra-web/backend/src/__tests__/publish.service.test.ts` — durability, validator, secret handling, and edit lease tests.
- `docs/PUBLISH-P1B-REPORT.md` — this report.

## 2. Commands run and results

- Core focused durability tests: `node node_modules/vitest/vitest.mjs run src/seltra_publish/durability.test.ts` — **12/12 passed**, including a destructive local recovery case that deletes the temporary source workspace and restores into a fresh root.
- Backend focused publish service tests: `npm.cmd test -- --runInBand --runTestsByPath src/__tests__/publish.service.test.ts` — **17/17 passed**.
- Core TypeScript: `npm.cmd run ts:main` — **passed**.
- Gateway production build: `node scripts/web/build-gateway.mjs` — **passed**.
- Runtime production build: `node scripts/build-runtime.mjs` — **passed**.
- Backend production build: `npm.cmd run build` — **passed**.
- Neon staging migration deployment: `npm.cmd exec prisma migrate deploy -- --schema prisma/schema.prisma` — applied `20261105120000_publish_edit_lease` (the earlier P1A lifecycle migration had already been applied).
- Neon staging migration status: `npm.cmd exec prisma migrate status -- --schema prisma/schema.prisma` — **43 migrations found; database schema is up to date**.
- `git diff --check` — **passed** (Git emitted only line-ending conversion notices).

The P0b report records the `web:test` 503 as pre-existing. P1A is complete, satisfying the amended P1B gate.

## 3. Deviations and why

- Backend schema/API work was added for source repository bookkeeping and edit lease persistence. Core’s P1B responsibilities require these operations to survive process restarts; in-memory-only lease ownership would not meet that contract.
- Tests use mocked GitHub/R2 and local temporary workspaces. They cover manifest-last upload, app and user data restore, wrong master key, fast-forward divergence, token exclusion from Git config/arguments, validator restrictions, and failed persistence behavior. The destructive test proves the local restore flow has no dependency on the deleted fixture directory; because the providers are mocked, it does not prove live GitHub/R2 recovery or constitute the live D1–D3 drills.
- Publishing remains disabled per the supplied `PUBLISH_ENABLED=false`; the new GitHub/R2 flows are feature-gated and no live repository, R2 object, Vercel project, or deployment was created by this phase.
- The existing Render disk-related code paths were preserved. No P2 eviction manager or P3 deployment orchestration was introduced.

## 4. Open questions

- Run D1–D3 against a designated test tenant and exercise restart/shutdown behavior on the actual Render service before enabling publishing.
- Confirm the production alert webhook and the expected operational response for repeated persistence failure.
- Edit lease APIs and persistence are present; the editor UI wiring remains outside P1B.
- Complete the Vercel Hobby and GitHub integration spikes required before P3A, as specified in Amendment 1.

## 5. What could not be verified

- Live GitHub App token exchange, repository visibility behavior, GitHub push/clone against the configured organization, and live R2 request signing/storage. Publishing was disabled, so these services were not contacted.
- Render's actual SIGTERM-to-kill window, process restart recovery, multi-instance races, and alert delivery.
- D1–D3 end-to-end on a real test tenant. Current coverage is mocked/local and does not prove production durability.
- A full end-to-end publish to a Vercel deployment; that orchestration belongs to P3A.

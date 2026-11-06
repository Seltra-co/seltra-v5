# Seltra V5 Publish — Implementation Handoff

**As of:** 2026-11-06  
**Audience:** Claude, GPT, Codex, or another implementation agent  
**Authority:** Read `docs/PUBLISH-SPEC.md` in full. It is the consolidated specification; Amendment 1 is archival context. Do not weaken its gates.

## Executive status

The publishing path has substantial local implementation across Backend, Core, the Worker, and dashboard. The durable queue migrations are applied to the configured Neon **staging** branch, and the schema is up to date. Unit tests, type checks, and the frontend production build passed as recorded in the phase reports.

**The system is not ready for Willy to click Publish in a real browser session.** P2 is explicitly partial; no real GitHub/R2/Neon persistence drill, isolated Render execution test, disposable Vercel publish, Cloudflare route test, or authenticated browser flow has been completed. Keep `PUBLISH_ENABLED=false`. Mocked tests establish code behavior only; they do not establish provider or production readiness.

## Architecture established in the specification and code

| Area | Established | Evidence and limit |
|---|---|---|
| Ownership | Dashboard presents controls; Backend/Neon owns tenant, app, deployment, event, and persistence records; Core coordinates runtime, GitHub, R2, Vercel, and routes. | Consolidated spec §§0–2, 8; Backend/Core implementation and P1A–P3C reports. Live multi-service behavior remains untested. |
| Permanent source | One private `Seltra-Cloud/app-<id>` GitHub repository per app; source is committed and SHA-verified by Core. | P1B GitHub and workspace RPC code plus mocked tests. No live GitHub app/repository round-trip has been run. Privacy remains invariant in Hobby and Team modes. |
| Durable metadata | Neon/Backend records app identity, source revisions, persistence journal, deployments, events, leases, and provider reconciliation. | Prisma schema and migrations. On 2026-11-06 Prisma applied `20261105130000_workspace_persistence_journal` and `20261105140000_publish_queue_recovery` to the configured staging branch; `prisma migrate status` reported 45 migrations and an up-to-date schema. This does not prove recovery behavior. |
| Workspace snapshots | Core creates encrypted/versioned R2 snapshots and manifests, verifies them on restore, and records durability state in Neon. R2 is supporting recovery state, not permanent app source. | P1B code and mocked destructive restore tests. No live R2 upload, checksum/manifest restore, or fresh-instance recovery has been proven. |
| Execution boundary | A Docker execution-provider abstraction exists; production host-process execution fails closed. New workspace paths use an explicit workspace root rather than `DATA_ROOT` for recovery. | P2 code and unit tests. Docker engine was unavailable locally; Render container/network/firewall configuration is unverified. Do not call generated-code execution isolated yet. |
| Publishing queue | Backend-owned expiring leases, concurrency/budget reservations, fencing, restart resumption, and unexpected-deployment audit records exist. | P3A code and mocked tests. No live Vercel deployment/reconciliation or multi-instance load test. |
| Routing | A Worker implementation validates R2 route records, proxies to Vercel, sanitizes headers/cookies, and keeps legacy fallback behavior. Core activates/restores route pointers after deployment checks. | P3B code and eight fake-fetch tests. Worker is not deployed; the live R2 route shape, V4 compatibility, and hostname behavior are not proven. |
| Dashboard | Publish panel is feature-gated; it has Backend history/status, Core SSE with polling fallback, URL actions, rollback/unpublish, repair handoff, and retry states. | P3C type check/build. No browser test, authenticated SSE session, or real Backend transition has been exercised. |

**Disk decision:** Render persistent disk is not an allowed durability dependency. Willy previously reported it removed, but current Render service/volume configuration was not inspected in this work. Existing disk paths remain by design. New persistence/recovery must stay independent of them; do not remove the old paths until spec §15 is satisfied and Willy supplies the required written approval.

## Concrete work done

- Consolidated the architecture, invariants, environment contract, risk register, phase order, acceptance tests, and removal gate in `docs/PUBLISH-SPEC.md`.
- Completed P0/P0b safety work: child environment filtering, secret redaction, and diagnosis that the `web:test` 503 also occurs on the pre-P0 baseline. Its reported cause is the entitlement fixture missing `engineApiKey`, not the P0 filter.
- Added Backend publish lifecycle, ownership/quotas/idempotency, edit leases, persistence records, deployment records/events, queue leases, request budgets, and provider-event audit records.
- Added Core GitHub private-repository operations, source validation/commit, encrypted R2 snapshots/manifests, restore and persistence hooks, execution-provider abstraction, Vercel publisher/orchestrator, route activation, restart recovery, and reconciliation.
- Added Cloudflare Worker proxy code and dashboard publish panel behind flags.
- Applied the pending staging migrations `20261105130000_workspace_persistence_journal` and `20261105140000_publish_queue_recovery`. The first attempt exposed a UTF-8 BOM in the former; it was removed, the failed attempt was marked rolled back, both migrations applied, and status then reported up to date. No production Neon target was used.
- Recorded locally passing checks in the phase reports: P3A Backend 25 tests and Core 13 tests; P3B Worker 8 tests; P3C frontend type check and production build (17 static pages). P2’s report records Core 17 tests and Backend 19 tests. These are mocked/unit/build checks, not live acceptance evidence.

## Exact implementation and verification records

Use these phase reports as the authoritative file-by-file record; each lists exact paths, commands, outcomes, deviations, open questions, and what was not verified:

| Work | Report |
|---|---|
| D0 discovery and unresolved provider spikes | `docs/PUBLISH-D0-REPORT.md` |
| P0b child environment safety and baseline diagnosis | `docs/PUBLISH-P0B-REPORT.md` |
| P1A Backend publish lifecycle | `docs/PUBLISH-P1A-REPORT.md` |
| P1B GitHub/R2/source persistence implementation | `docs/PUBLISH-P1B-REPORT.md` |
| P2 Docker execution provider and disposable workspace lifecycle | `docs/PUBLISH-P2-REPORT.md` |
| P3A Vercel orchestration, queue recovery, budgets, reconciliation | `docs/PUBLISH-P3A-REPORT.md` |
| P3B Cloudflare Worker and route activation | `docs/PUBLISH-P3B-REPORT.md` |
| P3C dashboard experience | `docs/PUBLISH-P3C-REPORT.md` |

The phase reports contain the exhaustive path lists. Key exact paths include:

- Backend: `seltra-web/backend/prisma/schema.prisma`; `seltra-web/backend/prisma/migrations/20261105000000_publish_lifecycle/migration.sql`; `seltra-web/backend/prisma/migrations/20261105120000_publish_edit_lease/migration.sql`; `seltra-web/backend/prisma/migrations/20261105130000_workspace_persistence_journal/migration.sql`; `seltra-web/backend/prisma/migrations/20261105140000_publish_queue_recovery/migration.sql`; `seltra-web/backend/src/publish/publish.service.ts`; `seltra-web/backend/src/core-internal/core-internal.controller.ts`; `seltra-web/backend/src/__tests__/publish.service.test.ts`.
- Core gateway: `seltra-web/core/server/src/config.ts`; `seltra-web/core/server/src/security.ts`; `seltra-web/core/server/src/workspace_supervisor.ts`; `seltra-web/core/server/src/execution_provider.ts`; `seltra-web/core/server/src/main.ts`; `seltra-web/core/server/src/publish/github.ts`; `seltra-web/core/server/src/publish/r2.ts`; `seltra-web/core/server/src/publish/archive.ts`; `seltra-web/core/server/src/publish/snapshot.ts`; `seltra-web/core/server/src/publish/validator.ts`; `seltra-web/core/server/src/publish/edit_lease.ts`; `seltra-web/core/server/src/publish/runtime_rpc.ts`; `seltra-web/core/server/src/publish/vercel.ts`; `seltra-web/core/server/src/publish/orchestrator.ts`.
- Core runtime/tests: `seltra-web/core/src/seltra_publish/workspace_rpc.ts`; `seltra-web/core/src/seltra_publish/durability.test.ts`; `seltra-web/core/src/seltra_publish/execution_provider.test.ts`; `seltra-web/core/src/seltra_publish/vercel.test.ts`; `seltra-web/core/src/seltra_publish/orchestrator.test.ts`; `seltra-web/core/src/web/rpc_server.ts`; `seltra-web/core/src/web/runtime_main.ts`; `seltra-web/core/src/web/publish_security.test.ts`.
- Worker: `seltra-web/edge/subdomain-router/worker.js`; `seltra-web/edge/subdomain-router/worker.test.js`; `seltra-web/edge/subdomain-router/README.md`; `seltra-web/edge/subdomain-router/smoke-v4.mjs`.
- Frontend: `seltra-web/frontend/components/dashboard/PublishPanel.tsx`; `seltra-web/frontend/app/(dashboard)/dashboard/page.tsx`; `seltra-web/frontend/app/store/[slug]/page.tsx`.

Reported verification commands and outcomes (no live-provider test is implied):

| Command (run from named package directory) | Recorded result |
|---|---|
| Backend `npm.cmd test -- --runTestsByPath src/__tests__/publish.service.test.ts` | P3A: 25/25 passed; earlier phases report smaller counts from the then-current test set. |
| Backend `npx.cmd tsc --noEmit` | Passed. |
| Backend `npx.cmd prisma migrate status` | Passed after deployment: 45 migrations found, schema up to date on configured staging branch. |
| Core `npm.cmd run ts:main` | Passed. |
| Core `vitest run src/seltra_publish/vercel.test.ts src/seltra_publish/orchestrator.test.ts src/web/publish_security.test.ts` | P3A: 13 tests passed. |
| Core `vitest run src/seltra_publish/durability.test.ts src/seltra_publish/execution_provider.test.ts src/web/publish_security.test.ts` | P2: 17 tests passed. |
| Backend `npm.cmd test -- --runTestsByPath src/__tests__/publish.service.test.ts` | P2 report: 19 tests passed. |
| Worker `node --test worker.test.js` in `seltra-web/edge/subdomain-router` | 8 tests passed. |
| Frontend `npx.cmd tsc --noEmit` | Passed. |
| Frontend `npm.cmd run build` | Passed; 17 static pages generated. |
| Core `npm.cmd run web:test` | Fails at the existing gateway entitlement assertion (503); P0b report records the same failure on pre-P0 baseline and its fixture cause. |
| Docker `docker info` | Failed locally because Docker Desktop engine was unavailable; no container integration test ran. |

The phase reports also include P0b security checks, P1B build results, and historical migration status. Prefer the current migration status above over an earlier point-in-time line in an older phase report.

## Phase status

| Phase | Status | Remaining evidence |
|---|---|---|
| D0-A | Repository discovery recorded. | Recheck any deployment-specific facts before rollout; Render configuration and V4 live-store data are not in this checkout. |
| D0-B S1–S6 | **Not run.** | Run against disposable resources; see the exact list below. P3A code was written without its required discovery gate, so this gate remains open. |
| P0 / P0b | Implemented and reported. | Existing gateway fixture issue is documented; do not attribute it to child env filtering. |
| P1A | Backend lifecycle implementation reported. | Verify V4 live-store predicate against real data before allowing contested slugs; existing P1A report predates the later migration applies. |
| P1B | Persistence/repository implementation and mocked tests reported. | Live GitHub/R2 round-trip, shutdown/restart behavior, alert delivery, and D1–D3 remain unverified. |
| P1C | Artifacts exist, but **not proven complete as a phase**. | The persistence journal is now in staging; prove completed-edit acknowledgement, idempotent retries, all partial-failure boundaries, SIGTERM, and recovery using D16–D21. No separate P1C completion evidence is recorded. |
| P2 | **Partial; not production-ready.** | Render Docker availability, firewall/package proxy, per-app boundary, resource limits, locking, capacity queue/states, shadow restore comparison, cleanup, and fresh-instance recovery. D16–D22 are outstanding. |
| P3A | Local implementation and mocked tests complete; provider gate **open**. | S1–S3/S5, private-repo Hobby capability, real SHA-pinned deployment, retention/log behavior, budgets, and real restart/reconciliation. |
| P3B | Local Worker implementation and tests complete; live integration **open**. | S4/S6 as applicable, real route contract, V4 smoke, Worker preview, origin/public health checks, rollback, and hostname verification. |
| P3C | Feature-gated UI/build complete; browser behavior **unverified**. | Authenticated browser session, SSE reconnection/poll fallback, keyboard/accessibility checks, and real lifecycle states. |
| Final | **Not complete.** | Acceptance suite, costs/usage monitoring, nightly reconciler/runbook, browser test, real publish/rollback, and 48-hour A14 observation. |

Historical reports are snapshots, not a current go-live signal. In particular, P2’s original report predates the November 6 migration apply and correctly records the earlier state.

## Required work before an internal browser Publish click

Complete these in sequence. Use disposable internal test data and resources only; no real merchant app, production route, or existing Vercel project.

### 1. Close discovery and account-mode gates

Write `docs/PUBLISH-SPIKES-REPORT.md` with redacted request/response facts and pass/fail for:

- **S1:** prove push-triggered Vercel deployments remain disabled for the linked private repo.
- **S2:** prove Core can create a production deployment pinned to the exact saved SHA under the chosen no-auto-deploy configuration.
- **S3:** prove `Seltra-Cloud` can connect to the intended Vercel account/team.
- **S4:** establish deployment-protection behavior for immutable deployment URLs and required automation access.
- **S5:** establish deployment retention and build-log/event behavior needed for rollback and truthful UI progress.
- **S6:** confirm Vercel’s reverse-proxy/client-IP behavior for Worker routing.

Confirm whether the supplied Hobby account supports **private organization repositories** with the chosen API flow. Never make merchant repositories public or switch to tarball deployment. If private publishing is unavailable in Hobby, leave live publishing disabled and use the approved private-capable account/mode before D23.

Resolve account team scope, actual rate-limit headers, and retained rollback deployment availability. Record any S1–S6 failure and the exact fallback chosen by Willy; do not silently choose a weaker architecture.

### 2. Complete and prove persistence before publish

- Verify the actual Neon staging branch and deployed Core/Backend config using names only; validate Core startup reports missing variable **names**, not values.
- Run D16 with persistence/restore enabled and publishing disabled: make a real edit, verify private GitHub SHA, R2 snapshot/manifest/checksum, and matching Neon journal; prove no Vercel call or route write occurs.
- Run D17–D21: destroy the disposable original workspace, restore on a clean separate Core instance with no shared volume, continue editing, inject GitHub/R2/Neon failures at every boundary, and interrupt operations between provider writes. Record hashes, versions, durations, and failure state.
- Verify alerts and `SAFE_TO_DESTROY` are withheld on any partial or ambiguous persistence result. Verify shutdown behavior against Render’s actual termination window.

Mocks do not pass these drills.

### 3. Make P2 execution safe and operational

- Provide and verify the actual Render execution setup: Docker image built/pinned by immutable ID, Docker daemon available, internal-only network, host firewall restricting access to Core RPC/model gateway and approved package proxy, and no Docker socket or host secrets exposed.
- Prove a generated build cannot read Core configuration, sibling app files, host credentials, another tenant’s data, or workspace control sockets; enforce CPU/memory/PID and cleanup limits. Resolve the current single-workspace mount’s per-app boundary.
- Complete restore locking across Core instances, restore-on-demand, capacity queue/fairness, `WORKSPACE_RESTORING`/`CAPACITY` reporting, shadow compare, and fresh-instance placement.
- Run D22 with real disposable containers. Keep destructive eviction in shadow mode until D24 and the spec’s approval gate.

### 4. Complete live publish/routing readiness

- Verify the real V4 live-store predicate and slug ownership. Fail closed for unknown/colliding slugs; select a disposable unused slug for internal acceptance.
- Run D23 using only a private disposable repository/project. Verify repo privacy, exact Git SHA equality at Backend/GitHub/Vercel, provider status/log mapping, immutable-origin health, route-write ordering, public hostname status and `x-seltra-deployment`.
- Deploy the Worker only to a preview/test route first; verify actual R2 binding and record shape, cookies/redirects/HEAD/error behavior, trusted client-IP forwarding, and V4 before/after smoke for all affected test slugs. Do not attach production DNS until the smoke passes.
- Prove failure keeps the last-known-good route, unexpected production deployments are detected, and rollback/unpublish are isolated to one app.

### 5. Prepare the exact browser test

- Confirm Backend/Core/Frontend environment names and URLs, origins, auth, root domain, and public API base. `PUBLISH_PUBLIC_API_URL` must match the scaffold’s expected `/api/v5` API base. Never copy infrastructure secrets into Backend/browser/generated apps.
- Keep `PUBLISH_ENABLED=false` and `NEXT_PUBLIC_FF_PUBLISH=false` until gates above pass. Enabling the frontend feature flag alone does not make publishing safe. After an explicit internal-test go decision, use `DEPLOY_MODE=hobby` only if S3 and D23 prove private publishing; set persistence/restore flags independently and keep destruction in shadow mode.
- Run the service startup and health checks below, then run the feature-flag-off comparison and a browser test against the disposable tenant. Capture actual UI states and Backend events; verify SSE reconnect/polling and no fabricated progress.
- Only after the controlled go/no-go, enable publish for the disposable test environment and perform the first browser click. Do not change production flags or use merchant data.

## Local service startup (after code/config prerequisites are met)

Use three terminals from the repository root; do not print `.env` contents.

1. Backend: `cd seltra-web/backend` then `npm run dev` (local Nest API, normally port 3001).
2. Core gateway/runtime: `cd seltra-web/core` then `npm run web:dev` (requires Node 24, `.env.web`, matching `CORE_TOKEN_SECRET` and `CORE_SERVICE_SECRET` between Core and Backend, and `NEST_INTERNAL_URL=http://localhost:3001`).
3. Frontend: `cd seltra-web/frontend` then `npm run dev` (normally `http://localhost:3000`; set `NEXT_PUBLIC_CORE_URL=http://localhost:8080`, `NEXT_PUBLIC_API_BASE_URL`/proxy target to the local Backend, and `NEXT_PUBLIC_ROOT_DOMAIN=seltra.co`).

Check Backend health, Core `/healthz`, authenticated sign-in, app ownership, preview readiness, and browser console/network errors before any publish attempt. Confirm actual ports from the local environment if they differ; do not assume deployed URLs equal local URLs.

## First controlled browser acceptance flow

Use a newly created disposable internal tenant/app and unused slug only:

1. Sign in and create a test app; verify ownership and a private GitHub repo are established.
2. Build the app and open preview; verify its generated source and public API configuration.
3. Click Publish once. Observe Backend-recorded stages and queue position; confirm events appear only after Backend writes.
4. Verify the recorded saved SHA matches the GitHub `main` commit and Vercel deployment SHA.
5. Verify immutable-origin health before route activation, then open the public test URL and check HTTP 200 plus the opaque `x-seltra-deployment` id.
6. Edit and publish a second version; probe during cutover and verify the previous deployment remains rollback-eligible.
7. Roll back and verify only this app’s route changes. Test unpublish only after rollback succeeds.
8. Complete workspace destruction/recovery only after the matching Neon `SAFE_TO_DESTROY` record exists; prove recovery from GitHub + Neon + R2 on a clean instance.

Capture timestamps, deployment IDs, SHAs, response status/header, Backend events, and relevant redacted logs. Do not record secret values.

## Acceptance/closeout gate

Do not tell Willy to test or click Publish until the dependent checks above pass and the final report includes:

- Completed, partial, blocked phases and exact evidence.
- Commands and test counts; mocked versus live-provider tests clearly separated.
- Migration status and target environment.
- Render isolation/network facts and D16–D24 evidence.
- Hobby private-repository capability and selected deployment mode.
- GitHub/R2/Neon/Vercel/Cloudflare resource status, without secret values.
- Exact local/deployed startup order, test URL, test tenant/slug, and kill-switch rollback instructions.
- Remaining A1–A14/D1–D24 and 48-hour A14 observation status.

The 48-hour observation and written disk-removal approval are required before deleting legacy disk-related code; they are not replaced by a successful browser publish.

# SELTRA V5 Acceptance Report

## Implementation status

- The V5 run/event foundation, additive Prisma models, migration, run API, stop/continue service, active-run lookup, orphan reaper, authorization checks, workspace file/blob upsert, and partial one-active-run database index are present.
- The live dashboard Core flow now creates an idempotent persisted run, sends start/heartbeat/completion events, restores active/interrupted run attachment state, and dispatches a Core chat cancellation on Stop.
- Core gateway workspace RPCs now attempt write-through synchronization of app files into `project_files`/`file_blobs`.
- Generic Core file cards now use concrete write/update/rename file paths; unnamed generic activity cards are suppressed.
- A Core runtime typecheck, backend Nest compile, focused reliability Jest suite, database migration deploy, and frontend production build/typecheck pass locally.
- No model IDs were changed.
- The existing tenant/workspace boundary and Core service secret boundary are reused.
- Admin credit reset/grant script and transactional credit ledger primitives are present.
- Public run event state transitions now update the persisted run and its sequence-bearing event log.
- Stop creates an explicit checkpoint and `run.stopped` event.
- Continue returns the existing continued run and never creates duplicate resumed runs for concurrent retries.
- The reaper emits persisted `run.interrupted` events.
- `GET /runs/:id/events` provides SSE replay by sequence through `?after=<seq>` and `Last-Event-ID`, followed by live polling.

## Automated verification

| Check | Result |
|---|---|
| Frontend production build/typecheck | PASS |
| Backend Nest compilation | PASS |
| Core gateway TypeScript typecheck | PASS |
| Backend Jest reliability helpers | PASS (3/3) |
| Prisma migrate deploy | PASS — no pending migrations |
| Backend Nest compilation (final recheck) | PASS |

## Manual end-to-end status

**Not complete as a live browser claim.** Live staging verification has confirmed event and run persistence, but workspace file write-through remains unproven.

Observed live staging evidence:

- Run `c4176156-95ff-4974-94d2-a20e3be1182e` remained `running` with sequence `139` and a fresh heartbeat.
- The live Takumi GH build reached questionnaire, blueprint, and file-writing activity in the authenticated dashboard.
- The internal `write_experiment_artifacts` failure was not visible after the dashboard stream parser was patched.
- Legacy tenant Core credits were reset; `/builder/session` and `/builder/ws-ticket` changed from `403` to `201` against staging.
- Initial live observation showed `ProjectFile` remained `0` while file-writing cards were active; this identified the write-through blocker and led to the staging-only fix below.
- Workspace write-through was subsequently fixed and verified staging-only: 95 text workspace files were synchronized through the Core service boundary; `ProjectFile` became 196 and `FileBlob` became 103 for the staging workspace.

The following scenarios still require a running authenticated deployment and browser/preview access:

1. Takumi GH happy path, including questionnaire, live file/asset progress, verify checklist, tone, and preview.
2. Offline/network-drop replay and duplicate suppression.
3. Reload, sign-out/sign-in, and worker-death auto-reattachment.
4. Stop/Continue checkpoint continuity from `N+1` files.
5. Injected missing-import/missing-provider repair loop `1/3` through success.
6. Credits-drain/pause/reset modal continuation.
7. Two-project parallel isolation and concurrent-run/credit overspend protection.
8. Sandbox deletion and automatic restoration from durable DB files.

Database migration deployment is green. The live browser/runtime scenarios above are not marked PASS without reproducing them against the running application.

## Local reliability recheck — 2026-10-30

- The supplied localhost logs identify the immediate API outage: `RunService.reaper()` ran one interactive Prisma transaction per stale run through an unbounded `Promise.all`. The transaction-start `P2028` rejection escaped the timer callback and terminated the Nest process. The browser's repeated run-event/notification 500s and Core RPC 503 followed that process exit.
- The reaper now handles at most 50 stale runs per sweep, processes them sequentially, conditionally claims stale rows inside the transaction (so heartbeats and other API instances win races), and catches/logs timer failures so a reaper error cannot terminate Nest.
- Workspace file sync now associates changed files with the active run, avoids rewriting unchanged hashes, and writes an `auto` project snapshot after changed files are durable. This makes the existing `project_files`, `file_blobs`, and `project_snapshots` tables participate in the Core sync path.
- Backend `tsc --noEmit` passed. The Core gateway `ts:main` check passed. The focused reliability and Prisma resilience Jest suites passed (8 tests). `git diff --check` passed. The Nest build could not regenerate Prisma's Windows engine because the DLL rename returned `EPERM`; no forced replacement was attempted.
- Local dashboard HTTP returned 200. The Core gateway on `localhost:8080` did not respond during this check, so authenticated build/preview acceptance could not be run. This recheck does not mark the full Section 13 scenario complete. In particular, actual DB restore into a lost Core sandbox, credit-ledger charging/exhaustion, and live run replay remain to be verified and/or wired end to end.
- The user supplied tenant/project ID `990a2e3b-bdb1-4a32-9c57-c50c1aa2dd96` and workspace ID `f5e0abf3-6bc9-4849-bd9a-d0db30f3568a`. The backend now has an additive tenant-to-credit-workspace relation and a conditional migration for exactly this pair; new runs use the mapped workspace, and usage reports/file sync carry that ID. The migration has not applied yet: both Prisma migrate deploy/status failed with an empty schema-engine error, and the direct PostgreSQL client could not resolve the configured Neon host. Until Neon DNS/connection is available and the migration is deployed, the app intentionally falls back to the legacy tenant workspace value.
- After the user started Core, the dashboard, backend DB-readiness endpoint, and Core `/healthz` each returned HTTP 200. A read-only query through the live backend found one run and two events for tenant `990a2e3b-bdb1-4a32-9c57-c50c1aa2dd96`, plus 76 `project_files` rows but zero snapshots. The latest run (`7823b8c5-ed55-425f-9b1c-5e76842cf1a2`) was `interrupted` and had `workspaceId` equal to the tenant ID. The specified workspace `f5e0abf3-6bc9-4849-bd9a-d0db30f3568a` has 40 credits, zero lifetime used, and one grant ledger entry. This confirms file writes are occurring, while the run-to-workspace mapping, heartbeat continuity, and snapshots were not correct for this build.
- The follow-up frontend trace showed transient `ECONNREFUSED`/`ECONNRESET` from Next's rewrite proxy while Nest restarted. `/api/v5` rewrites now run after filesystem routes so the custom proxy handler can recover, retry transient connection failures three times, and return a controlled 502. `dev:all` now supervises and restarts the backend indefinitely while keeping Next alive; `dev:frontend` is available for the frontend-only workflow.
- Frontend `tsc --noEmit` passed after the proxy and dev-script changes.
- The Continue action now calls the persisted `/runs/:id/continue` endpoint, and lease expiry creates an `interrupted` snapshot in the same transaction as the interruption event. Backend typecheck and the focused Jest suites passed again (8 tests). These changes do not retroactively repair the already-interrupted test run.
- Reload reattachment now renews active run heartbeats; transient heartbeat failures retry with short backoff. Active-run lookup includes resumable terminal states, so interrupted runs are visible to the existing Continue card. Continue reads the workspace mapping so resumed runs move onto the correct credit workspace after migration. Backend/frontend/Core typechecks pass, Prisma schema validation passes, and the focused backend suite remains 8/8.

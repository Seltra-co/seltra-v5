# SELTRA V5 — PUBLISH SPEC (FINAL)

**Repo path:** `docs/PUBLISH-SPEC.md` · **Owner:** Willy · **Status:** consolidated authoritative implementation specification · **Date:** 2026-11-05
**Supersedes:** `SELTRA-V5-PUBLISH-SPEC-v2.md` and the "one shared Vercel project" diagram.
**Reference material checked on 2026-11-04:** Vercel Limits (`vercel.com/docs/limits`, page dated 2026-09-16), Vercel REST API docs (create project, create deployment, multi-project platforms), Vercel `git.deploymentEnabled` behaviour, MakerKit Vercel cost analysis (third-party, May 2026; re-verify rates at `vercel.com/pricing`).

This is the sole authoritative publishing and disposable-workspace specification. It consolidates the original specification, accepted Amendment 1 rev 3 decisions, and the current implementation findings. The old amendment file is archival only and is not an implementation dependency. Read this entire document before each phase; implement the phases in §13 in order.

---

## 0. Decisions that are final (do not reopen)

1. **One private GitHub repository per merchant app** in org `Seltra-Cloud` - https://github.com/Seltra-Cloud. Repository privacy is invariant across deployment modes.
2. **One Vercel project per merchant app**, all under **one shared Seltra merchant-app Vercel Pro team**. The shared-single-project alternative is dropped.
3. GitHub is the permanent source of truth. Render's filesystem is never the long-term home of a merchant project.
4. Cloudflare Worker + R2 route pointers serve `<slug>.seltra.co`. Legacy V4 routing and existing production stores are untouched.
5. Existing Next.js dashboard, NestJS Backend, Neon database and V5 Core agent runtime are kept. No wholesale rewrites; additive migrations are allowed. Generated application code executes behind an explicit security boundary, which may be a narrowly integrated sandbox/container or approved remote execution service.
6. Publishing is **real-time and real**: every state the merchant sees is a state recorded by Backend/Core. No simulated progress, no placeholder success.
7. **The Render persistent disk is not a durability dependency.** Workspace execution data uses explicitly ephemeral storage. Existing disk-related code (`DATA_ROOT`, local persistence/fallbacks, migration/restore paths) is preserved until Willy approves its removal (§15), but new persistence, recovery, and application continuity must work with the original workspace and any Render persistent disk absent.
8. **Persistence is separate from publishing.** `PUBLISH_ENABLED=false` disables deployment/public routing only; it never disables source persistence, workspace snapshots, or recovery. `WORKSPACE_PERSISTENCE_ENABLED` and `WORKSPACE_RESTORE_ENABLED` control those responsibilities (§5, §11).
9. **Durable storage is split by responsibility.** GitHub stores permanent app source and history; Neon stores platform records and durable revision references; R2 stores versioned workspace state and supporting recovery artifacts; the runtime filesystem is disposable (§1, §5).
10. **Generated code is untrusted.** Workspace directory separation and Node child processes are not a security boundary. Generated code must execute in an isolated sandbox that cannot access other apps, Core internals, or infrastructure credentials (§9.2).

---

## 1. Confirmed architecture and ownership

| Concern | Owner | Notes |
|---|---|---|
| Publish button, modal, live progress, URL, history, rollback UI | **Dashboard** (Next.js, Vercel) | Reads state only. Holds no infrastructure secrets. |
| Identity, tenant/app ownership, subscription/quota, deployment records, history, commerce APIs, webhooks, payments | **Backend** (NestJS) + **Neon** | System of record for every publish state. |
| Planning, codegen, edit, verify, repair, workspace orchestration, GitHub operations, Vercel orchestration, R2 writes, snapshots, SSE progress stream | **Core** (Render) | Gateway holds infrastructure secrets. Core coordinates the sandbox; it is not durable app storage. Secrets are not passed into generated-code execution. |
| Generated-code execution | **Ephemeral execution sandbox** | A security boundary per app/workspace; implementation mechanism must be selected and verified before production use. Separate Node processes/directories alone do not satisfy this requirement. |
| Durable source and commit history | **GitHub** `Seltra-Cloud/app-<id>` (private) | Branch `main`. |
| Build and runtime of a published app | **Vercel** project `app-<id>` in the merchant-app team | Builds from the pinned commit only. |
| Hostname → deployment routing | **Cloudflare Worker + R2** (`seltra-routes`) | Route pointer = what is "live". |
| Tenant/app/repository/revision/deployment/persistence records | **Backend + Neon** | Durable platform metadata; last saved SHA and snapshot version are recorded and cross-checked. |
| Workspace snapshots and required SQLite/user data | **R2** (`seltra-workspaces`) | Auxiliary durable workspace state; not the source of truth for app source. Snapshot contents and restore contract are specified in §5. |
| Active source checkout, dependencies, build caches, processes, temp files and logs | **Ephemeral execution workspace** | Temporary only; may be destroyed after verified durable save. |
| Merchant commerce data | **Seltra Backend + Neon** | Generated apps never get their own database in the MVP - it will be introduced post MVP |

```
Merchant ─> Dashboard ──(status/history)──> Backend ──> Neon
                │ (start/rollback/unpublish, SSE events)        ▲ progress/finish (internal)
                └────────────────────────> Core gateway ────────┘
                                             │ child RPC (no secrets)   ┌─> GitHub  Seltra-Cloud/app-<id>   (source @ SHA)
                                             │                          ├─> Vercel  project app-<id>        (build @ SHA, immutable URL)
                                             └──────────────────────────┴─> R2 routes/<slug>.json  ──> Worker ──> <slug>.seltra.co
Generated app (on Vercel) ──> Seltra Backend public storefront APIs (merchant-scoped commerce)
```

Three things never to confuse: **source** = GitHub; **execution and builds** = that app's Vercel project; **commerce data and operations** = Backend + Neon.

---

## 2. Invariants (cross-checked; every section below obeys these)

| # | Invariant |
|---|---|
| I1 | Repo ↔ app ↔ Vercel project is 1:1:1. Names: repo `app-<tenantAppId lowercase>`, Vercel project the same name. IDs are stored in Backend. |
| I2 | Repos and projects are created idempotently by Core (`ensureRepo`, `ensureProject`), never by the browser. |
| I3 | A deployment is created **only by Seltra's publish workflow**, by API, **pinned to an exact commit SHA** (§3.3). |
| I4 | Git pushes (including autosave pushes) must not create production deployments. This is enforced in layers (§3.4), and even if a layer fails it cannot change what the public sees, because routing is controlled by the R2 pointer (I5). |
| I5 | "Live" means the R2 route pointer references that app's verified deployment. The pointer is written **only** after build ready + health check passes, and the previous pointer is restored if public verification fails. |
| I6 | Publishing, editing, rolling back or unpublishing one app can only touch that app's repo, Vercel project, route key and Backend rows. |
| I7 | A slug serves exactly one thing: a legacy V4 store **or** a V5 app. Publishing never takes over a slug that a live V4 store is using (§7.4). |
| I8 | Unsaved work is never deleted. Any workspace destruction requires a verified GitHub revision, verified R2 snapshot, and matching Neon durability record. Persistence failure blocks deliberate destruction and is surfaced as failure (§5). |
| I9 | All secrets (GitHub App, Vercel token, R2, master key) exist only on the Core gateway and are stripped from child envs, logs, prompts, repos, generated apps and browser responses (§9). |
| I10 | Feature flags default off. With flags off, the dashboard and Worker behaviour are identical to today. |
| I11 | Render persistent disk is never required for continuity. Old disk code stays in place until Willy approves removal (§15), but the new workspace root is explicitly ephemeral and destructive recovery is proven without prior local files. |
| I12 | No code path may report a state the Backend has not recorded. Backend write first, then SSE emit. |
| I13 | Persistence and restore are independent of `PUBLISH_ENABLED`. A completed/saved edit is not reported durable until GitHub, R2, and Neon agree on its durable versions. |
| I14 | Workspace separation, execution isolation, and ephemeral lifecycle are distinct requirements; passing one does not imply the others (§9.2). |

---

## 3. GitHub + Vercel deployment model

### 3.1 Per-app lifecycle

1. **Retrieve or create the app record** (Backend `TenantApp`).
2. **`ensureRepo`**: create or get private repo `Seltra-Cloud/app-<id>`; initial commit contains the generated source plus the platform-owned `vercel.json` (§3.4) *before* any Vercel project is linked.
3. **`ensureProject`**: create or get Vercel project `app-<id>` in the merchant-app team, linked to that repo, correct root directory (repo root) and framework settings, Deployment Protection per §9.4, function limits per §9.3.
4. **Save source** at a known commit SHA on `main`; record it.
5. **Create deployment** at that SHA via Vercel API, `target: production`, with `meta.seltraDeploymentId`.
6. **Track** Vercel deployment ID, URL/origin, SHA, build status, health status, publication state in Backend.
7. **Activate** the Cloudflare route only after checks pass.

Each app therefore has independently identifiable source, project, deployment history, config and publication lifecycle.

### 3.2 API usage (verified against current docs; re-verify at implementation)

- Create project: `POST /v11/projects` with `name`, optional `framework`, `gitRepository: { type: "github", repo: "Seltra-Cloud/app-<id>" }`. Docs state that when `gitRepository` is set, **pushes to it are automatically deployed** — which is why §3.4 exists. A same-name project returns `409`: call get-project and reuse.
- Create deployment: `POST /v13/deployments` with `project`, `target: "production"`, `gitSource: { type: "github", repoId, ref: "main", sha }`, `meta`. Env var changes must be applied **before** this call.
- List/get deployments for polling and reconciliation; get build events for log lines (endpoint to be confirmed in the spike, §12 U11).
- Documented API rate limits to respect (Pro): create project 100/h, deployments 450/h, 120 per 5 min, 6000/day (Limits page). The multi-project reference page states 1000 deployments/h; **we use the stricter number** until the spike resolves the discrepancy (U12).

### 3.3 Commit pinning

Connecting a repo does **not** guarantee deployment at a chosen commit. Therefore:

- Publish always passes `gitSource.sha` explicitly.
- After the deployment object returns, Core **asserts** `deployment.gitSource.sha === savedSha`. Mismatch → `FAILED/SHA_MISMATCH`, route untouched.
- Backend stores `sourceCommitSha` on the `Deployment` row and Core tags the commit `seltra/dep-<deploymentId>` so the source of every live version is permanent and cannot be garbage-collected.

### 3.4 How production deployment creation is controlled

Layered. The spike (§12, S1–S3) must prove layers 1–3 before P3A is allowed to start.

1. **Platform-owned `vercel.json`** in every repo: `{ "git": { "deploymentEnabled": false } }`, committed in the **first** commit, before the project is linked. Core's pre-push validator rejects any commit that removes or changes that key (agents/merchants cannot edit it; other `vercel.json` keys are allow-listed, §9.3). Known caveats from Vercel community reports, to be tested not assumed: setting it in the same push that first introduces it may still create a deployment; and one report says disabling Preview branch tracking made the setting be ignored — keep branch tracking **enabled**. Do **not** use Ignored Build Step "Don't build anything": it cancels API-created deployments too.
2. **Pinned API deployments** (§3.3) are the only intended deployments; each carries `meta.seltraDeploymentId`.
3. **Unexpected-deployment detector** (Core job every 5 min, plus Vercel webhook `deployment.created` if configured): any deployment in a merchant project without a matching active Backend row is cancelled if still queued/building, recorded as `DEPLOYMENT_BLOCKED`, and alerted. Cost is capped; public traffic is unaffected.
4. **Routing independence**: unintended deployments cannot go live because only the publisher writes `routes/<slug>.json`.

**Fallbacks inside the confirmed architecture** (use only if the spike shows layer 1 is unreliable; Codex must report the spike result to Willy and wait for a decision):
- **B:** create the project *without* `gitRepository` and deploy with `gitSource` (`org`/`repo`/`ref`/`sha` form) — only if the spike proves that works with the team's GitHub connection.
- **C:** Tarball deployment is not an approved fallback because it bypasses the private GitHub repository deployment flow. Do not implement or use it without a new written architecture decision.

---

## 4. Supported frameworks and honest meaning of "full-stack"

| Template | Detection | Vercel framework | MVP status |
|---|---|---|---|
| Vite SPA (`react`) | `vite` dependency, no `nitro` | `vite`, output `dist` | Supported |
| Next.js | `next` dependency | `nextjs` | Supported after a passing template build |
| Vite+Nitro, Portal mini-store | template-specific | — | `UNSUPPORTED_FRAMEWORK` until independently verified |

MVP "full-stack" means a generated Vite SPA or Next.js app that calls the public Seltra Backend storefront APIs for commerce and data. Next.js route handlers may run on Vercel but may not hold secrets or durable data. A Vite SPA has no server code of its own. Anything needing private server logic is a Backend feature. UI and marketing copy must describe these limits.

Generated apps use only the public storefront API surface. Backend authorizes by tenant and customer session where applicable. Merchant-admin operations require the merchant's authenticated dashboard session. Public build variables are `VITE_SELTRA_API_URL=PUBLISH_PUBLIC_API_URL` and `VITE_SELTRA_STORE_SLUG=<slug>`; verify the scaffold's expected `/api/v5` suffix in D0. Next templates use only the public `NEXT_PUBLIC_*` variables they actually read. No secrets are ever passed as build variables.

Platform-owned Vercel configuration: Vite receives `{ "git": { "deploymentEnabled": false }, "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`; Next.js receives `{ "git": { "deploymentEnabled": false } }`. The pre-push validator rejects changes to the platform-owned Git key, crons, storage configuration and keys outside the allow-list in §9.3. Spike S5 must verify static assets and deep links. Per-app databases, background workers/cron, Vercel storage and arbitrary private server logic are outside MVP scope.

---

## 5. Workspace and durable source lifecycle

### 5.1 Required lifecycle

1. Retrieve the durable app and workspace records from Backend/Neon, including repository identity, last saved SHA and snapshot version.
2. Create an empty workspace on explicitly ephemeral storage and acquire the app/workspace restore lock.
3. Restore the SQLite/user data snapshot from R2, validate its version and integrity, then clone each private app repository from GitHub at the recorded SHA. Reconcile the restored state against Neon before starting agent work.
4. Run the existing agent orchestration while generated application code executes inside the approved isolated sandbox (§9.2).
5. At each durable save boundary, quiesce writes; commit and push source; verify the exact GitHub SHA; upload and verify the R2 snapshot; then record both versions in Neon. Return “saved” only after all three stores agree.
6. Publishing is a separate optional action: when enabled, deploy the exact saved GitHub SHA through that app's Vercel project (§6).
7. Stop the sandbox and delete the ephemeral workspace only after the durable-save contract is verified. On persistence failure, retain the active workspace when possible, report failure, and do not mark it safe to destroy.
8. When the merchant returns, restore from GitHub + Neon + R2 on any eligible fresh Core instance; no previous local file may be required.

### 5.2 Durable storage contract

| Store | Durable responsibility | Must not be treated as |
|---|---|---|
| **GitHub** | Permanent app source, commit history, and saved application versions; one private `Seltra-Cloud` repository per app. | Workspace database, deployment state, or a public Hobby workaround. |
| **Neon** | Tenant/app ownership, repository identity, last saved source SHA, snapshot version/checksum, persistence status, deployment records/history, and safe-to-destroy status. | Application source files or ephemeral execution data. |
| **R2** | Versioned workspace snapshots, required SQLite user data (chats/apps/versions/settings if retained), app-to-revision manifest, and encrypted supporting runtime state. | The permanent source of truth for application code. |
| **Ephemeral workspace/sandbox** | Active checkout, runtime processes, dependencies, caches, builds, temp files and logs. | Any required recovery or continuity copy. |
| **Render persistent disk** | None. | A fallback or prerequisite for recovery. |

R2 snapshot consistency requirements: obtain SQLite data with the database's online backup API; quiesce/coordinate app metadata writes while collecting the app-to-SHA manifest; write an immutable versioned bundle first; verify its size and SHA-256 after upload; write the manifest/pointer last; and only then record the snapshot version/checksum in Neon. The manifest binds `workspaceKey`, snapshot version, creation time, bundle key/checksum, app IDs, repo identities and exact GitHub SHAs, and encrypted runtime state. Restore validates key ownership, supported format version, checksum and every referenced GitHub revision before marking the workspace active. Secrets/runtime keys are encrypted with AES-256-GCM and keys derived by HKDF-SHA256 from `WORKSPACE_MASTER_KEY` with `workspaceKey` as salt. Retain prior verified snapshots according to §5.3; never prune the only Neon-referenced valid snapshot. Dependencies and build output are not durable and are reinstalled lazily.

### 5.3 Core modules (as in v2, unchanged in intent)

- **`github/`**: installation token via the GitHub App (JWT RS256); `ensurePrivateRepo`, `pushApp`, `cloneApp`. Repositories remain private in every mode. Token is passed as a one-off HTTP header, never written to `.git/config`, logs or execution sandbox env. Pre-push scan blocks secrets and enforces platform-file and size checks (§9.3).
- **`snapshot/`**: consistent SQLite `.backup()` via child RPC `snapshotUserData`; exclude logs/caches/reinstallable files; upload immutable versioned bundle; verify uploaded bytes/checksum; write manifest/pointer last; record snapshot version in Neon only after verification. `restore(workspaceKey)` validates the snapshot/manifest and Neon versions, unwraps the key, and clones apps at the recorded GitHub SHAs. A wrong master key or stale/mismatched revision fails safely.
- **Durability coordinator**: idempotent save operation/journal with a stable operation ID, explicit `PERSISTING`/`DEGRADED`/`SAFE_TO_DESTROY` states, retries/reconciliation after partial failure, and a Neon record containing the GitHub SHA and R2 snapshot version/checksum. No operation reports success until GitHub, R2 and Neon agree.
- **Child RPCs** (`core/src/seltra_publish/`): `snapshotUserData()`, `commitWorkingTree({appId, author, operationId})` (if dirty: `git add -A`, commit, return HEAD SHA; scaffold `.gitignore` must exclude `node_modules`, `dist`, `.next`, `out`, `.env*`). The gateway supplies explicit publish identity; the child never reads publish env variables. Every saved/publish commit uses a stable operation ID and `Seltra-Turn`/`Seltra-State` trailers; retries reuse the recorded SHA and never create a second logical save commit.

### 5.4 Save-point triggers and completed-work contract

Persist after each completed agent turn, explicit user save, before a publish reads source, before any idle eviction/stop, and during graceful shutdown. Periodic checkpoints reduce loss during long turns. A completed-turn acknowledgement must wait for its required source commit and durable metadata checkpoint; it must not report “saved” while an asynchronous save is pending. If this adds latency, expose a truthful saving state. Shutdown persistence is best effort only and is not the durability guarantee; the latest completed save must already be durable before shutdown begins. A hard kill can interrupt an in-flight edit, but cannot invalidate the previous verified save. `WORKSPACE_PERSISTENCE_ENABLED` and `WORKSPACE_RESTORE_ENABLED` are independent of `PUBLISH_ENABLED` (§11).

### 5.5 Edge cases (normative)

| Situation | Behaviour |
|---|---|
| **Completed changes** | Persist = commit + push + verify + snapshot + verify + Neon version record. Commit message carries stable operation ID plus `Seltra-Turn: <id>` and `Seltra-State: complete|interrupted`. Only after the Neon record is committed may the operation be reported durable. |
| **Interrupted agent run** (crash, deploy, disconnect) | On SIGTERM/idle, the working tree is committed with `Seltra-State: interrupted` and pushed. On restore the agent is told the last run was interrupted. Publishing an interrupted commit is allowed; a bad build fails safely (I5). |
| **Publish during an agent run** | Rejected `409 AGENT_RUN_ACTIVE`. Publish never snapshots a half-written tree. |
| **Concurrent editing** | One writer per app via a Backend-owned edit lease (`holderSessionId`, `expiresAt`, renewed by heartbeat). A second tab/device gets `409 EDIT_LOCKED` and read-only view. Pushes are **fast-forward only, never force**. If the remote has commits the workspace lacks (`SOURCE_DIVERGED`), Core fetches and rebases if clean; otherwise it stops, marks the app `persistenceStatus=DEGRADED`, alerts, and keeps the workspace. |
| **Dependency caches** | Lockfile is committed; `node_modules` and caches are never in Git or snapshots. Losing a cache only costs install time. If D0 shows duplicated `node_modules` dominates disk, a shared package store is proposed to Willy **before** any installer/package-manager change. |
| **GitHub, R2, or Neon failure** | Idempotently retry/reconcile; log with redaction; mark `persistenceStatus=DEGRADED`; alert; **block all deliberate workspace destruction**; reject “saved”/publish with `SOURCE_NOT_SAVED`. Keep the active workspace if it remains available. |
| **Partial save / interrupted process** | Recover by operation ID: inspect GitHub refs, immutable R2 bundle/manifest and Neon journal; finish the missing metadata step or leave the operation degraded. Never advance the Neon durable pointer to an unverified object or SHA. |
| **Restore failure** | `WORKSPACE_RESTORE_FAILED`; do not silently start an empty workspace or fall back to a local disk copy; surface an actionable error and alert. A fresh instance may retry from durable stores. |
| **Workspace destruction** | Eligible only after no edit/publish/restore lock and Neon says `SAFE_TO_DESTROY` for a verified GitHub SHA and R2 snapshot version/checksum. Any persistence failure, timeout, or ambiguity blocks deliberate destruction. |

### 5.6 Workspace states and capacity

`ACTIVE ? IDLE ? PERSISTING ? SAFE_TO_DESTROY ? EVICTED` and `EVICTED ? RESTORING ? ACTIVE`. Restore runs under a per-workspace lock; concurrent requests wait. Status `WORKSPACE_RESTORING`, `PERSISTING`, `DEGRADED` and `CAPACITY` (503) are structured and shown in the UI with automatic retry. `MAX_ACTIVE_WORKSPACES` queues the rest with a visible position. Capacity checks use the explicit ephemeral workspace root; no check or recovery path assumes a Render persistent mount. Expose ephemeral capacity, active/evicted counts and last persist failure on `/healthz`. Core must not require sticky routing; workspace jobs and durable state can resume on another instance. Build for 1,000 registered/active MVP users, not 1,000 simultaneous builds, using queue fairness, configurable concurrency, backpressure, idempotent retries, timeouts/cancellation, usage/cost tracking, provider abstractions, observability and lazy restore.

### 5.7 Ephemeral workspace disposal modes

`WORKSPACE_EVICTION_MODE` = `off` | `shadow` | `enforce`, default **`shadow`**.
- **shadow:** persist, verify, restore into a scratch directory, compare durable state, delete only the scratch copy, and log "would evict".
- **enforce:** real deletion of the ephemeral workspace only after the Neon `SAFE_TO_DESTROY` record matches the verified GitHub SHA and R2 snapshot version. Enable only after architecture drills D16–D24 and existing safety drills pass.
- `DISK_STOPGAP_ENABLED` remains `false` until Willy decides otherwise. It may remove reinstallable data only; it must never be used to free or replace required merchant state. No path may use a Render persistent disk as a recovery fallback.

---

## 6. Publish lifecycle

### 6.1 Sequence (Core orchestrator; each step records to Backend first, then emits an event)

**Save source → deploy → wait for readiness → health-check → activate route → verify public hostname.**

| Step | Status | Action | Failure → |
|---|---|---|---|
| 0 | `QUEUED` | `begin`: ownership, quota, slug and V4 conflict checks, idempotency. Enter the global publish queue. | 403 / 409 / 422 / 429 |
| 1 | `PREPARING_WORKSPACE` | Restore workspace if evicted. Reject if agent run active. | `WORKSPACE_RESTORE_FAILED`, `AGENT_RUN_ACTIVE` |
| 2 | `SAVING_SOURCE` | `commitWorkingTree` → SHA; validator + secret scan; `ensureRepo`; push; `ls-remote` verify; tag; `push-result`. | `SECRET_DETECTED`, `GITHUB_PUSH_FAILED`, `SOURCE_DIVERGED`, `UNSUPPORTED_FRAMEWORK` |
| 3 | `BUILDING` | `ensureProject`; sync public env vars; `createDeployment` at SHA; assert SHA; stream/poll until `READY`. | `VERCEL_ERROR`, `BUILD_FAILED` (+ redacted log tail), `DEPLOY_TIMEOUT`, `VERCEL_RATE_LIMITED` |
| 4 | `VERIFYING` | Health-check the **immutable deployment origin** (§6.2). | `HEALTHCHECK_FAILED` |
| 5 | `ACTIVATING` | Copy current route to `routes/<slug>.prev.json`; write `routes/<slug>.json`; verify the **public hostname** (§6.3). If it fails: restore previous route (or delete if none). | `ROUTE_WRITE_FAILED`, `HOSTNAME_VERIFY_FAILED` |
| 6 | `LIVE` | `finish(LIVE)`: previous live → `SUPERSEDED`; update app fields; record timings. | — |

Until step 5 writes the route, the live site is untouched. A failure at any step calls `finish(FAILED, code)` and changes nothing else.

### 6.2 Health check (before activation)

On `https://<vercelOrigin>/`: up to 5 attempts, 5 s apart, each with a 10 s timeout. Pass when HTTP 200, `content-type` HTML, body ≥ 200 bytes, no `x-vercel-error` header. Configurable extra paths (`HEALTH_PATHS`, default `["/"]`). Result recorded as `healthStatus` and `healthCheckedAt`; `verifiedAt` set on pass.

### 6.3 Public hostname verification (after activation)

`GET https://<slug>.<rootDomain>/` returns 200 and `x-seltra-deployment` equals the activating `Deployment.id` (opaque Backend id, not a Vercel id). Retry up to 60 s (Worker route cache is 5 s per isolate). Failure restores the previous route and fails the publish.

### 6.4 Crash recovery

Steps are idempotent (push is a no-op at the same SHA; deployment is found by `meta.seltraDeploymentId` before creating; route write is last-writer-safe under the per-app lock). On Core start, non-terminal deployments are **resumed** from the last recorded stage; if a stage cannot be resumed, mark `FAILED/CORE_RESTARTED`. Stuck deployments older than 20 minutes become `FAILED/TIMEOUT` and release the per-app lock.

### 6.5 Rollback (per-app)

Eligible target: a deployment of **the same app** with `verifiedAt` set, stored `vercelOrigin`, status `SUPERSEDED` or `LIVE`, still present in Vercel (get-deployment returns `READY`). Procedure: `begin(kind=ROLLBACK, rollbackSourceId)` creates a new row referencing the same Vercel deployment → health-check the target origin → write `prev.json` and the route → public verification → `finish(LIVE)`. Any failure restores the previous route and leaves the live version unchanged. Rollback never changes GitHub `main`: the editor keeps the newest source while the live site shows the older version; the UI says so. Vercel deployment retention must be confirmed so targets are not auto-deleted (U5); Seltra keeps the last 10 verified deployments per app.

### 6.6 Unpublish

`unpublish/begin` (ownership check, status `UNPUBLISHING`) → Core deletes `routes/<slug>.json` → verifies the hostname no longer serves `x-seltra-deployment` → `unpublish/finish`: `publicationStatus=UNPUBLISHED`, `liveDeploymentId=null`; `lastKnownGoodDeploymentId` is retained so the merchant can re-publish the last verified version without rebuilding. Repo and Vercel project are kept (hard delete is "Later").

### 6.7 Real-time progress

- **Source of truth:** Backend `Deployment` + `PublishEvent` rows (monotonic `seq`).
- **Push channel:** Core `GET /api/publish/:deploymentId/events` (SSE; same auth as `/api/rpc`; ownership verified with Backend). On connect: send the Backend snapshot, then live events. Supports `Last-Event-ID` resume; heartbeat every 15 s.
- **Events:** `stage {seq,status,message,ts}`, `log {line}` (redacted, throttled build-log lines when the Vercel events stream is available), `done {outcome,errorCode?}`.
- **Fallback:** if SSE fails, the dashboard polls Backend `GET …/publish/status` every 2 s. Refreshing or reopening mid-publish resumes at the true stage.
- **No fake percentages.** The UI shows real stages, real elapsed time from recorded timestamps, and queue position when queued.
- Optional later optimisation: Vercel deployment webhooks to reduce polling.

### 6.8 Queues and concurrency

Per app: one active publish (Backend `TenantApp.activePublishId`, set by compare-and-set in a transaction). Per tenant: `PUBLISH_MAX_PER_HOUR`. Global: `PUBLISH_MAX_CONCURRENT` (default 3) and a rolling Vercel budget `VERCEL_DEPLOYS_PER_HOUR_BUDGET` (default 300, leaving headroom under 450/h; also respects 120 per 5 min and 6000/day). Excess publishes wait in `QUEUED` with a visible position. Vercel `429` → exponential backoff honouring retry headers. Do not assume all merchants build at once; also do not assume Vercel's default concurrent-build allowance equals the Pro "up to 500" on-demand figure (U7).

---

## 7. Cloudflare routing

### 7.1 Route pointer (R2 bucket `seltra-routes`)

`routes/<slug>.json`: `{ "slug": "<slug>", "tenantId": "<tenantId>", "appId": "<tenantAppId>", "origin": "<deployment host>.vercel.app", "deploymentId": "<Seltra Deployment.id>", "vercelDeploymentId": "<dpl_…>", "sha": "<sha>", "updatedAt": "<iso>" }`.
This format is new and authoritative: the existing Worker has no R2 binding and no route bucket/format exists in the repository. Route ownership fields are mandatory. The Worker ignores ownership fields; Core enforces them before writes/deletes. R2 keys are under `routes/` and workspace snapshots under `workspaces/`; a single bucket is allowed when both prefixes share one bucket.

### 7.2 Worker behaviour

| Case | Behaviour |
|---|---|
| Host not under `seltra.co` | Pass through unchanged. |
| Reserved subdomain, invalid slug, dotted subdomain | Legacy path, unchanged. |
| Slug with valid route | Proxy to `https://<origin>` preserving path and query. |
| **Unpublished / missing route record** | Legacy path (shared app `/store/<slug>`), which shows "not published" (redirect-loop fix, §10). |
| **Invalid route JSON, origin not matching `*.vercel.app`, or `slug` field ≠ requested slug** | Ignored; treated as missing. |
| **Upstream failure** (fetch throws, Vercel infra error header with 5xx, `DEPLOYMENT_NOT_FOUND`) | Generic branded `503`, `no-store`, `retry-after`. Never falls back to legacy for a slug that has a route (would serve wrong content). No upstream URLs in the body. |
| **Stale deployment** (Vercel deleted it) | Same `503`; reconciler flags the app and Backend alerts. |
| **Redirects** | `redirect: 'manual'`; `Location` pointing at the origin host is rewritten to the public host. |
| **Cookies** | `Domain=` stripped from every `Set-Cookie`. |
| **Header hygiene** | Inbound `x-vercel-*` and `x-seltra-*` request headers from clients are dropped; response `x-vercel-*` and `x-matched-path` are removed; `x-seltra-deployment` carries only the opaque Seltra id. No secrets or private metadata leave the Worker. |
| **Cache** | Route lookups cached 5 s per isolate (R2 reads are cheap; tune if cost shows otherwise). |

### 7.3 Worker (`seltra-web/edge/subdomain-router/worker.js`)

```javascript
const ROOT_DOMAIN = 'seltra.co'
const VERCEL_APP = 'seltra-merchant.vercel.app'

const RESERVED = new Set([
  'www', 'web', 'api', 'admin', 'app', 'mail', 'send',
  'dashboard', 'login', 'auth', 'status', 'help', 'support', 'blog', 'cdn', 'assets', 'static',
])

// Legacy behaviour: these never get the /store/{slug} prefix.
const STATIC_PREFIXES = ['/_next/', '/favicon.ico', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml']

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
const ORIGIN_RE = /^[a-z0-9][a-z0-9-]*\.vercel\.app$/
const DEPLOY_ID_RE = /^[A-Za-z0-9_-]{6,80}$/
const ROUTE_TTL_MS = 5000
const ROUTE_CACHE_MAX = 500
const routeCache = new Map()

async function getRoute(env, slug) {
  const now = Date.now()
  const hit = routeCache.get(slug)
  if (hit && now - hit.t < ROUTE_TTL_MS) return hit.v
  let v = null
  try {
    const obj = await env.ROUTES.get(`routes/${slug}.json`)
    if (obj) {
      const r = await obj.json()
      const ok = r
        && ORIGIN_RE.test(String(r.origin || ''))
        && DEPLOY_ID_RE.test(String(r.deploymentId || ''))
        && (r.slug === undefined || r.slug === slug)
      if (ok) v = r
    }
  } catch (_) {
    v = null
  }
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.clear()
  routeCache.set(slug, { v, t: now })
  return v
}

function unavailable() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Temporarily unavailable</title>' +
      '<body style="font-family:system-ui;text-align:center;padding:4rem">' +
      '<h1>This store is temporarily unavailable</h1><p>Please try again in a moment.</p></body>',
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '10' } },
  )
}

async function proxyToMerchant(request, url, host, route) {
  const originPrefix = `https://${route.origin}`
  const req = new Request(`${originPrefix}${url.pathname}${url.search}`, request)
  for (const k of [...req.headers.keys()]) {
    if (k.startsWith('x-vercel-') || k.startsWith('x-seltra-')) req.headers.delete(k)
  }
  req.headers.set('X-Forwarded-Host', host)
  req.headers.set('X-Forwarded-Proto', 'https')

  let res
  try {
    res = await fetch(req, { redirect: 'manual' })
  } catch (_) {
    return unavailable()
  }

  const vErr = res.headers.get('x-vercel-error')
  if (vErr && (res.status >= 500 || vErr === 'DEPLOYMENT_NOT_FOUND')) return unavailable()

  const out = new Response(res.body, res)
  for (const k of [...out.headers.keys()]) {
    if (k.startsWith('x-vercel-') || k === 'x-matched-path') out.headers.delete(k)
  }
  out.headers.set('x-seltra-deployment', route.deploymentId)

  const loc = out.headers.get('location')
  if (loc && loc.startsWith(originPrefix)) {
    out.headers.set('location', `https://${host}${loc.slice(originPrefix.length)}`)
  }

  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  if (cookies.length) {
    out.headers.delete('set-cookie')
    for (const c of cookies) out.headers.append('set-cookie', c.replace(/;\s*domain=[^;]*/i, ''))
  }
  return out
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const host = url.hostname.toLowerCase()

    if (!host.endsWith(`.${ROOT_DOMAIN}`)) return fetch(request)

    const subdomain = host.slice(0, -(ROOT_DOMAIN.length + 1))
    const isReserved = RESERVED.has(subdomain) || subdomain.includes('.')
    const isStaticAsset = STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))

    // NEW: published app on its own Vercel deployment
    if (!isReserved && env.ROUTES && SLUG_RE.test(subdomain)) {
      const route = await getRoute(env, subdomain)
      if (route) return proxyToMerchant(request, url, host, route)
    }

    // LEGACY (unchanged): shared Vercel app
    const targetPath = (isReserved || isStaticAsset)
      ? url.pathname
      : `/store/${subdomain}${url.pathname === '/' ? '' : url.pathname}`
    const originRequest = new Request(`https://${VERCEL_APP}${targetPath}${url.search}`, request)
    originRequest.headers.set('X-Forwarded-Host', host)
    return fetch(originRequest)
  },
}
```
P3B must verify: the exact list of `x-vercel-*` headers Vercel emits, the `x-vercel-error` values, and that response streaming and `HEAD`/`204`/`304` bodies are handled. Before deploying, confirm no existing `Tenant.slug` collides with the reserved words.

### 7.4 V4 coexistence and authorization (I7)

Slug is unique per `Tenant`; the in-database V4/V5 collision is the same tenant's existing live V4 store being replaced on first V5 publish. Cross-database test-tenant collisions are prevented by the always-on protected slug list and route ownership.

Backend `LegacyStoreGuard.isLive(tenant)` returns `LIVE | NOT_LIVE | UNKNOWN`. Do not guess the live predicate. In `team` mode, `UNKNOWN` fails closed with `422 V4_GUARD_NOT_CONFIGURED`; in `hobby`, `UNKNOWN` is allowed with a warning, with protected slugs still applied. If `LIVE`, `publish/begin` requires `confirmReplaceLegacy: true`; otherwise return `409 LEGACY_STORE_LIVE_CONFIRMATION_REQUIRED`. The dashboard must explain what will be replaced and that unpublish restores the legacy page. Unpublish deletes only the V5 route and never modifies V4 data. Slug rename writes and verifies the new route before deleting the old route.

Authorization is tenant owner only (`ownerId`); no role model exists, so do not invent one. Existing Core `Publication` and Dyad-inherited user-token GitHub/Vercel/Cloudflare handlers remain untouched and unused by this publishing path.

---

## 8. Backend records and API contracts

Inspect real Prisma models first (names below follow v2: `Tenant`, `TenantApp`); extend, do not duplicate. **Additive changes only; run on the Neon migration branch first.** If `prisma/migrations/` exists create a migration, else report that `db push` is used.

### 8.1 Records

`TenantApp` (additive fields where absent): `githubRepoId`, `githubRepoFullName`, `githubRepoVisibility` (must be PRIVATE), `githubDefaultBranch @default("main")`, `lastPushedSha`, `lastPushedAt`, `lastPushError`, `sourceState` (`COMPLETE|INTERRUPTED`), `persistenceStatus` (`OK|PENDING|DEGRADED`), `lastSnapshotVersion`, `lastSnapshotChecksum`, `vercelProjectId`, `vercelProjectName`, `publicationStatus` (`UNPUBLISHED|PUBLISHED|UNPUBLISHING`), `liveDeploymentId`, `lastKnownGoodDeploymentId`, `activePublishId @unique`, `workspaceStatus` (`ACTIVE|IDLE|PERSISTING|SAFE_TO_DESTROY|EVICTED|RESTORING|DEGRADED|FAILED`), `lastSnapshotAt`. Existing `publishedUrl` and `lastCommitSha` are reused: `lastCommitSha` = SHA of the **live** deployment; `lastPushedSha` = latest **saved** source (they differ after edits or rollback).

Every `Deployment` also records `deployMode` and `repoVisibility`; merchant app visibility is PRIVATE in every mode. Add a durable persistence-operation journal with a stable unique `operationId`, tenant/app/workspace IDs, turn ID, state, exact GitHub SHA, R2 snapshot version/key/checksum, attempt count, redacted last error, and verified/completed timestamps. Journal transitions are idempotent and are the source for `SAFE_TO_DESTROY`. No local file or process-memory map is the only copy of a completed operation.

```prisma
enum DeploymentStatus { QUEUED PREPARING_WORKSPACE SAVING_SOURCE BUILDING VERIFYING ACTIVATING LIVE FAILED SUPERSEDED DISABLED }
enum DeploymentKind   { PUBLISH ROLLBACK }
enum PersistenceOperationStatus { PENDING SOURCE_VERIFIED SNAPSHOT_VERIFIED COMPLETE DEGRADED }

model Deployment {
  id                   String           @id @default(cuid())
  tenantId             String
  tenantAppId          String
  slug                 String
  kind                 DeploymentKind   @default(PUBLISH)
  status               DeploymentStatus @default(QUEUED)
  idempotencyKey       String?
  triggeredByUserId    String
  sourceCommitSha      String?
  vercelProjectId      String?
  vercelDeploymentId   String?
  vercelOrigin         String?          // immutable deployment host
  healthStatus         String?          // PASSED | FAILED
  healthCheckedAt      DateTime?
  verifiedAt           DateTime?        // passed health check (rollback-eligible)
  publicVerifiedAt     DateTime?        // public hostname confirmed
  rollbackSourceId     String?          // for kind=ROLLBACK
  previousDeploymentId String?
  errorCode            String?
  errorMessage         String?
  buildLogTail         String?          // redacted, max 8 KB
  lastEventSeq         Int              @default(0)
  timings              Json?            // { queuedMs, workspaceMs, savedMs, buildMs, verifyMs, activateMs, totalMs }
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt
  liveAt               DateTime?
  finishedAt           DateTime?

  @@unique([tenantAppId, idempotencyKey])
  @@index([tenantAppId, createdAt])
  @@index([slug, status])
}

model PublishEvent {
  id           String   @id @default(cuid())
  deploymentId String
  seq          Int
  status       DeploymentStatus
  message      String?
  data         Json?
  createdAt    DateTime @default(now())
  @@unique([deploymentId, seq])
}

model WorkspacePersistenceOperation {
  id                    String   @id @default(cuid())
  operationId           String   @unique
  tenantId              String
  tenantAppId           String?
  workspaceKey          String
  turnId                String?
  status                PersistenceOperationStatus @default(PENDING)
  sourceSha             String?
  snapshotVersion       String?
  snapshotKey           String?
  snapshotSha256        String?
  attempts              Int      @default(0)
  lastErrorCode         String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  verifiedAt            DateTime?
  completedAt           DateTime?
  @@index([workspaceKey, createdAt])
  @@index([tenantAppId, status])
}
```

### 8.2 Internal Backend endpoints (`CoreServiceGuard`, existing core-internal prefix)

Publish/deployment endpoints return `404` when `PUBLISH_ENABLED !== 'true'`. Workspace persistence endpoints are separately controlled by `WORKSPACE_PERSISTENCE_ENABLED` and `WORKSPACE_RESTORE_ENABLED` and remain available when publishing is disabled. They require the Core service guard, validate tenant/workspace/app ownership, and persist journal transitions before Core reports success.

| Endpoint | Contract |
|---|---|
| `POST core-internal/publish/begin` `{ userId, workspaceKey, coreAppId, kind, rollbackSourceId?, idempotencyKey, confirmReplaceLegacy? }` | Verify `tenant.ownerId === userId` and workspace-key match → else `403`. `429 QUOTA_EXCEEDED` over configured quotas. `422 SLUG_PROTECTED` for protected slug; apply the LegacyStoreGuard rules in §7.4. `409 SLUG_CONFLICT_V4` for cross-tenant ownership. `409 PUBLISH_IN_PROGRESS` returns the existing `deploymentId` (stale > 20 min becomes `FAILED/TIMEOUT`). Same `idempotencyKey` → same `deploymentId`, `200`. Creates `Deployment(QUEUED)` and sets `activePublishId` by compare-and-set. Returns `{ deploymentId, reused, slug, rootDomain, github:{repoId,fullName}, vercel:{projectId,projectName}, current:{deploymentId,vercelOrigin}, rollbackTarget? }`. For rollback, validates the target (same app, `verifiedAt`, origin, status) → else `422 ROLLBACK_TARGET_INVALID`. |
| `POST core-internal/publish/progress` `{ deploymentId, seq, status, message?, patch? }` | Appends a `PublishEvent`, updates status and allow-listed patch fields (`sourceCommitSha`, `vercelDeploymentId`, `vercelOrigin`, ids, `healthStatus`, `verifiedAt`, `timings`). A `seq` ≤ `lastEventSeq` is acknowledged as `{ ignored: true }` (idempotent); a status regression is rejected `409`. |
| `POST core-internal/publish/finish` `{ deploymentId, outcome, errorCode?, errorMessage?, buildLogTail? }` | `LIVE`: set `LIVE`/`liveAt`/`publicVerifiedAt`; previous live → `SUPERSEDED`; set `liveDeploymentId`, `lastKnownGoodDeploymentId`, `publishedUrl`, `lastCommitSha`, `publicationStatus=PUBLISHED`. `FAILED`: record error; **nothing else changes**. Always clears `activePublishId`. Repeating the same outcome is a no-op `200`; a conflicting outcome is `409`. |
| `POST core-internal/publish/unpublish/begin` / `…/finish` `{ coreAppId, userId, idempotencyKey }` | Ownership check → `UNPUBLISHING`; finish clears live fields as in §6.6. |
| `POST core-internal/github/push-result` `{ coreAppId, sha, kind, error? }` | Update `lastPushedSha/At/Error`, `sourceState`, `persistenceStatus`. |
| `POST core-internal/workspace/state` `{ coreAppId, workspaceStatus, snapshotAt? }` | Update workspace status fields. |
| `POST core-internal/workspace-persistence/begin` `{ operationId, userId, workspaceKey, coreAppId?, turnId? }` | Idempotently create/retrieve journal operation; set workspace/app to `PERSISTING`; conflicting owner/workspace mapping is rejected. |
| `POST core-internal/workspace-persistence/source-verified` `{ operationId, sourceSha }` | Record the exact GitHub SHA only after `ls-remote` confirms it; retries with the same SHA are no-ops, a different SHA conflicts. |
| `POST core-internal/workspace-persistence/snapshot-verified` `{ operationId, snapshotVersion, snapshotKey, snapshotSha256 }` | Record only after the uploaded R2 object is read back and checksum-verified. |
| `POST core-internal/workspace-persistence/complete` `{ operationId }` | Transition to `COMPLETE`; update last saved SHA/snapshot metadata and `workspaceStatus=SAFE_TO_DESTROY` only when both verified versions are present. |
| `POST core-internal/workspace-persistence/degraded` `{ operationId, errorCode }` | Redacted failure record; set persistence/workspace degraded. Never set `SAFE_TO_DESTROY`. |
| `GET core-internal/workspace-persistence/:workspaceKey` | Return the last completed durable source SHA, snapshot version/checksum and unresolved operations. Used during fresh restore/reconciliation. |

### 8.3 Frontend-facing Backend endpoints (JWT + ownership)

`GET seltra/store/publish/status?appId=` → `{ enabled, publicationStatus, liveUrl, live, current, queuePosition?, workspaceStatus, persistenceStatus, recent[10] }`.
`GET seltra/store/publish/deployments?appId=&limit=&cursor=` → deployment history with status, SHA, timestamps, `verifiedAt`, `rollbackEligible`.
`GET seltra/store/publish/deployments/:id?sinceSeq=` → deployment plus events since `seq`.

### 8.4 Core gateway endpoints (browser-facing; same auth as `/api/rpc/...`; `404` when disabled)

| Endpoint | Behaviour |
|---|---|
| `POST /api/publish/start { appId, idempotencyKey }` | `202 { deploymentId }`, runs in the background. |
| `POST /api/publish/rollback { appId, deploymentId, idempotencyKey }` | `202 { deploymentId }` (new ROLLBACK row). |
| `POST /api/publish/unpublish { appId, idempotencyKey }` | `202`. |
| `GET /api/publish/:deploymentId/events` | SSE per §6.7. |

Error envelope everywhere: `{ code, message, retryable, deploymentId? }`. Codes: `AGENT_RUN_ACTIVE`, `EDIT_LOCKED`, `PUBLISH_IN_PROGRESS`, `QUOTA_EXCEEDED`, `SLUG_CONFLICT_V4`, `UNSUPPORTED_FRAMEWORK`, `SECRET_DETECTED`, `SOURCE_NOT_SAVED`, `SOURCE_DIVERGED`, `GITHUB_PUSH_FAILED`, `WORKSPACE_RESTORE_FAILED`, `WORKSPACE_RESTORING`, `CAPACITY`, `VERCEL_ERROR`, `VERCEL_RATE_LIMITED`, `SHA_MISMATCH`, `BUILD_FAILED`, `DEPLOY_TIMEOUT`, `HEALTHCHECK_FAILED`, `ROUTE_WRITE_FAILED`, `HOSTNAME_VERIFY_FAILED`, `ROLLBACK_TARGET_INVALID`, `DEPLOYMENT_BLOCKED`, `CORE_RESTARTED`, `BACKEND_REJECTED`, `INTERNAL`.

### 8.5 Authorization

Every endpoint: authenticate → resolve tenant/app → verify the caller owns (or has the existing publish permission on) that tenant → verify the app belongs to the tenant and `workspaceKey` matches. Never trust `slug`, `tenantId` or IDs from the request body. Core re-verifies with Backend; Backend never trusts Core for user identity beyond the `CoreServiceGuard` plus the supplied `userId` check. Unauthorized or unknown → `403`/`404` without revealing other tenants' data.

### 8.6 Failure handling (summary)

| Failure | Result |
|---|---|
| Backend unreachable during publish | Retry with backoff; the live site is unaffected; after the budget → `FAILED/BACKEND_REJECTED`, workspace kept. |
| Duplicate/double-clicked Publish | Same idempotency key → same deployment; different key while active → `409` with the active `deploymentId`. |
| Core restart mid-publish | Resume or `FAILED/CORE_RESTARTED` (§6.4). |
| R2 write fails | `ROUTE_WRITE_FAILED`, previous route intact. |
| Vercel `429`/5xx | Backoff; then `VERCEL_RATE_LIMITED`/`VERCEL_ERROR`. |

---

## 9. Security, credentials and resource controls

### 9.1 Secrets

GitHub App credentials, Vercel token, R2/Cloudflare credentials and `WORKSPACE_MASTER_KEY` live **only** in Core gateway env. They are never in frontend code, browser responses, generated apps, repos, logs or agent prompts. Child processes strip all `R2_*`, `GITHUB_*`, `VERCEL_*`, `WORKSPACE_MASTER*`, `ALERT_*`, `PUBLISH_*`, `DEPLOY_MODE`, `ALLOW_HOBBY_MODE_IN_PRODUCTION`, workspace-control credentials/flags, and the existing denylist. Tests assert prohibited names and values are absent. Do not exempt `GITHUB_CLIENT_ID`: production child paths do not need GitHub App authentication; installation-token operations stay in Core.

### 9.2 Ownership, workspace separation and execution isolation

Every operation is scoped by `tenantAppId`; Vercel and GitHub calls use IDs read from Backend, never client input. The Vercel token is team-scoped to the merchant-app team only.

These are separate properties and have separate acceptance tests:

1. **Workspace separation:** app files and metadata have per-app/workspace roots and ownership checks.
2. **Execution isolation:** generated code, dependency install scripts and build scripts run behind a security boundary that prevents reading another app/workspace, Core source/config, host credentials, Neon credentials, GitHub/Vercel/R2 credentials, or the Docker/container control socket. The sandbox receives only scoped application inputs and narrowly scoped network access. A child Node process, filtered environment, separate directory or OS process group alone does not satisfy this requirement.
3. **Ephemeral lifecycle:** the sandbox/workspace may be destroyed and recreated on another Core instance after the durable-save contract passes. It uses an explicit ephemeral volume/root and has no mount to Render persistent disk or Core secrets.

The existing `WorkspaceSupervisor` and agent runtime remain orchestration components. Inspect the actual Render deployment model and select the smallest viable container/sandbox/remote-execution boundary; document the threat model, limits, network policy, cost and operational dependency. If Render cannot provide the boundary, implement a replaceable provider abstraction and safe integration path, document the required external execution infrastructure, and do not execute generated code unsandboxed. Do not rewrite the agent runtime unnecessarily or claim security isolation until cross-app and secret-exfiltration tests pass.

### 9.2.1 Execution provider and deployment gate

`WorkspaceSupervisor` is the orchestrator; it must delegate execution to a provider. The current implementation includes a Docker provider for the existing runtime image. Production host-process mode is prohibited. The Docker provider requires a pinned local runtime image, a pre-created Docker network whose inspected `Internal` value is true, per-workspace volume only, host firewalling that exposes only the model/RPC gateway, and an allowlisted package-registry proxy. It applies a non-root UID, read-only container root, `cap-drop ALL`, `no-new-privileges`, CPU/memory/PID limits, and no Docker socket. Direct Internet egress is denied. Startup fails closed if required Docker configuration is missing or the network is not internal. The Render service capability, firewall policy, and package proxy remain external deployment prerequisites; do not claim D22 or enable production workspaces until independently verified.

### 9.3 Resource limits and guardrails

- **Workspaces:** `MAX_ACTIVE_WORKSPACES`; per-workspace size cap `WORKSPACE_MAX_MB` checked at persist; existing child-process limits retained.
- **Repos:** pre-push caps — file size (default 10 MB), repo size soft cap (100 MB), forbidden paths (`.env*`, `.vercel/`, `node_modules/`).
- **`vercel.json` allow-list:** only `git` (platform-owned), `headers`, `redirects`, `rewrites`, `cleanUrls`, `trailingSlash`; no `crons`, no function overrides above the project defaults, no storage config. Rewrites to external destinations are rejected (prevents open-proxy abuse).
- **Vercel project defaults at creation:** explicit function max duration and memory (verify field names in the spike); no Marketplace storage; Deployment Protection per §9.4.
- **Builds:** `VERCEL_DEPLOY_TIMEOUT_MINUTES` (15) is well inside Vercel's 45-minute limit. Documented Pro limits used for budgeting (verified 2026-11-04): unlimited projects; 6000 deployments/day, 450/hour, 120 per 5 minutes; 45-minute builds; up to 500 on-demand concurrent builds; env vars ≤ 64 KB; function max duration 300 s default, 800 s max.
- **Queues:** §6.8. Per-tenant plan quotas hook into the existing subscription model.

### 9.4 Deployment URLs and Deployment Protection

Vercel documents that new projects can protect `*.vercel.app` URLs behind a login page and that tenant sites meant to be public are created with `ssoProtection: null`. The Worker must reach the immutable origin, so **MVP: protection off on merchant projects**, with the risk stated: anyone who learns an immutable URL can reach the app directly, bypassing the Worker's cookie/redirect rewriting (not a security boundary; apps must not rely on it). **Hardening (spike S4):** keep protection on and have the Worker send Vercel's automation-bypass header; adopt only if the plan supports it and per-project secrets can be handled safely. Unguessable deployment hostnames are never advertised in the UI or responses.

### 9.5 Cost monitoring and rate limits (merchant-app Vercel team)

- Costs are **team-pooled**: Pro is per seat plus usage credit; bandwidth, edge requests, function CPU/memory and build minutes scale with merchant traffic and deploy count, not with project count (MakerKit analysis, May 2026; re-verify at `vercel.com/pricing`).
- Spend Management enabled with alerts at 50/75/100%; **do not auto-pause projects** (pausing takes every store offline). Alert, then act.
- Core records per deployment: build duration, queue time, count; daily rollup of deployments/app, builds/day, `429` count, failed-build rate. Weekly review of the top 10 apps by deployments and by traffic. If the Vercel usage/billing API is available (U6) use it; otherwise rely on the dashboard plus our counters.
- Kill switch: `PUBLISH_ENABLED=false` stops new publishes; live stores keep serving.
- Possible later cost lever, measure first: let the Worker cache content-hashed `/_next/static/*` assets to reduce Vercel egress.

---

## 10. Dashboard integration

Preserve the existing UI location (`frontend/app/(dashboard)/dashboard/page.tsx`, near the "Coming soon" block; verify line numbers in D0) and the `NEXT_PUBLIC_FF_PUBLISH` flag. Flag off → page identical to today.

**States shown (all real, from Backend/Core):** Queued (with position) · Preparing workspace (incl. "Restoring your workspace…") · Saving source · Building and deploying (live build log lines when available) · Verifying deployment · Activating the public URL · Published successfully · Failed, with an actionable message per error code · Rolling back / restoring a previous version · Unpublishing.

**Functions:** Publish (disabled while an agent run is active or a build is streaming); copy and open the public URL; deployment history (time, status, SHA short, who, verified badge); **Restore this version** (rollback, only for `rollbackEligible`); **Unpublish** (confirm dialog, only when authorized); on `BUILD_FAILED` a **Fix with Seltra** button that posts the redacted log tail into chat; automatic retry on `WORKSPACE_RESTORING` and `CAPACITY`.

**Data flow:** start/rollback/unpublish → Core gateway; live updates → SSE from Core with polling fallback to Backend; history and status → Backend. The UI never advances on its own timers and never marks success before `done {LIVE}` is recorded.

**Redirect-loop fix** (`frontend/app/store/[slug]/page.tsx`, around the redirect logic; verify in D0): if `publishedUrl`'s host equals `<slug>.<NEXT_PUBLIC_ROOT_DOMAIN>`, render the "not published" page instead of redirecting. Add a regression test; confirm legacy V4 store pages still redirect/render as before.

---

## 11. Founder setup checklist (in this order)

> **Dropped from v2:** the Render Shell disk measurement. The disk was removed on Render to save cost, so the shell was not run. Disk budgets are read at runtime (`statfs`) and tuned from real drills.

### A. Security housekeeping (today)
Rotate the Neon database password and any Paystack/Moolre keys that appeared in the earlier `.env` screenshot. Run `git log --all --oneline -- seltra-web/backend/.env seltra-web/core/.env`; if it prints anything, tell Claude.

### B. Cloudflare
1. R2 → create private buckets `seltra-routes` and `seltra-workspaces`.
2. R2 → API token (Object Read & Write) scoped to **both** buckets; note Access Key ID, Secret and Account ID.
3. Worker `seltra-subdomain-router` → Settings → Bindings → R2 bucket → variable `ROUTES` → `seltra-routes`.
4. Confirm proxied wildcard `*` DNS record and Universal SSL are active for `seltra.co`.
5. Move to the Workers paid plan before real traffic (free tier is 100k requests/day).

### C. GitHub App (org `Seltra-Cloud`)
New GitHub App `seltra-publisher`, webhook inactive. Repository permissions: Administration RW, Contents RW, Metadata R. Install on `Seltra-Cloud`, all repositories. Note App ID and Installation ID. Generate a private key, base64 it (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("seltra-publisher.private-key.pem")) | Set-Clipboard`) → `GITHUB_APP_PRIVATE_KEY_B64`, then delete the `.pem`.

### D. Vercel merchant-app team
1. Create a **new team on Pro** for merchant apps (separate from the platform team).
2. Team Settings → Git → connect GitHub and install on `Seltra-Cloud` (all repositories). A GitHub org installation may be linkable to only one Vercel team — confirm it does not conflict with the platform team (U3).
3. Copy the **Team ID** (`team_…`).
4. Create a token scoped to this team, 1-year expiry (calendar reminder) → `VERCEL_TOKEN`.
5. Billing → Spend Management on, alerts 50/75/100%, **no auto-pause**.
6. Note current Pro limits and any deployment-retention default (U5, U7).

### E. Core environment contract (names only; values remain secret)

Core reads Willy's primary names first and accepts the documented aliases below. Parse/validate at startup and report variable names only. The supplied `GITHUB_APP_CLIENT_ID` is not used by Core's installation-token flow and is never passed to children.

| Purpose | Primary name | Accepted aliases / rule |
|---|---|---|
| GitHub org | `GITHUB_ORG` | `GITHUB_APPS_ORG`; org is `Seltra-Cloud` |
| GitHub App | `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_PRIVATE_KEY` | `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY_B64`; key accepts PEM or base64 PEM and literal `\n` normalization |
| GitHub App client ID | `GITHUB_APP_CLIENT_ID` | Not read; installation tokens do not require it |
| Vercel | `VERCEL_TOKEN`, `VERCEL_TEAM_ID` | team ID optional only for Hobby personal-account API calls; required in Team mode |
| R2 S3 | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_S3_API_ENDPOINT` | endpoint normalized to scheme + host only |
| R2 bucket | `R2_BUCKET_NAME` | `R2_BUCKET_ROUTES` / `R2_BUCKET_WORKSPACES` aliases; one bucket works with `routes/` and `workspaces/` prefixes |
| Cloudflare API token | `R2_TOKEN` | Never read as an S3 credential |
| Workspace encryption | `WORKSPACE_MASTER_KEY` | Required when persistence or restore is enabled; fail closed if absent/unparseable |
| Persistence / restore | `WORKSPACE_PERSISTENCE_ENABLED`, `WORKSPACE_RESTORE_ENABLED` | Independent of publishing; default false |
| Publishing | `PUBLISH_ENABLED` | Deployment/routing kill switch only |
| Deployment mode | `DEPLOY_MODE` | `hobby` or `team`; Core rejects invalid values; Vercel Team ID follows mode rules above |
| Browser API URL | `PUBLISH_PUBLIC_API_URL` | Public HTTPS Backend URL, no private/internal address; format must match scaffold's `VITE_SELTRA_API_URL` |
| Commit identity | `PUBLISH_GIT_AUTHOR_NAME`, `PUBLISH_GIT_AUTHOR_EMAIL` | Explicitly supplied by gateway to commit RPC; child cannot read publish environment |

Core child environment strips `R2_*`, `GITHUB_*`, `VERCEL_*`, `WORKSPACE_MASTER*`, `ALERT_*`, `PUBLISH_*`, `DEPLOY_MODE`, `ALLOW_HOBBY_MODE_IN_PRODUCTION`, workspace-control secrets/flags and the existing denylist. `GITHUB_CLIENT_ID` remains stripped; no production child needs GitHub App authentication. Backend receives only publish mode/configuration needed for its API and never infrastructure credentials. Frontend/generated apps receive only intentionally public build-time variables.

**Backend:** `PUBLISH_ENABLED=false`, `DEPLOY_MODE=hobby` for internal tests or `team` for commercial use, `PUBLISH_ROOT_DOMAIN=seltra.co`, quota settings. **Frontend:** `NEXT_PUBLIC_FF_PUBLISH=false`, `NEXT_PUBLIC_ROOT_DOMAIN=seltra.co`.

---

## 12. Uncertainty register and discovery steps

Nothing below may be assumed. Each is resolved in D0 (read-only code questions D0-A, behaviour spikes D0-B) and reported before the dependent phase starts.

| ID | Uncertainty | Resolved by | Blocks |
|---|---|---|---|
| U1 | Does `git.deploymentEnabled:false` in the first commit, with the project linked afterward, reliably prevent push-triggered deployments? Branch-tracking interaction? | Spike S1 | P3A |
| U2 | Does `gitSource` deployment at a SHA work with `deploymentEnabled:false`, and does it require the project to be Git-linked? | S2 | P3A |
| U3 | Can the `Seltra-Cloud` GitHub org connect to the new merchant team without conflicting with the existing platform team? | S3 (+ Willy check in D.2) | P3A |
| U4 | Deployment Protection on `*.vercel.app` immutable URLs with `ssoProtection:null`; automation-bypass availability on this plan. | S4 | P3B |
| U5 | Vercel deployment retention defaults; can old production deployments be kept for rollback? | S5 | P3A |
| U6 | Is there a usable usage/billing API for per-team spend monitoring? | D0-B | Final |
| U7 | Real default concurrent-build allowance on Pro vs "up to 500" on-demand. | D0-B / Vercel account page | P3A |
| U8 | Exact existing R2 route format; relationship of `Tenant.slug`, V4 stores and `TenantApp`; existing roles for "authorized" publish. | D0-A | P1A, P3B |
| U9 | Vercel guidance on a reverse proxy/CDN in front of deployments; how client IP is seen by apps behind the Worker. | S6 | P3B |
| U10 | Render SIGTERM-to-kill window and shutdown delay settings. | D0-A | P1B |
| U11 | Endpoint and behaviour for streaming build-log events. | S5 | P3A |
| U12 | Documented deployment rate limits differ (450/h vs 1000/h). | Observed via response headers in S-spike; use stricter until resolved | P3A |

### D0-B — spikes

Use only disposable test tenants and throwaway private `Seltra-Cloud` repositories/projects; never modify existing repositories, projects, routes or merchant data. Never create a public merchant-source repository or use tarball deployment as a privacy workaround. If Hobby cannot deploy private organization repositories, keep persistence operational, mock deployment-provider integration and leave publishing disabled until a private-capable plan is available. Delete only resources created by the spike and redact secrets. Write `docs/PUBLISH-SPIKES-REPORT.md`.

---

## 13. Phases and prompts (sequential — never run phases in parallel or skip discovery)

Order: **D0 -> P0 -> P0b -> P1A -> P1B (audit/complete, do not restart) -> P1C -> P2 -> D16-D24 -> P3A -> P3B -> P3C -> Final.** Each phase ends with a report. Continue from verified repository state; no separate amendment review gate remains.

**Appended to every prompt:**
```
RULES: Read docs/PUBLISH-SPEC.md fully first. Implement phases in order and continue from actual code. Implement only the named phase. Preserve the existing Core agent runtime; do not replace it wholesale or rename Dyad identifiers. Additive DB changes only. Persistence/restore flags are independent of PUBLISH_ENABLED. Generated code must not run outside the approved security boundary. Production host-process runtime is forbidden; use the isolated execution provider or fail closed. Use private app repos in every mode. Keep legacy disk-related code and backups until docs/DISK-REMOVAL-APPROVAL.md exists (written only by Willy), but never make new durability or recovery depend on Render persistent disk. Use an explicit ephemeral workspace root. Do not run the Render Shell. Never print, log or commit secret values. Verify Vercel/GitHub/Cloudflare API shapes against current official docs before coding. If a path, function, or model name in the spec does not match the repo, STOP that item, report the real names, and continue the rest. No simulated progress or placeholder success anywhere.
REPORT: (1) files created/changed + one-line purpose, (2) commands run + pass/fail, (3) deviations and why, (4) open questions, (5) what you could not verify.
```

**D0 — Discovery (read-only; change no production code)**
```
D0-A (repo): answer with exact paths, function names and short excerpts: (1) scaffold framework + package manager and installer default; where its cache lives; (2) does preview start auto-install when node_modules is missing; (3) contents of a typical ws/<key>/userData; (4) control_store.ts modes and what would be lost without disk; (5) does the gateway relay chat-stream completion events (for save points); (6) is a git binary available at runtime and how existing code calls git; (7) Render deploy mode (Node/Docker) and current SIGTERM handling; (8) child env denylist in workspace_supervisor.ts; (9) the existing R2/Worker route format, Tenant.slug vs V4 store vs TenantApp relationship, and existing role/permission model for publishing; (10) the dashboard "Coming soon" block and the store/[slug] redirect logic with real line numbers; (11) existing Prisma models/migrations state; (12) what the scaffold reads for public env vars.
D0-B (behaviour spikes S1–S6 in spec §12): use only a throwaway private repo and a scratch project in the merchant team with the supplied credentials in core/.env.web. Read names only; never print values. Report request/response shapes with secrets redacted and pass/fail per spike. Recommend (do not apply) layer choices from spec §3.4 and any fallback B/C.
```

**P0 — Safety**
```
Implement spec §9.1 and these fixes: (1) Moolre debug log (moolre.service.ts near line 381) must not log the API key; (2) /v1/assets/:id (engine.controller.ts near lines 50-56): confirm IDs are random, else require auth; (3) grep Backend/frontend for cookies with Domain=.seltra.co; platform auth cookies must be host-only (prefer __Host-); fix and report; (4) replace the child env denylist with the prefix patterns in §9.1 plus existing names, add a test that none leak, add redaction patterns, run npm run web:test and backend tests. Do not remove disk-related code paths.
```

**P1A — Backend (§8)**
```
(Backend only). Precondition: P0b report reviewed. Implement spec §8.1-§8.3 and §8.5 as specified in ?8 and ?14:
- A2: deployMode and repoVisibility on Deployment, githubRepoVisibility on TenantApp. deployMode comes from DEPLOY_MODE (missing/invalid = team). Hobby is an account/budget setting only; repositories remain private and named app-<tenantAppId>. Backend status endpoint returns deployMode.
- A2b: PUBLISH_PROTECTED_SLUGS (SLUG_PROTECTED 422), reserved words, route ownership data model (tenantId/appId on the route record contract; enforcement lives in Core later).
- A2c: GET internal-ops/publish/public-repos behind the existing ops API-key guard.
- A5: owner-only authorization; LegacyStoreGuard returning LIVE|NOT_LIVE|UNKNOWN (UNKNOWN fails closed in team mode with V4_GUARD_NOT_CONFIGURED, warns in hobby); confirmReplaceLegacy handling.
- CONFIG_MISSING checks; CORS allowance for ^https://[a-z0-9-]+\.seltra\.co$ on public storefront routes only, no credentials, extending the existing config.
- Report how the scaffold/preview passes VITE_SELTRA_API_URL (with or without /api/v5) so PUBLISH_PUBLIC_API_URL can match it.
Do NOT choose an unknown V4 live predicate; fail closed in Team mode and report any unresolved evidence. Develop migration SQL against local staging only; never apply a migration to Neon without Willy approval. Jest tests: ownership 403, hourly quota 429, in-flight 409, idempotencyKey reuse, stale timeout, finish LIVE/FAILED semantics, progress seq idempotency, rollback target validation, 404 when disabled, plus M1, M3, M4 from ?14. Do not modify Core or the frontend.
```

**P1B — Core durability (§5.1–5.5)**
```
Implement github/, snapshot/, the child RPCs (snapshotUserData, commitWorkingTree), platform-owned vercel.json handling, the pre-push validator (§9.3), edit lease client, and all save-point triggers incl. SIGTERM. Tests with mocked S3/git: token never in .git/config or logs; manifest written last; restore rebuilds apps and userData; failed persist keeps the workspace and blocks eviction; fast-forward-only pushes and SOURCE_DIVERGED handling; wrong master key fails safely; validator rejects removal of the vercel.json git key, crons and external rewrites.
```

**P1C - Durability contract hardening (section 5)**
```
Separate source persistence and restore from PUBLISH_ENABLED using WORKSPACE_PERSISTENCE_ENABLED and WORKSPACE_RESTORE_ENABLED. Define the completed-edit acknowledgement boundary and an idempotent persistence journal across GitHub, R2 and Neon. Verify GitHub SHA and uploaded R2 bundle/checksum before Neon records the durable versions. Handle partial failure/retry/reconciliation; never report save success or SAFE_TO_DESTROY on partial completion. Make SIGTERM and explicit close paths honor the same contract; shutdown timeout cannot silently convert failure to success. Add real provider integration tests only after the spec's architecture gate is reviewed. Do not implement app publishing in this phase.
```

**P2 - Disposable workspace lifecycle (§5.5–5.7)**
```
Extend WorkspaceSupervisor with the execution-provider interface. Build/use the existing runtime Docker image per workspace with an explicitly internal-only network, non-root UID, read-only image root, dropped capabilities, no-new-privileges, CPU/memory/PID bounds, one workspace-only mount, and no host/Docker socket. Require the gateway/package-proxy host firewall policy. Production host process mode must fail closed. Keep the existing agent runtime as orchestrator. Put per-app generated code, installs and builds inside that boundary with no access to Core secrets, sibling apps or host control sockets. Use an explicitly ephemeral workspace root and implement restore-on-demand with locking, WORKSPACE_RESTORING/CAPACITY states, MAX_ACTIVE_WORKSPACES queueing, ephemeral capacity reporting and shadow-mode restore/compare. Do NOT change the package manager/installer or remove legacy disk paths. Do not enable destructive enforce mode until D16-D24 pass and Willy approves. Tests include cross-app filesystem isolation, secret non-access, cleanup, and recovery on a different Core instance.
```

**P3A — Per-app Vercel project management and deployment orchestration (§3, §6)**
```
Precondition: D0-B spikes S1-S3 and S5 passed (or Willy chose a fallback). Implement vercel/ (ensureProject idempotent incl. 409 reuse, setEnv with public vars only, createDeployment with gitSource+sha+meta, SHA assertion, getDeployment mapping, build-log tail and event stream, 429 backoff, unexpected-deployment detector) and publish/ (orchestrator §6.1-6.6, global queue and budgets §6.8, crash recovery §6.4, SSE endpoint §6.7, Core gateway endpoints §8.4). Mock Vercel/GitHub/R2/fetch in tests: build ERROR leaves live unchanged; health failure leaves live unchanged; public-verify failure restores the previous route; rollback works and rejects invalid targets; idempotent ensureProject/ensureRepo; SHA mismatch fails; secret scan blocks push; per-app lock; queue respects budgets; resume after restart; SSE emits only after Backend records.
```

**P3B — Worker and safe activation (§7)**
```
Create seltra-web/edge/subdomain-router/worker.js per §7.3 and a README (paste-deploy and bind ROUTES). Reconcile with the real existing format from D0 (keep real format; add fields additively). Node tests with a fake env: invalid slug and reserved subdomains keep legacy behaviour; non-seltra hosts pass through; missing/invalid route falls to legacy; slug-mismatch route ignored; upstream failure and x-vercel-error return the generic 503; Location rewritten; Domain= stripped from every Set-Cookie; x-vercel-* stripped both ways; x-seltra-* client headers dropped; x-seltra-deployment set. Deliver a before/after smoke script for V4 stores.
```

**P3C — Dashboard (§10)**
```
Implement the Publish UI behind NEXT_PUBLIC_FF_PUBLISH: real states from Backend and the Core SSE stream with polling fallback; resume after refresh; history; copy/open URL; rollback; unpublish with confirm; Fix with Seltra; WORKSPACE_RESTORING/CAPACITY retry. No timers that advance state. With the flag off the page must be identical to today. Implement and test the redirect-loop fix without affecting legacy V4 store pages.
```

**Final — End-to-end, monitoring, controlled disk path**
```
Run the acceptance suite in section 14 on disposable test tenants, record timings, add cost/usage counters and daily rollup (section 9.5), the nightly reconciler (Backend live deployment vs R2 route vs Vercel), and a runbook for rollback, kill switch and token rotation. Produce a report only. Do NOT remove or change disk-related code paths. When implementation and automated/safe integration tests are complete, deliver the final report with exact service startup order and first browser test steps; do not ask for browser testing before that point.
```

---

## 14. Acceptance tests (measurable)

Run on a test tenant first. Publishing flags go on only after the publish tests pass; workspace persistence/restore are controlled independently and must be verified before merchant production use. Eviction goes to `enforce` only after architecture drills D16–D24 and safety drills pass; legacy disk-related code stays in place until §15.

| # | Test | Pass when |
|---|---|---|
| **A1** | Create a merchant app | Private repo `Seltra-Cloud/app-<id>` exists; repo ID stored in Backend; running again creates nothing new. |
| **A2** | Create/retrieve its Vercel project | Project `app-<id>` exists in the merchant team, linked to the repo; ID stored; second call reuses it (no duplicate, no 409 surfaced). |
| **A3** | Generate and build an app | Build succeeds in the workspace; source committed. |
| **A4** | Save exact commit and deployment metadata | Backend shows `sourceCommitSha` = pushed SHA = `gitSource.sha` of the Vercel deployment; tag `seltra/dep-<id>` exists; `vercelDeploymentId`, `vercelOrigin`, timings recorded. |
| **A5** | Publish and verify public URL | `https://<slug>.seltra.co` returns 200; `x-seltra-deployment` equals the Backend deployment id; stage events observed in the UI in order; total time recorded. |
| **A6** | Destroy workspace, restore fresh from durable stores | Delete the complete original workspace and prove no Render persistent mount or previous local file is available; restore from private GitHub + Neon + R2; source tree hash equals the saved SHA; required chats/versions are present; preview starts after lazy install; durations logged. |
| **A7** | Edit, rebuild, publish a new version | New SHA live; previous deployment `SUPERSEDED` and rollback-eligible; probes every 1 s during the cutover show 0 non-2xx responses. |
| **A8** | Failed deployment keeps the previous version live | Break the build: status `BUILD_FAILED` with redacted log tail; probes every 2 s throughout show the same `x-seltra-deployment` and 0 errors. Repeat for a failed health check and a failed public verification (route restored). |
| **A9** | Roll back | Restore a previous verified deployment: public header switches within 60 s; row `LIVE`; GitHub `main` unchanged; an invalid target is rejected `422`. |
| **A10** | Apps are isolated | Publish/rollback/unpublish app X: app Y's route object, Vercel project, deployments and Backend rows are unchanged (compare ETags and counts before/after); the dashboard stays up. |
| **A11** | V4 stores and legacy routes unaffected | Smoke script over every production V4 slug and the dashboard host gives identical status and marker text before and after the Worker deploy; a V5 publish on a slug used by a live V4 store is refused `422`. |
| **A12** | Authorization, secret isolation, failure recovery, resource limits | See D-table below, all pass. |
| **A13** | Dashboard reflects real states | p95 delay from Backend event write to UI display ≤ 2 s; killing the SSE connection falls back to polling with no lost state within 5 s; reloading mid-publish resumes at the correct stage; no state is ever shown that Backend has not recorded (test by pausing Backend writes). |
| **A14** | Real-use observation period | 48 h with the founder and five internal testers using disposable test tenants: zero unalerted persist failures, zero lost source, instance disk below `DISK_SOFT_PCT`, zero unexpected deployments or all detected and cancelled. |

**Durability, safety and limits drills**

| # | Drill | Pass when |
|---|---|---|
| D1 | Idle eviction then reopen (shadow mode: restore into scratch and compare) | Source, history and versions identical. |
| D2 | Restart Core during an active session/publish | Latest acknowledged completed save restores exactly; an interrupted in-flight turn is marked interrupted; no acknowledged save is lost; live site unaffected. |
| D3 | Force GitHub push failure | Workspace not evicted; retries at 1/5/15 min; alert fires; publish rejected `SOURCE_NOT_SAVED`. |
| D4 | 20 workspaces with installs, go idle | Disk returns under `DISK_SOFT_PCT`; zero unpersisted deletions. |
| D5 | Fill to the hard threshold | New restores get `CAPACITY`; nothing deleted. |
| D6 | Wrong `WORKSPACE_MASTER_KEY` | Restore refuses safely; no corrupted workspace. |
| D7 | Agent runs `printenv` | No `R2_`, `GITHUB_APP`, `VERCEL_`, `WORKSPACE_MASTER`, `ALERT_`, `PUBLISH_` values. Repo scan finds no secrets. |
| D8 | Another merchant's app ID / forged `slug` / forged `workspaceKey` | `403`/`404`; nothing changes. |
| D9 | 11 publishes in an hour (limit 10) | The 11th gets `429`. |
| D10 | Burst of publishes across 20 apps | Queue positions shown; concurrency ≤ `PUBLISH_MAX_CONCURRENT`; Vercel `429`s absorbed; none lost. |
| D11 | Push a commit to a repo directly on GitHub | No production deployment, or any created is detected and cancelled; route unchanged. |
| D12 | Commit `sk_test_…`, a `.env`, `crons`, or remove the `git` key from `vercel.json` | Blocked pre-push with the right error code. |
| D13 | Server-set cookie with `Domain=.seltra.co`; app redirect to its origin host | Cookie stored host-only; redirect stays on the public host. |
| D14 | Vercel deployment deleted behind the route | Worker serves the generic 503; reconciler alerts; rollback to another verified version works. |
| D15 | Unpublish then open `seltra-merchant.vercel.app/store/<slug>` | "Not published" page, no redirect loop. |

**Disposable-workspace architecture proof (mandatory; mocks are not acceptance evidence)**

| # | Drill | Pass when |
|---|---|---|
| D16 | Real persistence with publishing disabled | With `PUBLISH_ENABLED=false` and workspace persistence enabled, edit an actual test app; private GitHub contains the exact commit, R2 contains a verified snapshot, and Neon records matching SHA/snapshot version. No Vercel deployment or route write occurs. |
| D17 | Complete workspace destruction | Delete the original workspace root and all local files using the approved test procedure; confirm the test does not read from a Render persistent disk or old instance. |
| D18 | Fresh-instance recovery | Start on a separate clean Core instance/root with no shared local volume; restore using real GitHub, Neon and R2; verify source hash, app identity, required SQLite data, wrapped-key recovery and app-to-revision mapping. |
| D19 | Continue editing after restore | Make a second real edit, build/preview it, save a new commit and snapshot; Neon advances to the matching versions and the prior revision remains recoverable. |
| D20 | GitHub/R2/Neon failures | Inject each provider failure at every save boundary; no success/SAVED/SAFE_TO_DESTROY state is emitted; the only local copy remains alive when available; retries/reconciliation are idempotent. |
| D21 | Interrupted/partial operation recovery | Kill Core between commit, bundle upload, manifest write and Neon record; a fresh instance reconciles safely to a complete durable version or reports degraded without pointing at partial data. |
| D22 | Execution isolation | A generated app/build script cannot read a sibling app, Core files/config, host credentials, Neon/GitHub/Vercel/R2 credentials, or sandbox control socket; network policy is enforced. |
| D23 | Private-repo publishing | Publish the exact saved commit from the private app repo to its assigned Vercel project; verify repo stays private and the matching route activates only after health/public checks. If the available Hobby account cannot do this, the gate remains open until a capable account is used. |
| D24 | Rollback and ephemeral cleanup | Roll back to a previous healthy version without affecting another app, then destroy the verified workspace and prove GitHub/Neon/R2 recovery; deletion before `SAFE_TO_DESTROY` is rejected. |

---

## 15. Disk-related code: preservation and removal gate

- **Status (confirmed by Willy, 2026-11-04):** the persistent disk was removed on Render; repository paths remain. Verify the current production service configuration before treating any specific path/volume as ephemeral.
- **What "preserved" means:** old `DATA_ROOT`, local persistence/fallback, control-store, migration and restore code remains untouched until approved. New workspace persistence and recovery must not read or write a Render persistent mount as a source/fallback. New active workspace roots must be explicitly ephemeral.
- **Risk and readiness:** until P1C, P2 and real drills D16–D24 pass, this architecture is not proven for merchant continuity. Do not enable production workspaces on the assumption that the latest change is durable.
- **Gate:** old disk-related paths/backups may be removed only after **all** of: (1) A1–A14, D1–D15 and D16–D24 pass; (2) the 48-hour A14 observation completes; (3) Willy creates `docs/DISK-REMOVAL-APPROVAL.md` with the date and the words "approved to remove". Agents never create or edit that file.
- **If capacity pressure forces earlier action:** stop and propose a controlled procedure to Willy: persist and verify every workspace (GitHub SHA + manifest), restore-and-compare each, free space only by removing reinstallable data (`node_modules`, `.next`, `dist`, `out`) under `DISK_STOPGAP_ENABLED`, and never delete required state.


## 16. Later (not now)

Custom domains (Cloudflare for SaaS) and agent-purchased domains; per-app databases and secret injection; background workers/cron; webhook-driven (instead of polled) Vercel status; hard delete of apps (route → repo archive → Vercel project deletion after retention); "restore source to this version" (revert commit) after a rollback; Worker static-asset caching; Vercel deployment pruning beyond the last 10; multi-instance Core with portable durable job/workspace placement; deployment protection with automation bypass (S4).

---

## Appendix — What changed from v2 (for review)

| v2 | Final | Why |
|---|---|---|
| Disk removal was Day-1 Phase 2 work | Disk already removed on Render; repo disk code paths preserved; shadow-mode eviction; their removal needs tests + 48 h + Willy's written approval | Your instruction; protects against unproven recovery. |
| Render Shell disk measurement (§3A) | Dropped; budgets from `statfs` | Disk removed from billing; shell not run. |
| Auto-deploy "disabled" by project setting (unverified) | Layered control: platform-owned `vercel.json`, pinned API deploys, unexpected-deployment detector, spike-gated; fallbacks B/C | Vercel docs say a linked repo auto-deploys on push; behaviour must be proven. |
| Worker header carried Vercel deployment id | Opaque Seltra `Deployment.id`; Vercel headers stripped | No private deployment metadata exposed. |
| Route cache 15 s | 5 s | Faster, real-time cutover and verification. |
| Status enum QUEUED/SAVING/BUILDING/VERIFYING/LIVE/… | Adds PREPARING_WORKSPACE, ACTIVATING; `PublishEvent` table; SSE | Real-time states the dashboard requires. |
| Rollback pointer-only | Rollback is its own auditable row, with eligibility rules and retention check | Coherent per-app rollback. |
| Slug conflicts unaddressed | `SLUG_CONFLICT_V4` guard | Protects existing V4 production stores. |
| Concurrency, interrupted runs, divergence implicit | Edit lease, fast-forward-only, `sourceState`, crash recovery | Explicit lifecycle edge cases. |
| Fullstack open question | Resolved: shared Backend/Neon, no per-app DB in MVP | Your decision. |

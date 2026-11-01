# Seltra V5 build experience audit

Audited against `SELTRA_V5_BUILD_EXPERIENCE_AND_RELIABILITY.md` on 2026-10-30. The repository contains several partial building blocks, but the production path does not yet connect them into the server-owned, event-backed build flow described by the spec.

## Current paths

| Concern | Current implementation | Gap affecting the live experience |
| --- | --- | --- |
| Chat and agent stream | `seltra-web/frontend/app/(dashboard)/dashboard/page.tsx` dispatches `chat_stream` over `CoreClient` and renders Core chat chunks, TODO updates, questionnaire requests, and app blueprint events. | The dashboard is the live viewer and dispatcher. It does not reconstruct the full chat/build projection from Seltra `run_events`. |
| Run orchestration | `seltra-web/backend/src/build/run.service.ts` persists runs, event sequences, SSE replay, stop/continue records, and a stale-heartbeat reaper. The dashboard creates the run in `runCorePrompt`. | The run is started and heartbeated by the browser. Core generation does not emit its phase/file/tool progress into the run log. A browser disconnect can therefore make a live generation look orphaned, and Stop/Continue are not consistently backed by a durable agent checkpoint. |
| Workspace and preview | Core app runtime creates a per-tenant workspace and preview. `seltra-web/core/src/web/template_branding.ts` only changes the starter heading to “Welcome to Your New App” and adds Seltra attribution. | The visible initial preview is still the generic React starter while the agent is working. The dashboard renders the iframe as soon as Core supplies an app URL; it has no `preview.status` stage overlay or first-generated-render gate. This explains the screenshot. |
| Workspace persistence | `BuilderService.syncWorkspaceFiles` writes project files, content-addressed blobs, and auto snapshots. The Core gateway sends a best-effort full-workspace sync. | Sync is periodic/best-effort, not a completion barrier. `RunService.restore` returns DB rows; it does not restore those files into the Core sandbox. Snapshot creation is not consistently connected to run phase boundaries. |
| Credits and tokens | Core gateway routes model calls by role and reports usage to `/api/v5/internal/core/usage`; backend has workspace balances and a ledger. | The backend ignores the reported model and run id for charging, passes total tokens as input tokens, and records no output token split. Credits are charged per successful call with no reservation, live credit events, or clean paused-run handoff. The run UI does not subscribe to credit events. |
| Auth and project safety | Builder session checks tenant ownership; run/project endpoints check project ownership; tenant app pointers are keyed by tenant in browser storage; a partial unique index prevents concurrent active runs per project. | The run lifecycle still depends on browser heartbeat. Workspace concurrency queues, sandbox reaping, and project creation idempotency are not fully implemented or demonstrated by the active path. |
| Completion and UI | The dashboard has streamed chat, TODO cards, questionnaire/blueprint cards, preview controls, a credits panel, and `completion-tone.ts`. | Run completion tone and READY checks are not driven from replay-safe run events; the current build flow does not show the spec’s event-derived phase/file/repair/verify details, offline banner, or preview stage loader. |

## Main integration finding

The Seltra Run tables currently wrap a Core chat operation rather than owning it. `runCorePrompt` writes `run.started` and browser heartbeats, then writes one terminal event after Core reports completion. Meanwhile, the Core actor owns the actual work and emits its rich chat/tool state on a separate connection. The missing bridge is why persistence, progress, recovery, credits, and completion behavior exist as isolated pieces but are not effective together in the dashboard.

## Safe implementation direction

Keep Core as the agent/runtime and Seltra Run as the durable project lifecycle. Pass a server-verified run ID into the Core runtime session, persist state-bearing Core events server-to-server, and make the dashboard a replayable projection of that log. Make workspace persistence a required final checkpoint and implement restore into the existing tenant sandbox. Add preview status events and keep the generic starter covered by the Seltra loading state until generated app output is available. Tie usage commits to actual input/output tokens and the verified run/workspace, then publish balance updates through the run/workspace event stream.

No database or model-provider changes are required to establish this integration; reuse the existing Core runtime, Prisma run/project/credit tables, and Core model gateway.

## Integration changes in this pass

- The dashboard now records Core TODO progress, questionnaire requests/answers, blueprint readiness/approval, preview readiness/failure, and build completion in `run_events`. File sync also records `files.persisted` only after the changed file rows are saved. A run that ends its current Core turn while a questionnaire or blueprint is pending stays `waiting_for_user`; its heartbeat remains active for the next user action.
- Blueprint updates now sync the actual app name and blueprint to `TenantApp`, set approval/build/preview state as Core advances, and write corresponding `AgentEvent` rows. Planned visual entries are stored in `project_assets` with their Core app ID, visual kind, and prompt. Source URL, license, and attribution remain empty until Core provides verifiable values.
- Core app sync now records Core's actual app path and file sync derives a per-app `TenantApp.appManifest` from saved hashes under that app directory. Added nullable `TenantApp.corePath`, `blueprint`, `appManifest`, and `blueprintApprovedAt` columns through an additive migration; the merchant/store `Tenant.manifest` field is kept separate.
- The live preview loading layer now remains visible while the questionnaire or approval card is pending, so the generic template is not presented as the finished app during those states. The Seltra mark has a green-to-teal glow animation with reduced-motion support.

## Still open

- Run ownership is still browser-driven. A server-side Core event bridge is needed for disconnect-safe execution and a fully replayable UI after reload.
- Existing `ProjectFile` rows and snapshots are still tenant-scoped (although each `TenantApp` now has a derived app manifest), and snapshot restore is not yet wired into the Core sandbox. The generated project is therefore not yet a complete isolated, DB-restorable app record.
- Core builder sessions now use `workspace_credits` and `credit_ledger` only. The additive credit backfill preserves the existing 40-credit five-hour allowance and records historical use; new Core workspaces receive the configured starter grant on first session. Model usage reports now carry input/output token counts and run IDs into the ledger. Older commerce-agent code still has a separate legacy counter path and must be migrated before that path can be retired globally.
- Generated raster files (including `.dyad/media`) now flow into durable file blobs and `ProjectAsset` records. Planned visual prompts are also recorded, but generated file rows are not yet joined back to their exact prompt, and external stock/user image source URLs and verified attribution still need provenance capture.
- Model-role routing, token splits, live credit exhaustion handling, completion READY checks/tone, reload recovery, and multi-project isolation remain incomplete in the active path.

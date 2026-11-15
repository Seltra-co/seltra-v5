# Fix findings

This repo already contains a substantial amount of the Builder / dashboard work described in `FIX.md`. I confirmed the current code paths and recorded the concrete findings below before making a small targeted compatibility patch.

## Confirmed checks

- `grep -rn "run\.timing\|save\.state\|restore\.state\|questionnaire\.requested\|asset\.failed\|step\.progress" seltra-web`
- `npm --prefix seltra-web/backend test -- --runInBand`

## What I observed

- The backend run workflow mapping currently handles `step.progress`, `build.result`, `preview.ready`, and asset events, but it does not yet surface the newer `run.timing`, `save.state`, `restore.state`, and questionnaire lifecycle event payloads in the shared workflow mapper.
- The completion gate generally turns a `run.completed` event into `run.failed` when evidence is missing, but it does not explicitly allow a non-fatal `degraded` completion state that is still safe to preview and save.
- The visible backend Jest suite passes, so the remaining gaps are compatibility and event-shape issues rather than a broken baseline test set.

## Targeted fix applied

- Added shared workflow mapping support for `run.timing`, `save.state`, `restore.state`, and questionnaire events.
- Allowed `run.completed` with `status: "degraded"` to persist as a completed run instead of being hard-failed by the completion gate.
- Kept the rest of the completion proof validations unchanged for standard successful runs.

## Notes

- The repo still contains a large number of legacy Dyad-specific strings and docs because this is a migration project; the relevant runtime features are already implemented in the current code paths, while the remaining work in `FIX.md` is mostly product and browser validation work outside the code-backed test runner.
- No tokens or preview URLs were logged in findings.

## T6 final Seltra ecommerce run and QA correction

- Run inspected: `5a4e8b7d-8218-4ed5-8cfb-02575c9733f5` for project `983f1abd-834f-40ba-bbab-676625ab1119`; started at 19:04:59Z and ended failed at 19:21:06Z.
- Event order: `browser.qa` seq 97 reported `NO_ACTIVE_PREVIEW`; seq 100 recorded a browser error, `WebSocket closed without opened.`; the gateway preview probe returned HTTP 200 at `preview.ready` seq 106; seq 111 failed the run with `COMPLETION_GATE_FAILED`.
- The fresh storefront did render, but the run was incorrectly failed by the completion gate. `repair_app.ts` already filtered Vite WebSocket errors from console and network callbacks, but its `pageerror` callback unconditionally recorded the matching benign Vite client rejection as an uncaught error.
- Fixed the `pageerror` callback to apply the same noise classifier and added a regression assertion for the exact observed message. Genuine uncaught page errors remain fatal.
- The project later showed a live preview after retry/reopen; timing and a fresh post-fix run were not captured. The fix is unit-tested but the T6 live run has not been rerun, so successful completion is not claimed.
- Lovable's ecommerce flow was exercised; its portfolio run stopped for lack of credits. No additional Lovable run was attempted.

## T7 image pipeline inspection

- Confirmed `core/server/src/image_generation_route.ts` and tests route POST requests at both `/images/generations` and `/v1/images/generations` to the same authenticated handler. The route-match fix is already present; no credentials or provider tokens were probed.
- The builder's actual blueprint path is `frontend/lib/workbench/blueprint-assets.ts` -> Core `ImageGenerationService` -> the workspace model gateway. It filters visuals into photo slots, issues an unbounded `Promise.all`, caps each operation at 30 seconds, and has no retry loop.
- The Core image service likewise sets blueprint slot requests to 30 seconds, accepts arbitrary decoded response bytes, and saves each result with a `.png` extension without verifying the raster signature or preserving WebP/JPEG formats.
- When generation fails, the builder emits a labeled SVG placeholder as `fallback`; the dashboard renders fallback tiles as finished. The existing provider failure path reports an HTTP status to the user, but the per-asset event does not include a structured stage/status/timing reason.
- Implemented contextual prompts from the blueprint and questionnaire, semantic safe slot names, a three-image concurrency cap, two retries, 60-second operation limits, raster signature validation with matching file extensions, and structured fallback/failure events. Fallback visuals are now shown as failed/retryable, a run with fallback slots is finalized as degraded, and retry outcomes are persisted after the new image is synced.
- The backend now validates degraded completion against the same build, manifest, file, and preview evidence as normal completion. It additionally requires a fallback/failure asset event from that run, unless browser QA was explicitly unavailable; stale project assets cannot justify degradation. The generated run summary no longer claims browser QA passed for degraded runs.
- Added an authenticated stock-image source endpoint with Pexels/Pixabay/Unsplash provider chaining, HTTPS host allowlists, redirect rejection, raster-signature and size checks, and attribution/license persistence. Blueprint failures now attempt this stock source before the labeled SVG placeholder.
- Blueprint rasters are format-validated and saved under `public/assets`; in web runtime they are also uploaded through the authenticated gateway to a workspace/app-scoped R2 key. R2 asset-bucket configuration defaults to the workspace bucket. Browser QA now checks loaded images and CSS backgrounds, rejects active SVG placeholders, and requires generated raster files to exceed 20 KB.
- Validation: backend stock-image and workspace-file verification tests (9 passed), backend compilation (passed), Core image-generation service (23 passed, including durable upload), Core IPC image schema and repair-app tests (5 passed), generated-image browser-QA regression (1 passed), gateway image upload/config/route tests (7 passed), gateway typecheck (passed), Core main-process typecheck (passed), and dashboard lint (passed with the existing `<img>` optimization warning). A broader `run_build` run had 8 environment-related failures (Windows symlink permission errors and timeouts); its image-specific regression passed. Frontend typecheck was not rerun; the previously observed malformed generated `.next/dev/types` files remain the known blocker.
- Live acceptance remains open: the current command environment has none of the FLUX, stock-provider, or R2 configuration variables, and the backend on port 3001 is unreachable. No live provider call, R2 write, or two-prompt run was performed. Both prompts still need verification for real raster output, persisted generated-asset rows, and forced-failure degraded status before T7 can be accepted.
- No provider credentials or secret values were printed or recorded.
- Follow-up live run `fb4a2cf8-114b-4ab0-ad8c-92524edf6399` (project “Noire Atelier”) recorded seven image slots as `fallback` with SVG data URLs. The image service's effective prompt was about 2,291 characters (blueprint prompt about 1,043 plus a 1,248-character `real-photography` prefix), exceeding the gateway's 2,048-character limit; the gateway logged `INVALID_REQUEST`. Stock sourcing also failed because no stock-provider credential was configured. The Core gateway later stopped responding, and the run's terminal state, raster upload, preview QA, and acceptance remain unverified.
- A local, uncommitted change sets blueprint image dispatch to `themeMode: "plain"` because blueprint prompts already include art direction. This avoids the redundant theme prefix but has not yet been validated against a live image request; it is not evidence that T7 is complete.

## T8 project hero on Recent / My Stores cards

- The code already has `Tenant`/`TenantApp.heroSnapshotUrl` and `heroSnapshotUpdatedAt`, an authenticated `/hero-snapshot` endpoint, a Recent/My Stores cover selector, and snapshot use in the dashboard's static first-paint flow.
- The dashboard now uses the Playwright browser-QA screenshot only for project hero updates. Capture waits for network idle, fonts, and decoded images; requires a varied 1440×900 WebP between 20 KB and 14 MB; and retries once. Failed QA or invalid capture does not update the hero.
- The authenticated backend routes that WebP to the Core gateway, which stores it at `projects/<id>/hero.webp` in R2 and returns a cache-busted public URL. The existing tenant/app snapshot fields then feed both Recent/My Stores and static first paint. Project cards show the captured image when available and a branded initials gradient while capture is pending.
- Focused capture, QA-payload, and storage tests passed in this session. The broader `run_build` test file still has Windows environment failures (symlink permission and Git-worktree timeouts). T8 acceptance remains open until live capture and both test projects are verified after hard refresh and sandbox destruction.

## T9 dynamic questionnaires in Planner and Builder

- Corrected the Core Builder path to dispatch directly to Core instead of the legacy `/api/v5/seltra/store/plan` preflight. Core's `planning_questionnaire` tool now calls the `seltra-fast` model with the latest user request, validates 3–5 distinct questions and blueprint-shape mappings, and retries invalid/provider failures once. The existing dock receives the validated questions; returned answers include their blueprint shapes.
- The Core run starts before the questionnaire is requested. If both generation attempts fail, the agent turn fails with `QUESTIONNAIRE_GENERATION_FAILED`; the dashboard records `run.failed` with that code and offers Retry / Skip. Choosing Skip starts a new Core turn with an explicit user choice, bypasses generation, and does not invent answers or preferences.
- The initial blueprint remains gated on a completed questionnaire or that explicit skip. Planner and Builder prompts request the same Core questionnaire flow; answers and shape mappings are included in the tool result and per-question answer events.
- Legacy backend planner changes from the earlier, out-of-scope attempt were removed. The legacy dashboard planner remains separate from the Core flow.
- Validation: focused questionnaire, blueprint, and prompt tests passed (28 passed, 44 filtered out); both handler questionnaire tests passed; Core main-process and dashboard frontend typechecks passed. The full handler test file had 116 passes and 4 unrelated error-payload assertion failures (generic provider message vs. expected diagnostic text); no questionnaire test failed.
- Authenticated sample-prompt runs are still required to confirm prompt-to-prompt question variation, the ≤8-second first-question target, and stored blueprint answers. T9 live acceptance remains open.

## T10 real-time todos, single source of truth

- Confirmed the old dashboard checklist was hardcoded to `app-files`, `preview-check`, and `workspace-sync`. The dashboard itself emitted extra `step.progress` snapshots on file writes and preview/sync completion; Core's `agent-tool:todos-update` event already supplies the blueprint-derived implementation plan from `update_todos`.
- Removed the synthetic platform checklist. The dashboard now renders the single Core todo plan live, persists its full snapshot once per run, and persists subsequent status changes as `{ todoId, status }` diffs. The persisted event reducer folds those diffs when restoring a run.
- Preview readiness, workspace sync, and saving stay in the run phase/status indicator rather than being represented as implementation todos. Per-item completion is gated on a corresponding `file.written` event; the final build/QA item is gated on successful `build.result` and passed `browser.qa`. Terminal cards show ready, degraded, or failed, clear active-item spinners, and offer Retry on failure.
- The approved-blueprint build prompt now asks Core to create one stable 6–9 item implementation checklist based on the approved blueprint.
- Validation: frontend typecheck passed; direct Node assertions passed for evidence-gated status transitions, initial-snapshot plus status-diff replay, and ready/degraded/failed outcome mapping. The old hardcoded platform todo IDs no longer appear in the Core dashboard path.
- Run-event volume should fall substantially because file-write and platform-phase events no longer emit duplicate todo-list progress events; verify `step.progress` counts during the next authenticated build. Live per-run event-count verification remains open.

## T11 Seltra branding in Core templates and preview

- Renamed the scaffold attribution component to `made-with-seltra.tsx` / `MadeWithSeltra` and updated its import and the web-template branding helper. The scaffold README, `AI_RULES.md`, and `index.html` were already Seltra-branded.
- Moved Core-generated media and screenshot paths from `.dyad` to `.seltra`, including the media URL builder, QA screenshot path, prompts, dashboard preview classification, and backend project-file classification. Existing `.dyad/media` and `.dyad/screenshot` folders migrate on media access; file conflicts are surfaced without overwriting either copy. Git ignores and referenced-app file/search guards cover both new media folders and legacy metadata. Internal Dyad media protocol/API identifiers remain unchanged.
- Renamed the preview service-worker assets and route to `seltra-sw.js`. The injected registration script first unregisters registrations whose active, waiting, or installing worker script URL ends in `dyad-sw.js`, then registers `seltra-sw.js`. Updated the proxy route test and Seltra screenshot console tags.
- Renamed the generated Vite HMR wrapper to `.seltra-vite-hmr.config.mjs`, and changed the scaffold runtime default to `/opt/seltra/scaffold` with `SELTRA_SCAFFOLD_DIR`. The smoke check uses the same path. Third-party package names, lockfile contents, and upstream template provenance were not changed.
- Validation: Core main-process typecheck and dashboard frontend typecheck passed; backend workspace-file verification passed (7 tests). The generated Vite scaffold build passed. Core service-worker registration (1), proxy route/authority (20), scaffold branding (1), HMR wrapper (1 focused), media migration (2), media protocol (14; two symlink cases skipped because Windows denied symlink creation), referenced-app guards (resolve context 7, file listing 23, grep 55, read-file 61), and image-generation media-path regression (1) passed. An initial broad `app_runtime_service` run under parallel load had two unrelated timing failures; the focused HMR test passed. Browser preview, live service-worker upgrade, persisted-media upgrade in a running app, and live screenshot/QA acceptance remain unverified.

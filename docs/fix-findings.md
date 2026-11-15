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

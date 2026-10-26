# Web port blockers

## 2026-10-15 - M4 acceptance still partial

- The owner-provided screenshot shows pnpm's `added` count reaching 376 between
  15:01:00 and 15:01:22 (about 22 seconds). This shows progress in the visible
  install phase, but is not the requested isolated Windows timing measurement.
  The later preview delay still needs a same-machine install/readiness capture.
- Two consecutive direct first-prompt Build E2E runs passed (6.8 and 8.1
  minutes): streaming, generated files/version, preview, reload persistence,
  and Seltra wording on Home, Chat, and Settings. These runs do not cover Plan
  questions, the written-plan handoff, or socket-kill recovery. No consecutive
  passing runs of the complete M4 flow exist.
- The browser bridge has reconnect/retry behavior and focused unit coverage, but
  recovery of in-flight Plan/Build UI and machine resubscription after a killed
  socket remain without end-to-end evidence.
- The live `probe-model.mjs --context` run passed Kimi K2.7 Code and Llama 3.1 8B at ~20k input; Llama 3.3 Planner returned HTTP 413 and reported a 24,000-token ceiling. All configured models passed both streaming endpoints. The probe did not establish maximum output ceilings or test gateway usage-ledger/budget accounting; a fake-provider integration test is still needed for the reported token-budget failure.
- Web-mode blank React scaffolds use Seltra wording. The desktop-only Claude
  Code subscription experiment is hidden on web, and the two direct Build runs
  found no visible Dyad text on Home, Chat, or Settings. Error-banner wording
  is not covered by the browser assertion.
- The supplied old `app:list-screenshots` HTTP 400 has not reproduced: the two
  E2E runs recorded no API responses with status >=400. Keep the channel
  contract unchanged pending a fresh reproduction if it returns.
- No source comparison to a Git baseline is possible because this workspace
  lacks `.git` metadata.
## 2026-10-15 - M3 final verification

- **Cloudflare model compatibility is verified for configured text models.**
  The live sanitized probe passed both routes for Kimi K2.7 Code, Llama 3.3 70B,
  and Llama 3.1 8B fp8. The old Fast slug (`@cf/meta/llama-3.1-8b-instruct`)
  returned HTTP 410 from the OpenAI-compatible endpoint; `.env.web` now uses
  `@cf/meta/llama-3.1-8b-instruct-fp8`. No API credentials were printed.
- **First-prompt E2E does not pass end to end.** The fake provider chat
  completed, generated `src/App.tsx` and `src/App.css`, and the Code tree became
  usable after CodeView was decoupled from preview startup. The preview iframe
  did not become available within 180 seconds. The isolated runtime log showed
  pnpm installation progressing through 141 of 376 reused packages, then no
  further output. Root cause for the stalled install and runtime readiness is
  not yet established. E2E state is in `%TEMP%\seltra-web-e2e-dyad-main`; the
  owner's `.web-dev` and root `userData/` were not changed.
- **M3 error/restart matrix is incomplete.** No Playwright chat coverage yet
  asserts readable failures and reload recovery for model 404, provider 401,
  provider 429, and workspace-token rejection. No two-app/two-chat test across
  runtime restart was added. The gateway integration does exercise upstream
  401/404/429 mappings and session rejection, but it is not equivalent to the
  requested browser matrix.
- **The earlier `.web-dev` startup hang did not reproduce in a copy.** A full
  copy first hit Windows' path-length limit in generated E2E `node_modules`.
  Retrying while excluding that generated tree succeeded: the copied state
  booted on port 8083 and returned `200 {"ok":true}`. I did not start against
  the owner's original state. The earlier hang's cause is still unknown; the
  owner's `.web-dev` and root `userData/` remain unchanged.
- **Dynamic-port startup is fixed and verified.** The launcher started the
  runtime and gateway on port 8082 using a new temp state directory; health
  returned `200 {"ok":true}`. This exposed and fixed a hard-coded health check
  URL to port 8080. The test process was stopped afterward.
- **Upstream blank-app branding remains.** New blank apps still include the
  starter scaffold's “Welcome to Your Blank App / Made with Dyad” content.
  This is template content rather than a Seltra renderer string; replace it in
  the web-only scaffold or explicitly accept the upstream wording.
- **The final E2E gates are open.** M3 requires two consecutive full E2E passes;
  the latest run failed because the preview iframe never appeared. Do not mark
  M3 fully accepted until the install/runtime failure is rooted out and the
  full browser matrix passes.

## Resolved during M3

- `npm.cmd run web:test` passed with test-only gateway startup trace enabled:
  5 files / 17 tests, including gateway auth/session/channel policy, RPC and
  preview proxy, text/binary WebSocket frames, and 401/404/429 provider
  mappings.
- Focused formatter and reconnect suites passed 7/7 tests.
- `npm.cmd run web:build` passed after the CodeView loading fix; TypeScript
  stages passed and Vite transformed 5,350 modules. Existing CSS minifier and
  large-chunk warnings remain.

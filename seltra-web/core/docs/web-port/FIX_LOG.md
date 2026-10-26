# M1 fix log

## Round 10 - M5 first-render, browser links, and debug messages

- Before: the focused `MessagesList.test.tsx` assertion could not find the
  first-response status while the optimistic user row was present. The footer
  context was built from `persistedMessages` even though the visible transcript
  uses `useDisplayedChatMessages`; this excluded pending optimistic rows.
- Change: pass the displayed message list to the footer and render the web
  first-response status inline after its optimistic user row. When a web stream
  has no visible row, the transcript no longer replaces its content with a
  centered streaming status. Desktop rendering remains on its existing branch.
- F2 change: the web bridge handles `open-external-url` locally, accepts only
  HTTP(S), and opens a new tab with `noopener,noreferrer`. This avoids calling
  the host's browser launcher. The preview still uses its current `appUrl`; a
  fresh-token-on-expiry path and browser-level preview assertion are not yet
  implemented.
- F5 change: web System Messages filters `[DEBUG]` entries from the open panel
  and collapsed latest-message summary. No protocol identifiers, headers, or
  worker log names were changed.
- Build evidence: `npm.cmd run web:build` passed after the final source change;
  runtime and gateway artifacts built, `npm run ts` stages passed, and Vite
  transformed 5,352 modules. Existing CSS syntax and large-chunk warnings were
  emitted.
- Test evidence: `npm.cmd test -- src/web/client/open_external_url.test.ts
src/components/chat/MessagesList.test.tsx` passed: 2 files, 8 tests. Earlier
  before/after run: the chat test failed to find the inline status before
  passing the optimistic displayed messages into the footer. URL cases cover
  HTTP(S), `javascript:`, `data:`, `file:`, and the no-opener window options.
- Seam evidence: `node scripts/web/seam-check.mjs` printed
  `All changed existing files are listed in ALLOWED_SEAMS.md.`
- Remaining F1 evidence: no 3-second fake-provider Playwright timing run was
  captured, so the 500 ms user-visible target and submit-to-first-token timing
  remain unverified.
- Remaining M5 scope: F3 internal tools, F4 web publishing, F2 preview-token
  refresh/browser E2E, F5 full no-Dyad Playwright sweep, F6 Plan/Build socket
  kill E2E x2, and F7 production hardening/deployment audit were not completed
  in this round. See `ACCEPTANCE.md` and `DEFERRED_DYAD_HOSTS.md`.

## Round 9 - M4 first feedback, model budget, reconnect, and web seams

- The supplied trace shows pnpm advanced from 33 to 376 added packages from
  15:01:00 to 15:01:22 (about 22 seconds in the visible log). That proves the
  install was progressing in that interval; it is not a standalone Windows
  scratch-copy timing run, and it does not explain the later preview delay.
- Empty streaming chats now show an accessible “Starting your response…” state.
- The web Builder context default is 262,144 tokens (Cloudflare catalog lists
  Kimi K2.7 Code at 262.1k). Planner remains 24,000 tokens based on the
  reported Cloudflare rejection. Output limits are configurable by role and the
  gateway clamps output to the remaining context after its input estimate and
  safety margin. `probe-model.mjs --context` now supports a sanitized ~20k
  input probe; live result: Kimi and Llama 3.1 8B accepted it, while Llama 3.3 Planner returned HTTP 413 and reported a 24,000-token ceiling. All configured models passed the dual streaming routes.
- The observed “Seltra token budget exceeded” can arise because gateway
  per-run request/token/wall-clock limits were keyed to workspace+day when the
  request omitted a run ID. Those limits now apply only to explicit run IDs;
  the workspace daily limit still applies. Added more actionable budget text.
  No fake-provider budget/usage-ledger integration test was added yet.
- The browser bridge now broadcasts connection state, retries with bounded
  backoff, exposes an immediate Retry action, and uses a shorter actionable
  session wait. A global web-only banner surfaces recovery. The existing bridge
  test closes and reconnects a socket; complete in-flight Plan/Build recovery
  and E2E socket-kill coverage remain open.
- `connection-flow:get-states` returns a local disconnected state in the
  browser. `version-preview:release-window-interest` is narrowly allowed for
  cleanup of the renderer-owned preview actor; other release and recording
  channels remain disabled. The integration script verifies `plan_handoff`
  subscribe and the channel policy tests verify the new cleanup exception.
- Web-created blank React scaffolds receive Seltra wording; desktop behavior
  and imported templates are unchanged.
- Settings now explicitly uses Seltra provider/integration descriptions in web
  mode and hides the desktop-only Claude CLI subscription experiment, whose
  description exposed a remaining visible “Dyad” reference in the first E2E.
- The isolated E2E harness can set separate runtime and gateway startup waits;
  its readiness allowance is 180 seconds while normal launcher defaults remain
  60 seconds. This resolved the intermittent pre-browser 60-second readiness
  failures observed in this environment.
- Verification: `npm.cmd run web:test` passed (gateway integration, 3 probe
  tests, 5 Vitest files / 18 tests). `npm.cmd run web:build` passed, including
  TypeScript and 5,351 Vite modules. Build retains existing CSS minifier and
  large-chunk warnings. The first post-build E2E completed the direct Build,
  preview, reload, and reached Settings in 4.7 minutes, where it failed the
  no-Dyad assertion on the Claude CLI subscription description. After hiding
  that desktop-only setting in web mode and rebuilding, the direct first-prompt
  Build E2E passed twice consecutively (6.8 and 8.1 minutes). Both runs covered
  streamed response, generated files, version, preview, reload persistence,
  and no-Dyad text on Home, Chat, and Settings. This is not the requested Plan
  questionnaire/handoff or socket-kill recovery flow.
- Acceptance remains partial. See the M4 status in `ACCEPTANCE.md` and
  `BLOCKERS.md`; no full Plan→Build acceptance or two consecutive E2E passes
  are claimed.

Date: 2026-10-14 (UTC)

## Round 0 — WebSocket frame regression proof

- Symptom: authenticated renderer waited for a runtime session without any
  visible errors.
- Before fix: temporarily restored the original gateway `send(data)` forwarding
  and ran `node scripts/web/build-gateway.mjs; node scripts/web/test-gateway.mjs`.
  The integration failed with `Error: No runtime session frame.`
- Root cause: `ws` supplies a Buffer for incoming frames; forwarding it without
  `{ binary: isBinary }` changed a text session frame into a binary frame.
- Change: preserve frame type in both gateway directions, avoid parsing binary
  frames as JSON, and make the bridge parse string, Blob, and ArrayBuffer data.
- After fix: `node scripts/web/build-gateway.mjs; node scripts/web/test-gateway.mjs`
  printed `Gateway integration PASS: auth, owned sessions, channel policy, RPC
proxy, text/binary WebSocket frame preservation.`
- Bridge proof before fix: restored `JSON.parse(String(event.data))` and ran
  `node node_modules/vitest/vitest.mjs run
src/web/client/install_bridge_session.test.ts`; it failed with
  `Test timed out in 5000ms.` Restored Blob/ArrayBuffer handling; the same test
  passed as part of `npm.cmd run web:test` (1 test passed).

## Round 1 — Bootstrap response assertion

- Symptom: the E2E test did not observe the bootstrap response although the
  gateway log showed `window-infrastructure:bootstrap` returning 200.
- Root cause: the channel colon is percent-encoded in the RPC URL.
- Change: decode the pathname before matching the bootstrap route; attach the
  actual E2E run's isolated gateway/runtime log tails.
- Result: the test passed session-frame and bootstrap assertions, then failed
  because the `New App` button is in the Apps sidebar section.

## Round 2 — Apps sidebar

- Symptom: renderer was mounted but `New App` was not visible in the initial
  screenshot snapshot.
- Root cause: this UI starts with the Home page and the Apps sub-list is not
  selected.
- Change: click the existing `Apps` navigation item before asserting `New App`.
- Result: the assertion passed; the final console-error assertion exposed
  expected desktop-only startup queries reaching disabled gateway channels.

## Round 3 — Web-only UI query fallbacks

- Symptom: startup requests to subscription, telemetry, native theme, free
  quota, and theme-list channels returned 403; `getThemes` and
  `getCustomThemes` also logged bridge errors.
- Evidence: Playwright API capture listed `codex-subscription:status`,
  `get-initial-load-telemetry-context`, `get-subscription-status`,
  `native-theme:get-state`, `free-agent-quota:get-status`, `get-themes`, and
  `get-custom-themes` as denied. The gateway still denies these channels to
  direct callers.
- Change: the web bridge returns local, read-only defaults for those UI queries.
  Also preserve positional `undefined` arguments in the bridge/RPC body so
  void-input IPC contracts continue to receive `undefined`, not JSON `null`.
- Focused result: `npm.cmd run web:test` passed: 5 test files, 16 tests; gateway
  text/binary frame integration passed.
- Browser result: `npm.cmd run web:build` passed with 4,296 modules transformed;
  `npm.cmd run web:e2e` passed. Playwright printed
  `[web-e2e] API response statuses: []`.

## Round 4 — Repeat browser run

- Change: none.
- Result: second consecutive `npm.cmd run web:e2e` passed; output again showed
  `[web-e2e] API response statuses: []` and `1 passed (44.7s)`.
- Scope: the current browser test proves login, runtime text session delivery,
  successful bootstrap, a mounted root, the Apps sidebar, and `New App`. It does
  not yet exercise app creation, model selection, chat, preview, reload, or
  runtime reconnect.

## Round 5 — Telemetry and Monaco CDN behavior

- Change: skip `posthog.init` in web mode and configure `@monaco-editor/react`
  to use bundled Monaco plus Vite worker bundles for the editor and language
  services. Desktop initialization remains on the existing loader path.
- Build: `npm.cmd run web:build` passed TypeScript and Vite; 5,348 modules were
  transformed. The output included local editor, JSON, HTML, CSS, and TypeScript
  worker assets.
- Browser: the first `npm.cmd run web:e2e` attempt timed out waiting for the
  runtime launcher; its retry passed, and the immediate repeat passed. Both
  successful runs reported no failed API responses and no PostHog request.
  The test aborts any `cdn.jsdelivr.net` request and records CDN requests; the
  Code tab was not opened because this E2E still does not create an app, so the
  required Code-tab-with-a-file assertion remains open.

## Round 6 — Focused suite timing

- Symptom: under a loaded concurrent Vitest run, the Blob-session test exceeded
  the default 5-second per-test limit; isolated execution passed in 3.1 seconds.
- Change: give this bridge startup integration test a 20-second budget to allow
  for the observed Windows worker load.
- Result: `npm.cmd run web:test` passed 5 files / 16 tests; the bridge test took
  4.5 seconds in the confirming run. The gateway text/binary integration passed.

## Round 7 - Cloudflare model preflight catalog shape

- Symptom: `npm run web:dev` exited with `Unknown Cloudflare text-generation
model slug ... Available streaming text-generation slugs: none returned.`
- Root cause: Cloudflare's model search expects the task name `Text Generation`
  and returns `task` as an object with a `name` field. The preflight sent the
  internal slug `text-generation` and only recognized string task values, so
  the successful response contained no matching models.
- Change: query the documented task label, request up to 100 catalog entries,
  and accept Cloudflare's object task shape (while retaining string compatibility).
- Tests: `node --test scripts/web/model-preflight.test.mjs` passed 2/2 tests.
  A live sanitized check using `.env.web` confirmed the configured Kimi slug is
  present among 36 text-generation entries. No credential values were printed.
- Launcher check: `npm.cmd run web:dev` passed catalog and both ABI checks,
  built runtime/gateway/renderer, then timed out starting the existing default
  web runtime state. Re-running with isolated state
  `.web-dev/runtime-startup-check` and `DYAD_WEB_SKIP_BUILD=1` started the
  launcher at `http://localhost:8080`; an external local health request returned
  `HTTP 200: {"ok":true}`. The browser-test suite's separate local test gateway
  still times out during startup; see `BLOCKERS.md`.

## Round 8 - M3 model, startup, and first-chat evidence

- Model routing: provider seeds now use the configured `AI_MODEL_*` slugs,
  gateway role resolution recognizes those slugs, and the catalog returns
  upstream model IDs. Launcher model preflight now calls each text model over
  both supported streaming routes and names the configuration fields on
  failure. The live Cloudflare probe could not complete from this environment;
  therefore real-provider compatibility remains unverified.
- Workspace token diagnostics: gateway rejects identify only
  `TOKEN_MISSING` or `TOKEN_MISMATCH`; secrets are not logged. The local
  gateway integration and web suite passed, including status mapping for
  upstream 401/404/429. The requested two-app/two-chat/restart regression is
  still outstanding.
- First-chat E2E: fake-provider chat completed and wrote `src/App.tsx` and
  `src/App.css`; the version and chat UI rendered. The Code pane then remained
  on “Loading files…” while pnpm dependency installation was running. Runtime
  `app_runtime_service` logs showed the app start still in package installation
  after 141 of 376 packages were reused. `PreviewPanel` was passing runtime
  start state as CodeView's file-loading state. CodeView now waits only for its
  app query. Windows `npm.cmd run web:build` passed after this change (5,350
  Vite modules; TypeScript stages passed). The next E2E exposed that package
  installation still did not finish, so the preview iframe was unavailable
  after 180 seconds. Code/file browsing advanced past its former failure; the
  full first-prompt E2E did not pass.
- Error dates: malformed web chat/app dates now use safe formatting, with
  focused formatter tests passing. A browser reproduction of invalid dates and
  a mid-stream provider 404 is not yet captured.
- Web UI: pnpm-install, browser-notification, and Dyad documentation actions
  are hidden in web mode; the error boundary gives reload-page guidance. The
  blank-app scaffold still carries upstream “Made with Dyad” content.
- Gateway integration startup: prior no-output health failures were
  intermittent. With test-only startup-stage tracing, `npm.cmd run web:test`
  passed: 5 files / 17 tests; focused bridge/date tests passed 7/7. No
  conclusion about the owner's existing `.web-dev` startup state was reached;
  it remains untouched.
- Final acceptance is partial: there was no passing end-to-end run after the
  M3 changes, no two consecutive passing runs, no real Cloudflare model probe,
  and no complete failure/reload matrix. See `ACCEPTANCE.md` and
  `BLOCKERS.md` for exact remaining gates.

### M3 follow-up - corrected probe and startup evidence

- The user's sanitized probe table showed OpenAI-compatible HTTP 200s and
  Cloudflare `/ai/run` HTTP 400s for otherwise valid chat models. Root cause:
  the probe sent `prompt` instead of `messages` to chat-model run endpoints.
  Cloudflare's endpoint also requires the literal `@cf/author/model` path;
  percent-encoding the model slug breaks route matching. The probe now builds
  the documented request shape and has a regression test. A live probe passed
  Kimi K2.7 Code, Llama 3.3 70B, and Llama 3.1 8B fp8 over both routes.
- The configured Fast slug returned HTTP 410 on the app's
  OpenAI-compatible route despite remaining in the catalog; `.env.web` now
  points to the verified current fp8 slug. The default and reasoning slugs
  remain unchanged.
- Startup performance: validate configured models first; only scan catalog
  alternatives when one fails. This avoids dozens of model requests on each
  launch. Probe request timeout is 45 seconds to allow cold starts.
- An isolated-state, port-8082 startup exposed another root cause: `dev.mjs`
  hard-coded its health poll to port 8080. It now uses the configured gateway
  port for the poll, allowed-origin defaults, and startup URL. Isolated startup
  passed and `/healthz` returned `200 {"ok":true}`. The owner service and
  `.web-dev` were not altered.
- For the requested old-state reproduction, a complete `.web-dev` copy first
  hit Windows' path-length limit in generated E2E dependencies. A second copy
  excluded `.web-dev/e2e` and `node_modules`; it booted on port 8083 and returned
  `200 {"ok":true}`. The original state was never started or changed, so the
  earlier hang's cause remains unconfirmed. Both test process trees were stopped
  and temporary copies removed.
- Reran `npm.cmd run web:test`: gateway integration passed; 5 Vitest files / 17
  tests passed; all three model-probe unit tests passed.
- The first-prompt E2E remains blocked by pnpm install/runtime preview startup;
  no passing full run or consecutive final runs are claimed.

## Round 11 - builder budget, generated app branding, and browser popup

- The supplied failure was a workspace daily input-token budget rejection:
  `1,985,272 estimated input tokens used; daily limit 2,000,000`, while the
  generated app had 8/10 to-dos complete. This is the gateway ledger, not a
  model context-window error. Switching providers would still use the same
  workspace budget.
- Raised default `MODEL_MAX_TOKENS_PER_RUN` and
  `MODEL_MAX_TOKENS_PER_WORKSPACE` to 6,000,000 in gateway config and the web
  launcher; added matching `.env.web` settings and documented defaults in
  `.env.web.example`. Explicit deployment overrides remain supported. Focused
  config tests cover both 6M defaults and 5M overrides.
- Web-created Vite apps now receive the supplied Seltra mark in `public/`, a
  `/seltra-mark.png` favicon, and a fixed bottom-right `Built with Seltra`
  attribution in `index.html`, outside generated React components. The
  scaffold test verifies the HTML, text, and copied icon.
- Two consecutive full E2E runs passed (3.1 and 4.6 minutes). They rendered the
  generated preview, confirmed the Seltra badge/favicon, opened the tokenized
  preview in a new tab through More options, reloaded the chat, and visited
  Settings. API statuses >=400 were empty on both runs. The test asserts the
  generated file through its modified-files row and verifies `Volta Gold` in
  the rendered preview rather than assuming it is in `src/App.tsx`. It waits
  for renderer requests to settle before checking for browser errors, so
  navigation-aborted RPCs are not misreported as application errors.
- Removed prompt/query/URL/path values from image-generation, search, fetch,
  and crawl application log lines. Internal Seltra tool providers, usage-ledger
  accounting, SSRF controls, and the scoped no-Dyad-network test remain open.
- Verification: `npm.cmd run web:build` passed (runtime/gateway,
  TypeScript stages, and 5,352 Vite modules; CSS syntax and large-chunk warnings
  remain); focused Vitest passed 4 files / 12 tests. The popup selector E2E
  initially failed because it targeted a hidden toolbar action; the generated
  file selector was also made explicit after a strict-mode ambiguity. Final
  consecutive E2E passes completed with no API >=400 statuses. Repository lint
  still reports an unrelated unused `user` in
  `server/src/prisma_control_store.ts`.
- Final evidence commands and output: `npm.cmd run web:e2e` twice consecutively
  (`1 passed (3.1m)` and `1 passed (4.6m)`; each printed
  `[web-e2e] API response statuses: []`); focused `npm.cmd test --
src/web/gateway_budget.test.ts src/web/template_branding.test.ts
src/web/client/open_external_url.test.ts
src/components/chat/MessagesList.test.tsx` (`Test Files 4 passed (4);
Tests 12 passed (12)`; the script's prerequisite Node tests also reported
  `tests 55`, `pass 55`, `fail 0`); `node scripts/web/seam-check.mjs`
  (`All changed existing files are listed in ALLOWED_SEAMS.md.`); targeted
  `oxfmt --check` (`All matched files use the correct format.`); targeted
  `oxlint` (`Found 0 warnings and 0 errors.`). The repo-wide format check still
  reports 33 pre-existing formatting issues; repo-wide lint still exits 1 on
  the existing unused `user` in `server/src/prisma_control_store.ts`.

## Round 12 - first prompt visible before response

- Reproduction: the owner screenshot shows an active build and planner
  questionnaire while the workbench transcript is blank.
- Root cause: normal chat composer submissions set
  `showOptimisticMessage: true`, but the first-prompt path in
  `FirstPromptProvider` omitted the flag. `MessagesList` correctly hid the
  empty web streaming placeholder, leaving no prompt row to render. Optimistic
  messages also lacked `createdAt`, so the web timestamp control had no value.
- Change: initial submissions now request the optimistic row only in web mode;
  optimistic rows get a creation timestamp. The web initial-response orb is
  rendered beneath the final user prompt until the assistant row arrives.
  Desktop first-prompt behavior is unchanged. Hybrid harness uses the shared
  request type.
- Tests: `npm.cmd test -- src/components/chat/MessagesList.test.tsx
src/components/chat/ChatMessage.test.tsx
src/chat_stream/optimistic_messages.test.ts` passed: 3 files / 8 tests.
  Coverage verifies the prompt row, response indicator, timestamp, copy action,
  edit-to-composer action, and optimistic timestamp creation.
- Build: `npm.cmd run web:build` passed after aligning the hybrid harness type;
  runtime/gateway built, both TypeScript stages passed, and Vite transformed
  5,355 modules. Existing CSS syntax and large-chunk warnings remain.
- Artifact check: the rebuilt entry bundle contains the prompt row, response
  indicator, timestamp, copy, and edit selectors. Port 8080 health check
  returned `{"ok":true}`. Authenticated browser interaction and the required
  delayed-first-token Playwright timing measurement were not performed, so F1
  remains PARTIAL pending owner refresh/reproduction and latency evidence.

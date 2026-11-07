# Release checklist

Status reflects this checkout as of 2026-11-06. Production has not been touched.

## Phase 5 local acceptance attempt (2026-11-07)

- `cloudflared --version`: PASS (2026.10.7).
- Before startup, host-only guard: PASS for both Backend `DATABASE_URL` and `DIRECT_URL`; both match staging endpoint `ep-winter-salad-aqc12bzz`. Credentials were not recorded.
- Backend (3001): PASS after allowing outbound database access; `GET /api/v5/health` returned 200.
- Core (8080): PASS; local `GET /healthz` returned 200 with `execution=cloudflare`, `isolated=true`, and `gatewayReachable=true`. Startup model streaming checks and runtime native preflight passed.
- Temporary quick tunnel: `https://change-panels-characterized-percentage.trycloudflare.com` was issued and written as `CORE_PUBLIC_URL` in ignored `seltra-web/core/.env.web`. Public `/healthz`: PASS (200 with healthy Cloudflare execution). Core runs dual-stack so cloudflared's IPv6 `localhost` origin works.
- Authenticated gateway create/run/destroy self-test: PASS (`SELF_TEST_PASSED`).
- Targeted Playwright create/build/preview acceptance: FAIL before login, because the test expected `/login` but the isolated E2E server stayed at `/`. It did not create a project or reach build/preview.
- Project isolation, failed-create cleanup, idle cleanup, and RPC_HOST verdict: NOT RUN; the browser flow did not reach project creation.
- Playwright non-fatal startup check: PASS as a non-fatal skip in isolated web runtime. Affected features: `repair_app` screenshots and post-build browser QA are unavailable in that runtime. The attempted browser acceptance also stopped before generated-project creation, build, preview load, second-project isolation, and cleanup checks.
- Core typecheck (`npm run ts:main`): PASS.
- Web tests (`npm run web:test`): PASS (36 tests). The first sandboxed attempt was denied parent-directory access by esbuild; the rerun outside the sandbox passed.
- Gateway tests (`npm test`): PASS (7/7).
- `git diff --check`: PASS (line-ending warning only).
- Acceptance sandboxes: the authenticated gateway self-test completed its create/run/destroy lifecycle; the failed browser test stopped before creating a project. No acceptance sandboxes remained to delete.
- Publish flags remain off (`PUBLISH_ENABLED=false`). No production deploy or dispatch was run.

## Dev gateway disturbed-body fix (2026-11-07)

- Root cause confirmed in `seltra-web/edge/sandbox-gateway/src/index.js`: `WorkspaceSandbox.fetch` read each request body, then passed that same disturbed `Request` to the runtime and preview container proxies. Runtime RPC POSTs and preview POSTs could fail; response streaming and bodyless WebSocket upgrades share these proxy routes.
- Signed create/exec/files bodies are consumed locally by the DO and are not forwarded as the original request. The prior create/execute/destroy and empty-preview self-test did not send a body through `/runtime/*`, so it did not cover this failure.
- Fix: bounded body reads (24 MiB, `BODY_TOO_LARGE` on overflow), clean proxy `Request` construction from buffered bytes, and removal of gateway signing headers; runtime auth/session headers are retained only for runtime proxy calls.
- CI self-test now sends a signed JSON RPC body through the signed runtime proxy path and requires a valid echo response before destroy. Production remains gated on successful same-commit dev CI; no production dispatch is authorized here.
- Core maps gateway non-JSON and 5xx RPC replies to safe error codes and a request ID without returning upstream body content.
- Local verification: gateway tests PASS (12/12); Core typecheck PASS; Core web tests PASS (37 tests); `git diff --check` PASS. CI deployment, post-deploy self-test, Core list-apps/create-app, WebSocket ticket verification, and cleanup of the known failed-test workspace are pending.
- Fix commit: `4265533073199b44aa1afcc2fda2acc918aeb16d`.

1. **Dev self-test green — NOT RUN for the diagnostic fix.** Previous dev deployment's create/startup self-test failed after a 121.5-second timeout. New bootstrap, image smoke, and signed post-deploy checks must pass on `publish/p0-safety`.
2. **Willy's browser test passes — NOT RUN.** Require generated project build, preview load, second-project isolation, and cleanup evidence.
3. **Merge feature branch to main — NOT APPROVED / NOT DONE.** Review the production migration and auto-deploy safety gates first.
4. **Deploy prod gateway via manual dispatch (`environment=prod`, protected `production` approval) — NOT RUN.** The workflow requires a successful dev deploy/self-test of the same commit before this job can start.
5. **Set Render Core environment — NOT DONE.** Set production `SANDBOX_GATEWAY_URL`, production `SANDBOX_GATEWAY_SIGNING_SECRET`, Render Core `CORE_PUBLIC_URL`, and `EXECUTION_PROVIDER=cloudflare`; redeploy Core.
6. **Verify production `/healthz` and authenticated self-test — NOT RUN.** This checklist does not authorize production changes.
7. **Consider feature flags — OFF.** Keep `NEXT_PUBLIC_FF_PUBLISH=false` and `PUBLISH_ENABLED=false` until production health and publish review are complete.
8. **Rollback plan — PREPARED, NOT DRILLED.** Use the previous Worker version via `wrangler rollback` in CI, redeploy the previous Render Core release, and disable feature flags. Do not merge or deploy production as part of the dev browser test.

Before production release, verify the GitHub `production` Environment requires reviewers and restricts deployment branches to `main`. Gateway and deploy secrets belong only to the platform repository's Actions secrets; merchant repositories under `Seltra-Cloud` must contain none.

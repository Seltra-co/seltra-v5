# Publish P0b Report

## 1. Files changed

- `seltra-web/core/server/src/security.ts` — add exact `DEPLOY_MODE` name to the child environment strip patterns. `ALLOW_HOBBY_MODE_IN_PRODUCTION` was withdrawn by Amendment 1 rev 2 and was not added.
- `seltra-web/core/src/web/publish_security.test.ts` — cover `DEPLOY_MODE` filtering and confirm `GITHUB_CLIENT_ID` remains stripped by the `GITHUB_*` pattern.
- `docs/PUBLISH-P0B-REPORT.md` — this report.

The existing P0 commit is `f7c107e` (`security: harden publish runtime environment`) on `publish/p0-safety`.

## 2. Commands run and results

- `npm.cmd run web:test` with the P0 child filter — **failed**, gateway returned HTTP 503 for `/api/auth/me`.
- `npm.cmd run web:test` on a temporary baseline with only the P0 filter invocation reverted, then restored — **same failure**. Captured body: `{"ok":false,"error":{"code":"ENGINE_KEY_UNAVAILABLE","message":"A workspace-scoped Seltra Engine key is unavailable."}}`. Captured gateway log line: `{"event":"gateway_http_error","method":"GET","path":"/api/auth/me","status":503,"reason":"ENGINE_KEY_UNAVAILABLE: A workspace-scoped Seltra Engine key is unavailable."}`. This is pre-existing: the test entitlement mock omits `engineApiKey`, which the current entitlement contract requires. Supplying a synthetic key to the fixture made that gateway test pass; the temporary fixture change was restored.
- A test run with that temporary fixture correction — **34/34 Core unit tests passed**, plus 3 Node tests.
- Actual `WorkspaceSupervisor` child spawn inventory (names only) — **completed**. Variables present: `APPDATA`, `COMSPEC`, `DYAD_APPS_DIR`, `DYAD_TMP_DIR`, `DYAD_USER_DATA`, `DYAD_WEB_RUNTIME`, `DYAD_WEB_RUNTIME_ENTRY`, `DYAD_WORKSPACE_ID`, `GATEWAY_PORT`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `LOGONSERVER`, `MODEL_GATEWAY_URL`, `NODE_ENV`, `PATH`, `RUNTIME_RPC_HOST`, `RUNTIME_RPC_PORT`, `RUNTIME_RPC_SECRET`, `RUNTIME_SECRETS_KEY`, `SELTRA_ENGINE_API_KEY`, `SELTRA_ENGINE_CREDIT_IDENTITY`, `SYSTEMDRIVE`, `SYSTEMROOT`, `TEMP`, `TMP`, `USERDOMAIN`, `USERNAME`, `USERPROFILE`, `VITE_SELTRA_API_URL`, `VITE_SELTRA_STORE_SLUG`, `WINDIR`, `WORKSPACE_MODEL_TOKEN`.
- Secret-looking names from the requested patterns: `RUNTIME_RPC_SECRET`, `RUNTIME_SECRETS_KEY`, `SELTRA_ENGINE_API_KEY`, `WORKSPACE_MODEL_TOKEN`. `SELTRA_ENGINE_CREDIT_IDENTITY` is also sensitive signed identity material. None of the listed `CORE_*`, database URL, JWT, Cloudinary, Paystack, Moolre, or `CF_*` names survived the child filter.
- `node node_modules/vitest/vitest.mjs run src/web/publish_security.test.ts` — **2/2 passed** (after retrying outside the sandbox because esbuild could not read its config directory inside the sandbox).
- `GITHUB_CLIENT_ID` search — only desktop IPC `github_handlers.ts` uses it; the web child has no production path requiring it. It remains stripped.

## 3. Deviations and why

- No production path required a `GITHUB_CLIENT_ID` exemption, so no exemption was made.
- The child currently does not receive Willy's GitHub/Vercel/R2/publish variables through the gateway's curated `gatewayEnv`; they therefore do not appear in this actual spawn inventory. If passed later, the `WorkspaceSupervisor` filter strips them.
- No other P0b behavior was changed.

## 4. Open questions

- Fix the `web:test` entitlement fixture to supply its workspace-scoped engine key before P1B; the P0 filter is not the cause.
- William should review the listed surviving child names, especially the sensitive engine identity material.

## 5. What could not be verified

- The inventory reflects a real `WorkspaceSupervisor` spawn in this local environment; it is not a Render process inventory.
- No secret values were printed or recorded.

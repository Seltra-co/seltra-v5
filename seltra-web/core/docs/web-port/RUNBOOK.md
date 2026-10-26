# Seltra web M1 runbook

## Start

1. `npm install`
2. `npm run web:build`
3. `npm run web:dev` (first run creates `.env.web` and exits)
4. Configure matching `CORE_TOKEN_SECRET` and `CORE_SERVICE_SECRET` in Nest and `.env.web`; set `NEST_INTERNAL_URL`, the frontend origin, and model provider values.
5. Run `npm run web:dev`, start `frontend` on port 3000, then open `http://localhost:3000`.

Do not open port 5173 for the complete app. `npm run dev:web` starts only the renderer and is blocked by default.

## Prerequisites

- Windows 10/11 and Node.js 24.x (`npm.cmd` is available on PowerShell installations with script execution restrictions).
- Dependencies installed at the repository root. The pinned web gateway and Node native modules are installed by this repository's package manifests.
- A Cloudflare account and API token for real model chat. The UI can be checked without model credentials.

For real chat, set either `MODEL_ACCOUNT_ID` (Cloudflare) or `MODEL_BASE_URL` (OpenAI-compatible service). Optional aliases are configured with `AI_MODEL_DEFAULT`, `AI_MODEL_REASONING`, `AI_MODEL_FAST`, `AI_MODEL_VISION`, and `AI_MODEL_IMAGE`.

Other settings include `GATEWAY_HOST`, `GATEWAY_PORT` (must be 8080 for M1), `GATEWAY_ALLOWED_ORIGINS`, `PREVIEW_BASE_DOMAIN`, `PREVIEW_PUBLIC_SCHEME`, `PREVIEW_PUBLIC_PORT`, `MODEL_MAX_TOKENS_PER_RUN`, `MODEL_MAX_TOKENS_PER_WORKSPACE`, `MODEL_MAX_REQUESTS_PER_RUN`, `MODEL_MAX_REQUESTS_PER_WORKSPACE`, `MODEL_MAX_WALL_CLOCK_SECONDS`, and `MODEL_MAX_CONCURRENT_REQUESTS`. `DATABASE_URL` enables the optional Prisma store; otherwise development state is stored in `.web-dev/control`.

## Acceptance checklist

- [ ] Sign in through the Seltra frontend and open the tenant builder.
- [ ] Create an app, choose a Seltra model, and run Plan then Build prompts from `benchmarks/volta-gold/prompts.md`.
- [ ] Confirm streamed response, files, version history, preview iframe, and state after reload.
- [ ] Confirm desktop `npm start` still works.

## Build and checks

- `npm run web:build` builds the headless runtime, gateway, TypeScript targets, and web renderer.
- `npm run web:test` runs focused runtime bridge and filesystem tests.
- `npm run web:e2e` runs the isolated Playwright web suite.
- Local `web:dev` allows 180 seconds for runtime startup by default, matching the E2E launcher; override with `DYAD_WEB_RUNTIME_STARTUP_TIMEOUT_MS` when needed. Local runtime and gateway logs are reset for each launch so startup failures show the current run. The Render start command sets `SKIP_ELECTRON_ABI_CHECK=1`, preserving its existing startup timeout and log behavior.
- `web:dev` always validates the Node runtime native modules and skips Electron ABI checks by default outside production; set `SKIP_ELECTRON_ABI_CHECK=0` to run the Electron check outside production. Production skips the check only when `SKIP_ELECTRON_ABI_CHECK=1` is explicitly set.
- `node scripts/web/check-abi.mjs` validates native module loading for both Node and Electron.
- `node scripts/web/smoke-rpc.mjs` starts and restarts the runtime against a fake model server.

## Logs and reset

Runtime and gateway logs are `.web-dev/logs/runtime.log` and `.web-dev/logs/gateway.log`. They must not contain model prompts or credentials. Persistent web test state and generated secrets are under `.web-dev/`. Stop the launcher before deleting `.web-dev/` to reset the local web workspace and generated secrets. Never delete or inspect the repository's `userData/` as part of web reset.

## Known limits

The local development login is a single administrator account. Production preview-token behavior, public TLS, model-provider credentials, and a real browser run against Kimi need manual verification. Folder/ZIP import is unavailable in web mode. Container quotas and network egress require deployment-platform enforcement.

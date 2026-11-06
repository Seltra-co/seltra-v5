# Execution host policy

Seltra Core's execution provider is the Cloudflare sandbox gateway in every environment. Local Core and Render Core use the same signed HTTPS API. Core needs `SANDBOX_GATEWAY_URL` and `SANDBOX_GATEWAY_SIGNING_SECRET` for sandbox access. A remote runtime also needs `CORE_PUBLIC_URL`, a public HTTPS URL for its Core model API; a localhost URL cannot be reached from Cloudflare. The Cloudflare deploy token and account ID belong to the platform repository's GitHub Actions secrets and must never be configured in Core, Backend, merchant repositories, or generated applications.

`MODEL_ACCOUNT_ID` is the Cloudflare account ID used for Workers AI. When an R2 account ID is needed, `R2_ACCOUNT_ID` must match it. `MODEL_API_KEY` is only the Workers AI credential. It must not authenticate deployment, gateway, or R2 requests.

The host process provider is a local-only troubleshooting opt-in: `EXECUTION_PROVIDER=host` is accepted only when `NODE_ENV` is not `production`; it emits `NOT ISOLATED - DEV ONLY` at startup and on `/healthz`. It is never the default and is never a browser-test fallback. Docker Desktop and local `wrangler dev` are not part of this workflow.

## Cloud-only local startup

1. Complete the Cloudflare/GitHub/Render one-time checklist in [CLOUDFLARE-SANDBOX-NOTES.md](CLOUDFLARE-SANDBOX-NOTES.md).
2. Confirm the dev Worker has been deployed and its authenticated gateway self-test passes.
3. Put `EXECUTION_PROVIDER=cloudflare`, `SANDBOX_GATEWAY_URL`, `SANDBOX_GATEWAY_SIGNING_SECRET`, and a reachable `CORE_PUBLIC_URL` in the ignored `seltra-web/core/.env.web`. Keep deploy credentials out of that file.
4. Start Backend, Core, and Frontend using [PUBLISH-LOCAL-DEV.md](PUBLISH-LOCAL-DEV.md). Core must fail fast and list only missing variable names if configuration is incomplete. At startup it checks gateway reachability and runs a signed create, command, and destroy self-test.

No local preview, build, publish, or browser test may silently fall back to host execution.

## Container boot diagnostics

The dev image starts a dependency-free bootstrap listener on port 8788 before it spawns the runtime on RPC port 8787. `GET /__ready` returns success only after the authenticated RPC listener responds; `GET /__boot-status` reports phase, process exit, Node/platform/architecture/libc, memory, required environment variable names present or missing, and a redacted runtime log tail. It never returns environment values. A signed `GET /v1/workspaces/<workspaceKey>/diag` returns the same status plus container state and last exit/error code.

Create failures use `CONTAINER_NOT_STARTED`, `CONTAINER_EXITED`, `PORT_NOT_LISTENING`, `RUNTIME_CRASHED`, or `RUNTIME_TIMEOUT`. The Worker logs the instance (`standard-2`), 180-second port-ready budget with exponential backoff, and 30-minute inactivity timeout. Failed creates collect boot status and destroy the container. GitHub Actions builds and boots the Linux/amd64 image, verifies glibc and native modules, runs a command and static HTTP smoke, then runs a signed dev create/exec/diagnostics/cleanup check. The empty-project preview probe expects 404; it does not stand in for a generated-app preview test.

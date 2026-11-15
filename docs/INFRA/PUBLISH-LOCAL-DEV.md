# Publish local development configuration

This is a local service startup reference, not a readiness signal. Do not connect the Backend to Neon until the database URL is confirmed to target staging. Local Core must use the deployed dev Cloudflare gateway; it must not run a local container, `wrangler dev`, or silently fall back to host execution.

## Environment files

- Backend: copy `seltra-web/backend/.env.example` to `seltra-web/backend/.env`. Keep its `DATABASE_URL` and `DIRECT_URL` pointed at a disposable/local or staging database. Set `CORE_TOKEN_SECRET` and `CORE_SERVICE_SECRET` to the same values used by Core.
- Core: copy `seltra-web/core/.env.web.example` to `seltra-web/core/.env.web`. Use the same two Core secrets as Backend. Configure `EXECUTION_PROVIDER=cloudflare`, the deployed dev gateway URL, its signing secret, and a reachable public `CORE_PUBLIC_URL` for the remote runtime's model requests. Its workspace root must resolve under the operating system temp directory and remain outside `DATA_ROOT`.
- Frontend: copy `seltra-web/frontend/.env.example` to `seltra-web/frontend/.env.local`. Keep `NEXT_PUBLIC_FF_PUBLISH=false` until the live-provider, persistence and isolation gates pass.
- Never commit these local env files or paste their values into logs/issues.

Core startup must validate required/invalid configuration and report variable names only. The Cloudflare gateway must pass its signed startup self-test. The explicit host opt-in is marked `NOT ISOLATED - DEV ONLY` in its startup banner and `/healthz`, and is prohibited in production; it is not a browser-test fallback.

When a container fails to start, the signed gateway route `/v1/workspaces/<workspaceKey>/diag` reports its container state, error code, boot phase, process exit, Linux architecture/libc, missing environment variable names, and redacted log tail. The bootstrap reserves port 8788 for readiness and status; runtime RPC stays on 8787. The standard-2 container gets up to 180 seconds to become ready. Do not interpret the Actions static-server check or an empty-project preview 404 as a successful generated-project preview.

## Local startup order

Use three terminals from the repository root. Confirm the Backend database target before starting it.

1. Backend, port 3001:

   ```powershell
   cd seltra-web/backend
   npm.cmd run dev
   ```

2. Core, port 8080:

   ```powershell
   cd seltra-web/core
   npm.cmd run web:dev
   ```

3. Frontend, port 3000:

   ```powershell
   cd seltra-web/frontend
   npm.cmd run dev
   ```

Open `http://localhost:3000`. Check Backend health, Core `http://localhost:8080/healthz` (provider must report Cloudflare and a reachable gateway), sign-in, app creation, build and preview. Publish remains unavailable until the publish gates documented in the handoff pass.

## Public API requirement for real deployments

`PUBLISH_PUBLIC_API_URL` must be a publicly reachable HTTPS Backend base for the disposable test environment and must end in `/api/v5`. Core normalizes a base URL to that suffix. A localhost URL is only usable for local-only checks; Vercel-hosted output cannot reach the developer's localhost. Before real publish, provision a disposable staging Backend endpoint or an explicitly secured temporary tunnel to a Backend connected only to staging/test data, then put that public URL in Core's ignored `.env.web`. The present checkout does not establish which safe public endpoint is available, so no endpoint is guessed here.

## Kill switch and recovery

- Stop new publishes by setting Core `PUBLISH_ENABLED=false` and Frontend `NEXT_PUBLIC_FF_PUBLISH=false`, then restart both services.
- Keep `WORKSPACE_PERSISTENCE_ENABLED` and `WORKSPACE_RESTORE_ENABLED` independent of the publish flag. Do not disable them to stop publishing if real persistence is in use.
- To roll back a live app, use its verified previous deployment through the dashboard only after the route/Worker gates pass. If route state is uncertain, disable new publishes and restore the last-known-good route record through the audited Core/Backend workflow. Do not edit production routes by hand.
- For current local development, no publish route has been verified, so there is no tested local rollback target.

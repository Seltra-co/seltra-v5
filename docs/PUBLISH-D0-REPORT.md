# Publish implementation discovery (D0)

Date: 2026-11-04

## D0-A: repository findings

1. Generated merchant storefronts use the Vite scaffold under `seltra-web/core/scaffold`; the browser-facing app is Next.js. Runtime dependency installation is handled by Core's existing package-manager resolver and isolated installer. The runtime image includes Git; its Dockerfile installs `git`. The app dependency cache is the workspace's `node_modules` tree and existing package-manager caches; no publish-specific shared cache exists.
2. The workspace supervisor creates `apps`, `userData`, `tmp`, and `logs`, then starts the runtime. I found no restore-on-demand or lazy-install-on-reopen lifecycle in the gateway. Preview readiness is currently the runtime RPC listener, not an install-on-missing-node_modules path.
3. `userData` is passed to the child as `DYAD_USER_DATA`; the exact per-workspace contents are runtime-owned and not represented by a manifest today. The on-disk Core control store in `seltra-web/core/server/src/control_store.ts` is JSONL (`control.jsonl`); Prisma control-store support also exists. There is no SQLite snapshot/restore bundle implementation in the web gateway.
4. The file control store persists workspace records and usage events to a mode-0600 JSONL file. Switching away from file mode would lose those records unless migrated. Existing persistence and `DATA_ROOT` paths remain untouched.
5. The gateway proxies chat requests and manages WebSocket sessions, but I found no completion-event hook that triggers workspace save points.
6. Git is installed in `seltra-web/core/runtime/Dockerfile`; web gateway code has no GitHub repo or push integration.
7. Render uses the Node `render:start` entrypoint. `seltra-web/core/server/src/main.ts` handles SIGTERM by closing WebSockets, preview proxy, child runtimes, Prisma, and Nest; it has no bounded persistence-before-shutdown hook.
8. The child process environment previously removed a fixed list of names, then explicitly injected runtime-specific credentials. The safety changes now also strip `R2_*`, all `GITHUB_*` (including the repo's existing legacy names), `VERCEL_*`, `WORKSPACE_MASTER*`, `ALERT_*`, and `PUBLISH_*`; the unrelated existing denylist remains.
9. No Cloudflare subdomain Worker or route-bucket format exists in this repository. Backend `Tenant.slug` is unique; `TenantApp` belongs to a tenant and is unique by `(tenantId, coreAppId)`. The schema has `ownerId` but no tenant-role model. V5 apps are represented by `TenantApp`; no V4 coexistence registry or live-store predicate was found. Existing Core `Publication` is a separate record and is not connected to a publisher workflow.
10. Dashboard placeholder: `seltra-web/frontend/app/(dashboard)/dashboard/page.tsx`, around line 3521. Store redirect: `seltra-web/frontend/app/store/[slug]/page.tsx`, lines 83-95; it redirects to any valid HTTP(S) `publishedUrl` without checking whether it points back to the same Seltra hostname.
11. Backend Prisma schema is `seltra-web/backend/prisma/schema.prisma`; migrations exist under `seltra-web/backend/prisma/migrations`. The Core gateway has its own Prisma schema, plus a Drizzle setup. The spec's Backend `TenantApp` model is additive here.
12. The scaffold reads `VITE_SELTRA_API_URL` and `VITE_SELTRA_STORE_SLUG`, not the spec's proposed `SELTRA_PUBLIC_URL` names. Framework support must be checked before allowing publishing; Vite SPA builds do not meet the spec's Next.js server-runtime description.

## D0-B: external behavior spikes

S1-S6 were not run. They require creating a throwaway repository and scratch project in a Vercel merchant team and validating GitHub organization linking, deployment pinning, protection, retention, logs, and Worker proxy behavior. Local credentials are present for GitHub/Vercel, but there is no `DEPLOY_MODE`, no R2 credentials/bucket configuration, and the spec expects a shared Pro team while the additional instruction calls for a Vercel Hobby development mode with public repos. No external scratch resources were created before reconciling these account modes. The Vercel/GitHub API shapes and production routing behavior therefore remain unverified.

## Safety-phase changes completed

- Removed the Moolre API-key debug log.
- Added prefix-based filtering for infrastructure secrets in child environments and redaction for GitHub, Vercel, payment tokens, authorization values, and private-key blocks.
- Confirmed `/v1/assets/:id` accepts only a 32-hex-character random identifier plus `.png` or `.jpg`; it does not authorize access, so this is a random unguessable asset URL rather than a user-authenticated endpoint.
- Auth refresh cookies currently omit `Domain`, so they are host-only. I found no `Domain=.seltra.co` setting in Backend/frontend code. No cookie scope change was needed.

## Verification and blockers

- Focused publish security tests: 2 passed.
- `npm run web:test`: gateway build passed, then an existing gateway integration assertion failed: “valid Seltra token maps to its Tenant workspace” received 503 instead of 200.
- Backend full test suite: 11 suites passed, 1 suite skipped; 92 tests passed, 1 skipped (157 s).
- A1-A14 and D1-D15 have not been run; no live deploy or route activation has been performed.

## Open decisions/dependencies

- Confirm supported publish framework: current generated scaffold is Vite, while the spec describes independently deployed Next.js apps with server handlers.
- Reconcile private repositories in the final spec with the explicit dev-only Hobby mode requiring public repositories. The requested `DEPLOY_MODE=hobby|team` switch is absent from `.env.web` and code.
- Provide/confirm a scratch merchant Vercel team or authorize the named GitHub/Vercel account for S1-S6; confirm whether the Hobby account is the scratch environment.
- Determine real V4 route storage and live-store ownership mapping before implementing slug conflict checks or deploying a Worker.
- Add R2 routes/workspaces configuration and `WORKSPACE_MASTER_KEY` before durability/deployment work can be exercised.

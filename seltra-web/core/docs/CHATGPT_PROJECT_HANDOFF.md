# Seltra Builder: ChatGPT Project Handoff

**Repository:** `1253William/cosgrave-builder`  
**Project identity:** Seltra Builder (an Electron desktop app with a separate browser-based runtime)  
**Prepared:** 2026-10-17  
**Purpose:** Give a future ChatGPT session enough repository-grounded context to understand the architecture, extend external-tool support safely, and help prioritize improvements toward the quality bar of leading AI app builders.

> This report is based on source and documentation in this checkout. It does not include local environment files, credentials, or a full security/deployment audit. Treat items marked “open” or “not verified” as unproven, not as implemented features.

## 1. How ChatGPT should use this handoff

Use this document as an orientation map, not as a substitute for reading the implementation before changing it. For any requested change:

1. Identify whether it targets desktop, the browser runtime, or both. Do not assume a desktop IPC feature is available in the web app.
2. Trace the contract, registration, service, persistence, and renderer surfaces that own the behavior before editing.
3. Read the applicable rules listed in [AGENTS.md](../AGENTS.md), including the IPC, local-agent-tools, error, database, web, and testing guidance where relevant.
4. Keep credentials out of source, reports, logs, prompts, and browser-visible data. Do not read or copy `.env.web`.
5. Preserve the web runtime's deny-by-default channel policy and workspace boundaries. Never make a channel public merely to make a feature work.
6. Add focused tests and state precisely what was and was not verified. Use `npm run web:test`, `npm run web:build`, and `npm run web:e2e` for web changes as appropriate; desktop behavior has separate tests.
7. Treat `src/pro` as Fair Source License code as described in [CONTRIBUTING.md](../CONTRIBUTING.md) and the [license](../src/pro/LICENSE).

## 2. Product and current shape

Seltra Builder turns prompts into web-app code, displays the conversation and tool activity, and runs an app preview. The repository contains two related products/runtime targets:

- **Desktop:** Electron shell, React renderer, privileged Node main process, local project files and processes.
- **Web:** React renderer served in a browser, a headless Node runtime that reuses selected application modules, and a gateway that authenticates browser sessions and mediates calls to that runtime and to the configured model provider.

The codebase is based on the Dyad app-builder architecture. The top-level [README](../README.md) and [docs/architecture.md](architecture.md) are useful user-facing summaries; [docs/agent_architecture.md](agent_architecture.md) documents the local agent tool loop.

Do not conflate these capabilities:

| Capability | Desktop source baseline | Browser/web source baseline |
|---|---|---|
| Create/edit app code, chat, preview | Core product | Built on the same renderer through a web bridge and isolated runtime |
| Model providers | Multiple provider adapters and model settings in the shared app | Web deployment uses a server-side model gateway and seeded Seltra model aliases |
| MCP and provider integrations | MCP manager, catalog, OAuth/consent, plus provider-specific handlers exist | Many integration, catalog, subscription, and provider channels are deliberately disabled by web policy |
| GitHub push and hosted deploy | Desktop integration surfaces exist | Full web publishing path is open/not verified; do not assume desktop handlers work in web |
| Filesystem/process isolation | Local machine permissions and application safeguards | Must be enforced by the deployment/container/orchestrator, not just application code |

The web port is an evolving, separately constrained target. Its [acceptance record](web-port/ACCEPTANCE.md) identifies some implemented slices and explicitly records publishing, integrated tools, full Plan/Build recovery, and production deployment/security gates as open or partial.

## 3. System architecture

### Desktop request path

```text
React renderer
    │ typed preload bridge (contextBridge; invoke/send/receive allowlists)
    ▼
Electron main process
    ├── trusted IPC handlers ── services / processors / actors
    ├── local-agent tool loop ── model provider(s) and optional MCP tools
    ├── Drizzle + SQLite state
    ├── Git, package manager, app dev server, tests, filesystem
    └── cloud APIs / OAuth integrations
```

The desktop Electron main process is privileged; the renderer should not gain direct filesystem, process, token, or provider access. IPC contracts are defined in typed modules under [`src/ipc/types/`](../src/ipc/types/), derived into channel allowlists in [`src/ipc/preload/channels.ts`](../src/ipc/preload/channels.ts), and registered in [`src/ipc/ipc_host.ts`](../src/ipc/ipc_host.ts). Handlers commonly use typed/trusted registration helpers instead of raw, easily searchable `ipcMain.handle` calls.

### Browser request path

```text
Browser React renderer
    │ installed compatibility bridge; HTTPS/HTTP RPC + WebSocket events
    ▼
Gateway (server/src/main.ts)
    ├── login/session cookie and JWT-backed workspace claims
    ├── browser RPC and event session authorization
    ├── model-compatible /v1 proxy, usage/budget controls
    ├── preview routing and static renderer serving
    └── control-store access
         │ private authenticated runtime RPC / event socket
         ▼
Headless Node runtime (src/web/runtime_main.ts)
    ├── Electron compatibility shim for selected existing modules
    ├── same typed IPC contracts/handlers, filtered by web channel policy
    ├── SQLite/Drizzle workspace data and app-local files/processes
    └── runtime-native modules built for Node ABI
```

Key boundaries:

- [`vite.web.config.mts`](../vite.web.config.mts) builds the React renderer to `dist-web`; a Vite plugin installs [`src/web/client/install_bridge.ts`](../src/web/client/install_bridge.ts).
- The bridge emulates the renderer-facing `window.electron.ipcRenderer` / `webFrame` surface. It handles a small set of web-local results, transports allowed calls to RPC, and carries event streams over WebSocket. It is a compatibility adapter, not a general replacement for Electron.
- [`src/web/runtime_main.ts`](../src/web/runtime_main.ts) is the headless entry point. It sets up runtime paths and secret storage, registers existing IPC handlers, initializes SQLite and supporting services, then listens on an internal RPC port. It does not execute the desktop `src/main.ts` bootstrap.
- [`src/web/rpc_server.ts`](../src/web/rpc_server.ts) accepts only authenticated internal requests, validates allowed channels, and checks app ownership/path boundaries before dispatch. The RPC secret is not a browser credential.
- [`server/src/main.ts`](../server/src/main.ts) contains the gateway's HTTP/WebSocket and proxy behavior. It handles login/session, `/healthz`, `/api/auth/*`, `/api/events`, `/v1/*`, static assets, runtime RPC proxying, and preview requests. [`server/src/app.module.ts`](../server/src/app.module.ts) is currently an empty Nest module; do not assume the gateway is implemented as a set of Nest controllers.
- [`src/web/channel_policy.ts`](../src/web/channel_policy.ts) is deny-by-default: only contract channels that classify as `PORT` or `SANDBOX` pass. `ADAPT` and `DISABLE` do not. Provider/integration channels are explicitly in the disabled class pending browser-safe equivalents.
- [`src/web/rpc_path_guard.ts`](../src/web/rpc_path_guard.ts) maps app-scoped channels and validates that referenced apps reside inside the runtime workspace's apps directory. Changes that add path-bearing channels must update and test this boundary.
- [`runtime/README.md`](../runtime/README.md) makes clear that a container image alone is not a security boundary. Non-root execution, read-only root filesystem, writable workspace/tmp only, network egress restrictions, CPU/memory/process/disk quotas, no Docker socket, and per-workspace secrets must be enforced by the deployment host/orchestrator. These deployment controls are not established merely by application code.

## 4. Main components and responsibilities

| Area | Main location | Responsibility |
|---|---|---|
| Renderer / product UI | [`src/renderer.tsx`](../src/renderer.tsx), [`src/pages/`](../src/pages/), [`src/components/`](../src/components/) | Home/library, app/chat views, code editor, preview panel, model/provider settings, plugins, media, templates, and integration UI. TanStack Router is used for navigation; React Query handles IPC-backed data, with Jotai for renderer state. |
| Main desktop bootstrap | [`src/main.ts`](../src/main.ts) | Electron app lifecycle, windows, protocol/native integration, and desktop startup. Not used as the web runtime entry. |
| IPC contracts/handlers | [`src/ipc/types/`](../src/ipc/types/), [`src/ipc/preload/`](../src/ipc/preload/), [`src/ipc/handlers/`](../src/ipc/handlers/), [`src/ipc/ipc_host.ts`](../src/ipc/ipc_host.ts) | Typed renderer-to-main contract, allowlisting, validation, domain endpoints, and registration. |
| Persistence | [`src/db/schema.ts`](../src/db/schema.ts), [`src/db/`](../src/db/) | Drizzle/SQLite application state: apps, chats/messages, providers/models, settings-related state, MCP servers/consents, versions, media, tests, and related entities. Schema changes need migrations. |
| Chat and model providers | [`src/ipc/handlers/chat_stream_handlers.ts`](../src/ipc/handlers/chat_stream_handlers.ts), [`src/ipc/utils/get_model_client.ts`](../src/ipc/utils/get_model_client.ts), [`src/ipc/shared/`](../src/ipc/shared/) | Chat request preparation, provider/model construction, streaming, budgets/admission, provider-specific behavior, model catalog, fallback/aliases. |
| Agent tools | [`src/pro/main/ipc/handlers/local_agent/`](../src/pro/main/ipc/handlers/local_agent/) | Agent loop, tool registry, tool execution, consent/safety, shell review, mutation tracking, plans, subagents, and dynamically loaded MCP tools. |
| App runtime / preview | [`src/ipc/services/app_runtime_service.ts`](../src/ipc/services/app_runtime_service.ts), [`src/ipc/services/app_runtime_orchestration_service.ts`](../src/ipc/services/app_runtime_orchestration_service.ts), [`src/components/preview_panel/`](../src/components/preview_panel/) | Install/start/stop app processes, preview URLs/domains, file watching, console/test integrations and preview UX. |
| Integrations | [`src/ipc/handlers/`](../src/ipc/handlers/), [`src/supabase_admin/`](../src/supabase_admin/), [`src/neon_admin/`](../src/neon_admin/), [`src/ipc/utils/mcp_manager.ts`](../src/ipc/utils/mcp_manager.ts) | GitHub/Git, Supabase, Neon, Vercel, Cloudflare, Coolify, MCP, OAuth, provider setup, deployment and database operations. Many are desktop-specific today. |
| Web runtime | [`src/web/`](../src/web/) | Headless bootstrap, Electron shim, browser bridge, web RPC server, channel policy, app path guard, preview URL translation, and web-specific behavior/tests. |
| Web gateway/control plane | [`server/src/`](../server/src/), [`server/prisma/schema.prisma`](../server/prisma/schema.prisma) | Browser login/session, RPC/event/model/preview proxy, usage budget, optional PostgreSQL-backed control data, publications/repair records. The Prisma store is optional; local default is a file control store. |
| Generated app scaffolds | [`scaffold/`](../scaffold/) | Starter app files/templates and generated-project conventions. Keep generated apps buildable, secure, and branded consistently. |
| Background workers | [`workers/`](../workers/), [`vite.*worker.config.mts`](../) | Code exploration and Supabase dependency analysis work off the Electron main thread. |
| Tests and benchmarks | [`src/**/*.test.*`](../src/), [`e2e-tests/`](../e2e-tests/), [`e2e-web/`](../e2e-web/), [`benchmarks/`](../benchmarks/) | Unit, integration, desktop E2E, web E2E, and model/app quality evaluation. Avoid calling a build or deployment “verified” based only on type-checking. |

### State and infrastructure

- Desktop product state uses SQLite via Drizzle; SQL migrations live in [`drizzle/`](../drizzle/).
- Web runtime uses its own per-workspace filesystem/database/runtime process arrangement. Local web development stores state under `.web-dev/`; do not confuse that with desktop `userData/`.
- The gateway defaults to a local/file control store when `DATABASE_URL` is absent and supports Prisma/PostgreSQL when configured. The current Prisma schema contains User, Workspace, UsageEvent, RepairAttempt, and Publication records; that is not proof that a complete production multi-tenant control plane is deployed.
- Web model access is routed through the gateway using a workspace token and configured provider/model aliases. [`src/web/seed_seltra_models.ts`](../src/web/seed_seltra_models.ts) seeds Builder, Planner, Fast, and Vision model entries. Browser code should not receive the upstream provider API key.
- Current web M1 documentation describes a single local administrator login. Production multi-user identity/authorization, isolation, and deployment guarantees need explicit implementation and verification before claiming SaaS readiness.

## 5. Agent and tool architecture

There are two related tool paths:

1. **Structured response tools:** the legacy/core chat path can encode actions in `<dyad-...>` XML-like output. The renderer parses and renders those tags; processor/handler code applies actions. See [`src/prompts/system_prompt.ts`](../src/prompts/system_prompt.ts), [`src/components/chat/DyadMarkdownParser.tsx`](../src/components/chat/DyadMarkdownParser.tsx), and [`src/ipc/processors/response_processor.ts`](../src/ipc/processors/response_processor.ts).
2. **Local Agent v2:** uses the AI SDK tool-call loop. [`local_agent_handler.ts`](../src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts) coordinates streamed model steps, tool calls, limits, cancellation, and subagents. [`tool_definitions.ts`](../src/pro/main/ipc/handlers/local_agent/tool_definitions.ts) assembles tools. Tools use shared types and policies in the neighboring `tools/`, `tool_invocation.ts`, and `types.ts`.

The tool registry includes file operations, dependency installation, SQL, Git inspection, search/read tools, web search/fetch/crawl, tests/build/type checks, image generation, integration setup, plans/blueprints, shell, and subagent capabilities. Whether a tool is offered depends on mode, settings, model, consent, and runtime context; do not add it only to an exported array without tracing those gates.

Important safety semantics:

- Tools declare schemas, descriptions, state mutation (`modifiesState`), consent defaults/previews, runtime gating, and executors.
- The tool invocation layer coordinates consent, blueprint approval, mutation tracking, and Git-visible file impact. Read [`rules/local-agent-tools.md`](../rules/local-agent-tools.md) before changing this path.
- Mutations need workspace/app ownership checks, path traversal/symlink defenses, cancellation, and clear errors. Avoid shell-based shortcuts where a scoped API is available.
- MCP results and tool names are sanitized; MCP tool loading is parallel and time-bounded. User consent can be asked per tool, remembered, or denied.
- The SDK can run tools in multiple steps and potentially in parallel. External actions need idempotency, timeout, retries, cancellation, useful progress, bounded outputs, and safe partial-failure handling.

## 6. Adding external tools and integrations

First choose the correct product surface:

### A. Add a model-facing agent tool

For a tool that the AI invokes inside a conversation:

1. Add a focused module under `src/pro/main/ipc/handlers/local_agent/tools/`, using an existing tool as a pattern.
2. Define a Zod input schema, clear model-facing description, `ToolDefinition`, `modifiesState`, consent preview/default, enablement conditions, and execution.
3. Validate app/workspace scope, user-provided input, response size, timeouts, cancellation, and provider failure cases. Use existing wrappers/services rather than embedding API credentials or ad-hoc fetch logic in a renderer component.
4. Register the tool in [`tool_definitions.ts`](../src/pro/main/ipc/handlers/local_agent/tool_definitions.ts) and trace mode/tool-selection logic. If its execution has a custom chat card, update the parser and component rendering path; if it has no new UI state, still ensure model tool-call/result presentation remains understandable.
5. If the operation changes files or app state, classify it in mutation/verification policies. Add tests for schema, allow/deny, consent, cancellation, failure, and repeat invocation.
6. Add integration/E2E coverage where the behavior crosses model streaming, IPC, a real app workspace, or UI approval.

### B. Add or extend an MCP server integration

MCP already has a substantial desktop implementation: contracts in [`src/ipc/types/mcp.ts`](../src/ipc/types/mcp.ts), handlers in [`mcp_handlers.ts`](../src/ipc/handlers/mcp_handlers.ts), connection/OAuth logic in [`mcp_manager.ts`](../src/ipc/utils/mcp_manager.ts) and related OAuth utilities, dynamic tool conversion in [`mcp_type_defs.ts`](../src/pro/main/ipc/handlers/local_agent/tools/mcp_type_defs.ts), and setup/catalog UI under [`src/pages/plugins.tsx`](../src/pages/plugins.tsx) and [`src/components/plugins/`](../src/components/plugins/). It supports stdio and remote transports (`sse`/`http` in the contract), encrypted secrets, OAuth, enable/disable, tool discovery, and tool-level consent.

Before enabling MCP in web:

- Add a browser/server-compatible configuration and OAuth callback flow; desktop stdio processes and local loopback OAuth assumptions do not translate directly to a hosted server.
- Store credentials encrypted per user/workspace with rotation and access controls. Do not reuse OS `safeStorage` assumptions for hosted multi-tenant secrets.
- Resolve SSRF, private/link-local/metadata address access, outbound destination allowlists, DNS rebinding, request/response limits, and audit logging at the gateway/service boundary.
- Avoid letting one workspace’s MCP servers, credentials, tool results, filesystem, budgets, or logs cross into another workspace.
- Revisit `ALWAYS_DISABLED` in [`channel_policy.ts`](../src/web/channel_policy.ts) only after the entire dependency/capability chain is designed, not as a one-line allowlist change. Current policy explicitly blocks MCP and integration channels.
- Add consent UX, security tests, malicious tool/result tests, OAuth lifecycle tests, workspace-isolation tests, and web E2E before calling it supported.

### C. Add a first-party external provider/API integration

Use a typed contract in `src/ipc/types/<domain>.ts`, register a handler group in [`src/ipc/ipc_host.ts`](../src/ipc/ipc_host.ts), implement logic in a handler/service, and connect the React UI with established React Query hooks. Reuse centralized OAuth/connection state, secret storage, request validation, and error classification where appropriate. For a user-facing agent integration card, see [`add_integration.ts`](../src/pro/main/ipc/handlers/local_agent/tools/add_integration.ts) and [`DyadAddIntegration.tsx`](../src/components/chat/DyadAddIntegration.tsx).

For every new contract channel, also check:

- Preload invoke/send/receive contract derivation and safe browser transport.
- Web channel policy, RPC app/path guard and whether a gateway route/permission is needed.
- Credential storage and per-workspace identity.
- Telemetry/logging: record metadata needed for diagnostics, never prompts, tokens, or unnecessary user project contents.
- Desktop and web behavior divergence, user-facing “unavailable” states, docs, localization, and tests.

Current provider-specific integrations include GitHub/Git, Supabase, Neon, Vercel, Cloudflare, and Coolify handlers/UI. These surfaces are not interchangeable: each has its own auth, provider API, app-state binding, and web policy. Search the owning contract/handler before extending one.

## 7. Current web limitations and evidence

The web runtime is not simply the desktop app hosted in a browser. The checked-in policy disables channel families including MCP, GitHub, Supabase, Neon, Vercel, Cloudflare, Coolify, local models, imports, subscriptions, recording, and telemetry. Some local UI reads are answered by the bridge, and selected renderer-facing distributed machines are allowed; `github_ops` is specifically denied. See [`channel_policy.ts`](../src/web/channel_policy.ts) and [`docs/web-port/channel_policy.md`](web-port/channel_policy.md).

The latest checked-in web acceptance record, dated 2026-10-16, reports:

- A direct Build/text-preview web flow and tokenized preview opening passed in recorded E2E runs.
- Full Plan-to-Build handoff plus socket-loss/reconnect coverage remains open.
- Internal Seltra image/search/fetch/crawl with request ledgering remains open.
- GitHub connect/push and Vercel publish remain open; their web channels and `github_ops` are denied.
- Full production deployment/security/isolation audit and deployment readiness are not established.
- The web acceptance doc records a Vite CSS syntax warning and large-chunk warnings; treat these as cleanup/quality opportunities, not the cause of app startup failure without fresh evidence.

These are repository documentation claims at the recorded date, not a live check of production. Read the full [acceptance evidence](web-port/ACCEPTANCE.md), [deferred host calls](web-port/DEFERRED_DYAD_HOSTS.md), [blockers](web-port/BLOCKERS.md), and [runbook](web-port/RUNBOOK.md) before planning the hosted roadmap.

## 8. Competitive improvement roadmap

“Match Lovable standard” is a product goal, not a claim about Lovable’s undocumented internals. Prioritize measurable end-user outcomes and safe delivery rather than just adding more model tools.

### P0 — Reliability and trust (foundation)

- Complete the full browser journey: prompt → plan → build → preview → reload → reconnect after socket interruption → continue from persisted state.
- Define a server-side workspace lifecycle and prove isolation: identity, one workspace/runtime boundary, scoped DB/storage/secrets, quotas, cleanup, recoverability, and audit trail.
- Deploy and test resource/network controls described in [`runtime/README.md`](../runtime/README.md). Enforce volume quotas outside the application.
- Add hosted error reporting, health checks, restart/reconciliation policy, backups, idempotent operations, and structured logs that exclude secrets and prompt bodies.
- Establish production gates: migrations, security review, dependency/license audit, backup/restore drill, multi-user authorization tests, and load/soak tests.

### P1 — Close the build-to-launch loop

- Implement a secure browser-based project preview/build sandbox and reliable install/start/restart flows, with visible progress and actionable build errors.
- Improve automatic verification: detect app stack, run install/typecheck/test/build, summarize errors, propose a bounded fix, and re-run checks with explicit user approval/budget.
- Add app snapshots/version restore, Git diff visibility, safe rollback, and clear “what changed” summaries.
- Keep preview origin/token isolation strict; test expiry, refresh, navigation, websocket reconnect, and hostile app content.

### P2 — Complete high-value integrations

- Deliver the web publishing path (GitHub connect/import/push and Vercel or equivalent deploy) with OAuth, encrypted per-user tokens, least privilege, idempotency, operation status, and recovery.
- Add database setup/connectivity and schema-aware operations for Supabase/Neon, with explicit user authorization and clear production-vs-development environment selection.
- Add web-compatible MCP or curated connectors (for example GitHub issues, Supabase, Stripe, Figma) behind a secure server-side tool broker. Start with a small allowlisted set and capability-scoped actions rather than arbitrary remote tool execution.
- Track tool calls with provider, operation, elapsed time, success/failure, user approval, and cost metadata while excluding secrets and sensitive payloads.
- Treat integration selection as a guided UX: connect, validate, provision/configure, inject only needed environment variables, test, explain result, and offer safe disconnect/rotation.

### P3 — Improve quality and global usability

- Expand model/app evaluation beyond “build succeeded”: task completion, visual fidelity, accessibility, responsiveness, security probes, test coverage, preview latency, cost, and recovery rate.
- Build representative multilingual and mobile-first test tasks; measure localization completeness, keyboard accessibility, screen-reader behavior, and preview quality at common viewport sizes.
- Add persistent project context/specs, design tokens, component library conventions, generated architecture documentation, and reusable app-specific instructions.
- Make model selection/fallback/cost transparent; support per-task reasoning budgets and graceful provider failure without silently losing state.
- Improve onboarding/templates and example projects for popular stacks, with secure defaults and production-ready deployment instructions.

The project's own benchmark workspace under [`benchmarks/`](../benchmarks/) can support repeatable quality comparisons. Define a versioned benchmark set and publish scores only with reproducible scripts, fixed model/provider settings, and clear cost/latency methodology.

## 9. Practical commands and validation

Commands in the root [`package.json`](../package.json):

```text
npm start             Desktop app
npm run web:dev        Local browser runtime (Node.js 24; .env.web required)
npm run web:build      Build web runtime, gateway and renderer
npm run web:test       Focused web unit/integration checks
npm run web:e2e        Browser-runtime Playwright suite
npm run ts             Supported project type-check
npm test               Root test suites
npm run fmt:check      Formatter validation
npm run lint           Oxlint (repository script includes --fix)
npm run render:build   Render production build command
npm run render:start   Render production start command
```

The web runbook requires the full web launcher on port 8080; `npm run dev:web` is renderer-only and deliberately blocked by default. On Windows, use `npm.cmd` if PowerShell script policy prevents invoking npm scripts.

## 10. Orientation for the next ChatGPT change

Before proposing or implementing an external-tool feature, answer these in the task response or implementation notes:

1. Is the feature desktop-only, web-only, or intended for both?
2. Is it a **model provider**, **agent tool**, **MCP server**, or **user-facing integration**? Those are different layers.
3. What user/workspace permissions and secrets does it require?
4. Does it change files, execute code, deploy, spend money, or affect production data? What consent, idempotency, rollback, and audit behavior applies?
5. Which IPC contract, handler/service, agent registry, renderer UI, gateway policy, persistence schema, docs, and tests must change?
6. What prevents SSRF, cross-workspace access, path escape, unbounded output/cost, credential leakage, and repeated side effects?
7. Which exact tests/build/E2E prove the behavior, and which production checks remain unverified?

Do not silently expand web channel access or claim production readiness from local Windows web E2E alone. Any major deployment/security gap should be described as a release blocker until tested in the actual hosted topology.

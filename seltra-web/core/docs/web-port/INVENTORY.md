# Electron seam inventory

Captured from the current checkout on 2026-10-14. Paths and line references are relative to the repository root. Test files, generated bundles, and vendored `userData/managed-tools` contents are excluded unless stated. Registrations are composed through `registerTrustedIpcHandler`, so searching only for literal `ipcMain.handle` calls misses the real registration surface.

## Main bootstrap and registration sequence

`src/main.ts:392` calls `registerIpcHandlers()`. The ordered groups in `src/ipc/ipc_host.ts:65-134` are:

| Order | Registration group | Classification |
|---:|---|---|
| 1-10 | app, chat, chat stream, settings, shell, dependency, custom apps folder, connection flow, GitHub, Git branches | SANDBOX (app/filesystem/process/Git) plus ADAPT (connection flow) |
| 11-20 | Vercel, Cloudflare, Node, problems, proposals, debug, Supabase, Neon, local models, token count | ADAPT / SANDBOX; cloud-provider handlers are out of initial Seltra scope |
| 21-30 | window, upload, version, version-preview interest, language models, release notes, import, session, Pro, context paths | ADAPT / SANDBOX / DISABLE (release notes, Pro) |
| 31-40 | app upgrade, Capacitor, app env vars, templates, themes, portal, migration, prompts, help bot, MCP | SANDBOX / DISABLE (Pro themes) / ADAPT |
| 41-50 | security, visual editing, agent tools, free-agent quota, free-model quota, plan, media, misc, app blueprint, app collection | SANDBOX; agent tools are subject to tool allowlists |
| 51-60 | terminal, tests, test assertions, recording, user input, first prompt, window infrastructure, distributed machines, image generation, Coolify | SANDBOX / DISABLE (recording, Coolify, distributed machine feature unless explicitly ported) |
| 61-65 | preview view, native theme, Coolify setup | ADAPT / DISABLE (Coolify) |

Exact order and source: `src/ipc/ipc_host.ts:65-134`. Contracts and preload allowlists: `src/ipc/preload/channels.ts:1-210`.

## IPC registration/effect inventory

The public endpoints are the contract channel names in `src/ipc/types/*.ts`, `src/ipc/contracts/*`, plus the five `TEST_INVOKE_CHANNELS` constants in `src/ipc/preload/channels.ts:89-96`. The allowlists are assembled as `VALID_INVOKE_CHANNELS`, `VALID_SEND_CHANNELS`, and `VALID_RECEIVE_CHANNELS` in `src/ipc/preload/channels.ts:103-210`. This is the authoritative allowlist; the exact runtime channel strings are generated from imported contract objects, not enumerated literal `ipcMain.handle()` calls. Registration primitive: `src/ipc/handlers/trusted_handle.ts` (all invoked handlers); one-way receive registrations: `src/ipc/handlers/first_prompt_handlers.ts:13,27`.

| Registration implementation | Location | Note |
|---|---|---|
| Trusted invoke wrapper | `src/ipc/handlers/trusted_handle.ts` | Central `ipcMain.handle` registration and error-envelope boundary. Handlers called through this wrapper are not directly visible to a literal `ipcMain.handle(` search. |
| First-prompt one-way listeners | `src/ipc/handlers/first_prompt_handlers.ts:13,27` | `ipcMain.on` listeners for send-contract channels. |
| Handler group composition | `src/ipc/ipc_host.ts:65-134` | The 65 ordered registration calls are listed above. |
| Preload invoke allowlist | `src/ipc/preload/channels.ts:103-168` | Derived from contract groups; includes test channels. |
| Preload send allowlist | `src/ipc/preload/channels.ts:175-183` | Derived from first-prompt and preview-view send contracts. |
| Preload receive allowlist | `src/ipc/preload/channels.ts:190-210` | Derived from stream and event contracts. |

## Renderer-bound sends and stream events

| File and line | Channel / source | Note |
|---|---|---|
| `src/main.ts:812` | `force-close-detected` | Force-close detection event. |
| `src/main.ts:1604,1615,1641,1670` | `deep-link-received` | Deep-link delivery to the main window. |
| `src/ipc/handlers/chat_stream_handlers.ts:357,2698` | Contract event channels; `chat:response:error` | Chat stream transport and terminal error delivery. |
| `src/ipc/services/chat_actor_platform.ts:85` | `plan:handoff-presentation` | Plan handoff presentation event. |
| `src/ipc/utils/pty_session_manager.ts:463,501` | `terminal:data:*`, `terminal:exit:*` | Session-scoped terminal output and exit events. |
| `src/ipc/services/github_ops_presentation_service.ts:55,66` | `toast:error`, `toast:dismiss` | Git operation presentation. |
| `src/ipc/services/image_generation_presentation_service.ts:39,58` | image-generation presentation contract | Image generation progress/result. |
| `src/ipc/services/distributed_machine_host.ts:49` | `distributed-machine:protocol-mismatch` | Distributed-machine status. |
| `src/main/settings.ts:1103` | `toast:error` | Settings error shown in a window. |
| `src/ipc/utils/telemetry.ts:44` | `telemetry:event` | Telemetry forwarded to a renderer; disable in Seltra. |
| `src/ipc/utils/safe_sender.ts:25` | dynamic `channel` | Safe sender wrapper; callers need tracing to their contract event before porting. |
| Other producer/event methods | `src/ipc/services/*`, `src/ipc/handlers/*` | Events are routed through window/session endpoints (`endpoint.send`, `webContents.send`, or injected output sinks); see contract receive allowlist above. |

The direct `webContents.send` / `event.sender.send` source scan is `rg -n '(webContents|event\\.sender|sender)\\.send\\(' src --glob '!**/*.test.*'`. It returns the rows above plus references in test harness documentation; endpoint and injected-sink `.send` calls are the producer/event methods noted in the last row.

## Electron imports

There is no single-Electron-module seam: `src/main.ts` imports `app`, `autoUpdater`, `BrowserWindow`, `dialog`, `Menu`, `protocol`, `net`, `nativeImage`, `crashReporter`; main and renderer modules import the APIs listed below. `src/preload.ts` imports `contextBridge`, `ipcRenderer`, and `webFrame`. The source of truth for the full file-level list is the tracked source search `rg -n 'from "electron"' src --glob '!**/*.test.*'`.

| File | Electron APIs observed / expected from imports | Port note |
|---|---|---|
| `src/main.ts` | `app`, `autoUpdater`, `BrowserWindow`, `dialog`, `Menu`, `protocol`, `net`, `nativeImage`, `crashReporter` | Desktop-only bootstrap includes startup, window, protocol, updater, crash and native image behavior. |
| `src/preload.ts` | `contextBridge`, `ipcRenderer`, `webFrame` | Exposes the browser bridge surface described below. |
| `src/ipc/handlers/first_prompt_handlers.ts` | `ipcMain` | Two `ipcMain.on` send listeners. |
| `src/ipc/services/codex_subscription_auth.ts` | `safeStorage`, `shell` | Secret persistence and OAuth browser flow; requires a server-side policy/adaptation. |
| `src/ipc/services/preview_storage.ts` | `session` | Electron session storage; needs a web equivalent or disablement. |
| `src/ipc/processors/code_explorer.ts`, `src/ipc/processors/supabase_dependency_analysis.ts` | `utilityProcess` | Electron utility processes; cannot be copied into plain Node unchanged. |
| Other direct Electron imports | Search output in source is the exhaustive index; includes main/window and service types and APIs | Preserve every value API used by runtime modules; type-only imports do not require shim behavior. |

## Paths and native/process dependencies

| Surface | Source locations / notes |
|---|---|
| `app.getPath` | Electron path resolution is called by `src/paths/paths.ts` and `src/main.ts`; path helpers also use `app.getPath` for production data. |
| `getUserDataPath` | Defined in `src/paths/paths.ts`; used across database, settings, runtime, logs, cache, test artifacts, auth and app support modules. |
| `dyad-apps` | Generated app root is defined by `src/paths/paths.ts` (`getDyadAppsBaseDirectory`); tests and user-facing errors also contain literal examples. |
| `better-sqlite3` | Root dependency in `package.json`; database initialization and schema are in `src/db/`. Native ABI must match runtime Node. |
| `node-pty` | Root dependency in `package.json`; terminal process/session handling is under `src/ipc/` and agent shell tools. SANDBOX only. |
| `dugite` | Root dependency in `package.json`; Git implementation lives under `src/github_ops/` and Git utilities. SANDBOX only. |
| `child_process` | Many main-process services spawn package managers, app runtimes, Git, tests, and agent commands. The file-level source index is `rg -n 'node:child_process|from "child_process"|from ''child_process''' src --glob '!**/*.test.*'`. SANDBOX only. |

## Preload bridge (exact public object shape)

`src/preload.ts:35-95` exposes `window.electron` with exactly:

```text
electron = {
  ipcRenderer: {
    invoke(channel, ...args),
    invokeEnvelope(channel, ...args),
    send(channel, ...args),
    on(channel, listener) -> unsubscribe,
    removeAllListeners(channel),
    removeListener(channel, listener)
  },
  webFrame: {
    setZoomFactor(factor),
    getZoomFactor()
  }
}
```

Invoke/send/receive allowlists are `VALID_INVOKE_CHANNELS`, `VALID_SEND_CHANNELS`, `VALID_RECEIVE_CHANNELS` in `src/ipc/preload/channels.ts`. Dynamic receives additionally permit only `terminal:data:<session>` and `terminal:exit:<session>`; suffixes are server-generated. Invoke unwraps the standard IPC envelope; `invokeEnvelope` leaves it intact. The web transport must retain that behavior and the `webFrame` surface (or provide a no-op-compatible equivalent).

## Preview URL construction

Runtime URLs originate in `src/ipc/services/app_runtime_service.ts` (parses `http://localhost:<port>` output at line 1158), are projected by `src/ipc/services/app_runtime_orchestration_service.ts` and the preview domain/proxy utilities. Renderer code consumes preview URLs through app/runtime query contracts and `src/preview_iframe/`; direct `localhost:<port>` occurrences also exist in tests and provider OAuth callbacks and must not be rewritten as previews. The renderer should be searched with `rg -n 'localhost:|previewUrl|proxyUrl' src --glob '!**/*.test.*'`; preview URL rewriting belongs at a server transport boundary.

## dyad.sh network and PostHog

| Host / service | Location | Classification |
|---|---|---|
| `api.dyad.sh/v1/language-model-catalog` | Language model catalog provider in `src/ipc/` (referenced from model catalog services) | DISABLE per plan; serve Seltra static catalog. |
| `api.dyad.sh/v1/user/info` | `src/ipc/services/user_budget_service.ts:26` | DISABLE / replace with Seltra budget service. |
| `api.dyad.sh/v1/desktop-config` | `src/ipc/shared/remote_desktop_config.ts:36` | DISABLE. |
| Other `dyad.sh` URLs | Search index: `rg -n 'dyad\.sh' src --glob '!**/*.test.*'`; includes engine and image-upload endpoints in addition to catalog | Classify each separately; never forward browser secrets. |
| PostHog events | `src/lib/posthog*`, `src/components/*`, `src/pages/*`, `src/first_prompt/*`, and other matches from `rg -n 'posthog\.' src --glob '!**/*.test.*'` | DISABLE in hosted runtime/browser per Phase 0. |

## Initial channel classification

Classification is by contract family. `src/ipc/preload/channels.ts` derives concrete names from these families; do not authorize a channel solely because the desktop preload permits it.

| Contract / handler family | Class | Reason |
|---|---|---|
| Chat stream, chat CRUD, app list/create/rename, settings, prompts, plan and user-input events | PORT + SANDBOX for project mutations | Engine behavior is reusable; file/Git/process effects must remain in the workspace runtime. |
| App filesystem, app runtime, versions, Git, agent tools, terminal, tests, media and context paths | SANDBOX | Operates on files, process trees, app runtime, Git or generated media. |
| Folder/file dialogs, upload, shell open-external, notifications, clipboard, native theme, window controls | ADAPT | Needs browser affordances; `dialog` must not execute on the server. |
| Connection flows, deep links, OAuth, local provider discovery, desktop configuration | ADAPT or DISABLE | Browser authentication/callback strategy is required; desktop paths are unavailable. |
| Release notes, recording, Dyad Pro, Coolify, auto-update, telemetry, distributed-machine control, api.dyad.sh catalog | DISABLE | Explicitly outside the Seltra port per plan, unless a later approved phase declares otherwise. The current chat actor transport exception is documented in `DEVIATIONS.md`; only `chat_stream` subscribe/dispatch/unsubscribe are accepted. |
| Supabase, Neon, Vercel, Cloudflare, MCP and publishing integrations | DISABLE initially / ADAPT after credential review | Existing desktop OAuth and credential stores cannot be reused as hosted merchant credentials. |
| `test:*` fixtures and debug-only channels | DISABLE in production | Test-build only or diagnostics surface. |

This is an initial policy classification, not a production-ready RPC allowlist. Phase 1 must use an explicit allowlist generated from reviewed contract names and exclude DISABLE channels.

## Contract channel index (all literal channel fields)

The rows below are the 399 literal `channel:` fields found under `src/ipc/types/`; each exact contract channel is identified with source and line. The preload `VALID_*` arrays still determine whether a row is invoke, send, or receive. Names are policy-classified by handler behavior and require review before allowlisting.

| Channel | Source | Note / initial class |
|---|---|---|
| `appCollections:list` | `src/ipc/types/app_collections.ts:50` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `appCollections:create` | `src/ipc/types/app_collections.ts:56` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `appCollections:update` | `src/ipc/types/app_collections.ts:63` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `appCollections:delete` | `src/ipc/types/app_collections.ts:70` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `appCollections:assignApps` | `src/ipc/types/app_collections.ts:77` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:update` | `src/ipc/types/app_blueprint.ts:165` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:visuals-update` | `src/ipc/types/app_blueprint.ts:170` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:approved` | `src/ipc/types/app_blueprint.ts:175` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:timeout` | `src/ipc/types/app_blueprint.ts:180` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:approve` | `src/ipc/types/app_blueprint.ts:191` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:edit-field` | `src/ipc/types/app_blueprint.ts:201` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:edit-visual` | `src/ipc/types/app_blueprint.ts:207` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:add-visual` | `src/ipc/types/app_blueprint.ts:213` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app-blueprint:remove-visual` | `src/ipc/types/app_blueprint.ts:219` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent-tool:get-tools` | `src/ipc/types/agent.ts:222` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent-tool:set-consent` | `src/ipc/types/agent.ts:228` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:list-subagents` | `src/ipc/types/agent.ts:233` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:get-subagent-messages` | `src/ipc/types/agent.ts:239` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:get-subagent-activities` | `src/ipc/types/agent.ts:245` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:send-subagent-message` | `src/ipc/types/agent.ts:251` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:followup-subagent` | `src/ipc/types/agent.ts:261` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:start-review` | `src/ipc/types/agent.ts:271` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:run-auto-review-barrier` | `src/ipc/types/agent.ts:277` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:fix-review-findings` | `src/ipc/types/agent.ts:297` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:skip-review-auto-fix` | `src/ipc/types/agent.ts:303` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:cancel-subagent` | `src/ipc/types/agent.ts:313` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent-tool:todos-update` | `src/ipc/types/agent.ts:328` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent-tool:problems-update` | `src/ipc/types/agent.ts:336` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `agent:subagent-update` | `src/ipc/types/agent.ts:341` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `create-app` | `src/ipc/types/app.ts:413` | `PORT` - engine request/event; port after payload and ownership review |
| `get-app` | `src/ipc/types/app.ts:424` | `PORT` - engine request/event; port after payload and ownership review |
| `list-apps` | `src/ipc/types/app.ts:430` | `PORT` - engine request/event; port after payload and ownership review |
| `delete-app` | `src/ipc/types/app.ts:436` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `delete-apps` | `src/ipc/types/app.ts:449` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `copy-app` | `src/ipc/types/app.ts:468` | `PORT` - engine request/event; port after payload and ownership review |
| `rename-app` | `src/ipc/types/app.ts:479` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `preview-app-folder-name` | `src/ipc/types/app.ts:491` | `ADAPT` - desktop capability needs a browser equivalent |
| `run-app` | `src/ipc/types/app.ts:497` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `stop-app` | `src/ipc/types/app.ts:503` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `restart-app` | `src/ipc/types/app.ts:509` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `get-cloud-sandbox-status` | `src/ipc/types/app.ts:515` | `PORT` - engine request/event; port after payload and ownership review |
| `create-cloud-sandbox-share-link` | `src/ipc/types/app.ts:521` | `PORT` - engine request/event; port after payload and ownership review |
| `edit-app-file` | `src/ipc/types/app.ts:527` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `read-app-file` | `src/ipc/types/app.ts:534` | `PORT` - engine request/event; port after payload and ownership review |
| `respond-to-app-input` | `src/ipc/types/app.ts:540` | `PORT` - engine request/event; port after payload and ownership review |
| `search-app-files` | `src/ipc/types/app.ts:546` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `change-app-location` | `src/ipc/types/app.ts:552` | `ADAPT` - desktop capability needs a browser equivalent |
| `rename-branch` | `src/ipc/types/app.ts:563` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `add-to-favorite` | `src/ipc/types/app.ts:573` | `PORT` - engine request/event; port after payload and ownership review |
| `set-testing-enabled` | `src/ipc/types/app.ts:584` | `PORT` - engine request/event; port after payload and ownership review |
| `select-app-location` | `src/ipc/types/app.ts:595` | `ADAPT` - desktop capability needs a browser equivalent |
| `check-app-name` | `src/ipc/types/app.ts:601` | `PORT` - engine request/event; port after payload and ownership review |
| `search-app` | `src/ipc/types/app.ts:607` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `update-app-commands` | `src/ipc/types/app.ts:613` | `PORT` - engine request/event; port after payload and ownership review |
| `select-app-for-preview` | `src/ipc/types/app.ts:624` | `PORT` - engine request/event; port after payload and ownership review |
| `app:get-current-commit-hash` | `src/ipc/types/app.ts:630` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app:save-screenshot` | `src/ipc/types/app.ts:636` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app:list-screenshots` | `src/ipc/types/app.ts:649` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app:list-thumbnails` | `src/ipc/types/app.ts:659` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `is-capacitor` | `src/ipc/types/capacitor.ts:18` | `PORT` - engine request/event; port after payload and ownership review |
| `sync-capacitor` | `src/ipc/types/capacitor.ts:24` | `PORT` - engine request/event; port after payload and ownership review |
| `open-ios` | `src/ipc/types/capacitor.ts:30` | `ADAPT` - desktop capability needs a browser equivalent |
| `open-android` | `src/ipc/types/capacitor.ts:36` | `ADAPT` - desktop capability needs a browser equivalent |
| `pro:transcribe-audio` | `src/ipc/types/audio.ts:58` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `get-chat` | `src/ipc/types/chat.ts:384` | `PORT` - engine request/event; port after payload and ownership review |
| `get-chats` | `src/ipc/types/chat.ts:390` | `PORT` - engine request/event; port after payload and ownership review |
| `get-chat-metadata` | `src/ipc/types/chat.ts:405` | `PORT` - engine request/event; port after payload and ownership review |
| `claude-code:models` | `src/ipc/types/chat.ts:418` | `PORT` - engine request/event; port after payload and ownership review |
| `claude-code:usage` | `src/ipc/types/chat.ts:423` | `PORT` - engine request/event; port after payload and ownership review |
| `claude-code:status` | `src/ipc/types/chat.ts:428` | `PORT` - engine request/event; port after payload and ownership review |
| `create-chat` | `src/ipc/types/chat.ts:439` | `PORT` - engine request/event; port after payload and ownership review |
| `update-chat` | `src/ipc/types/chat.ts:455` | `PORT` - engine request/event; port after payload and ownership review |
| `set-chat-favorite` | `src/ipc/types/chat.ts:466` | `PORT` - engine request/event; port after payload and ownership review |
| `remove-chat-referenced-app` | `src/ipc/types/chat.ts:477` | `PORT` - engine request/event; port after payload and ownership review |
| `delete-chat` | `src/ipc/types/chat.ts:487` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `delete-messages` | `src/ipc/types/chat.ts:494` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `search-chats` | `src/ipc/types/chat.ts:501` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:count-tokens` | `src/ipc/types/chat.ts:518` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:cancel` | `src/ipc/types/chat.ts:524` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:observe-submission-stop-policy` | `src/ipc/types/chat.ts:530` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:response:ack` | `src/ipc/types/chat.ts:540` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:stream` | `src/ipc/types/chat.ts:558` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:response:chunk` | `src/ipc/types/chat.ts:563` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:response:end` | `src/ipc/types/chat.ts:567` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:response:error` | `src/ipc/types/chat.ts:571` | `PORT` - engine request/event; port after payload and ownership review |
| `connection-flow:start` | `src/ipc/types/connection_flow.ts:97` | `ADAPT` - desktop capability needs a browser equivalent |
| `connection-flow:cancel` | `src/ipc/types/connection_flow.ts:111` | `ADAPT` - desktop capability needs a browser equivalent |
| `connection-flow:acknowledge` | `src/ipc/types/connection_flow.ts:120` | `ADAPT` - desktop capability needs a browser equivalent |
| `connection-flow:get-states` | `src/ipc/types/connection_flow.ts:128` | `ADAPT` - desktop capability needs a browser equivalent |
| `connection-flow:state-changed` | `src/ipc/types/connection_flow.ts:144` | `ADAPT` - desktop capability needs a browser equivalent |
| `connection-flow:unsolicited-return` | `src/ipc/types/connection_flow.ts:158` | `ADAPT` - desktop capability needs a browser equivalent |
| `coolify:get-status` | `src/ipc/types/coolify.ts:189` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:save-token` | `src/ipc/types/coolify.ts:196` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:discover` | `src/ipc/types/coolify.ts:210` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:save-connection` | `src/ipc/types/coolify.ts:216` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:check-domain` | `src/ipc/types/coolify.ts:234` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:deploy` | `src/ipc/types/coolify.ts:253` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:get-deploy-snapshot` | `src/ipc/types/coolify.ts:259` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:clear-token` | `src/ipc/types/coolify.ts:265` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:create-project` | `src/ipc/types/coolify.ts:279` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:disconnect` | `src/ipc/types/coolify.ts:292` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify:deploy-status` | `src/ipc/types/coolify.ts:312` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `get-context-paths` | `src/ipc/types/context.ts:52` | `PORT` - engine request/event; port after payload and ownership review |
| `set-context-paths` | `src/ipc/types/context.ts:58` | `PORT` - engine request/event; port after payload and ownership review |
| `coolify-setup:get-server-key` | `src/ipc/types/coolify_setup.ts:206` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify-setup:inspect` | `src/ipc/types/coolify_setup.ts:219` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify-setup:run` | `src/ipc/types/coolify_setup.ts:226` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify-setup:reveal-credentials` | `src/ipc/types/coolify_setup.ts:248` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify-setup:snapshot` | `src/ipc/types/coolify_setup.ts:262` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify-setup:accept-insecure-token` | `src/ipc/types/coolify_setup.ts:277` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify-setup:dismiss` | `src/ipc/types/coolify_setup.ts:291` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify-setup:cancel` | `src/ipc/types/coolify_setup.ts:297` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `coolify-setup:changed` | `src/ipc/types/coolify_setup.ts:313` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `distributed-machine:subscribe` | `src/ipc/types/distributed_machines.ts:20` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `distributed-machine:dispatch` | `src/ipc/types/distributed_machines.ts:25` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `distributed-machine:unsubscribe` | `src/ipc/types/distributed_machines.ts:30` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `distributed-machine:snapshot` | `src/ipc/types/distributed_machines.ts:38` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `distributed-machine:disposed` | `src/ipc/types/distributed_machines.ts:42` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `distributed-machine:operation-outcome` | `src/ipc/types/distributed_machines.ts:46` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `distributed-machine:protocol-mismatch` | `src/ipc/types/distributed_machines.ts:50` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `cloudflare:save-token` | `src/ipc/types/cloudflare.ts:179` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `cloudflare:list-accounts` | `src/ipc/types/cloudflare.ts:185` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `cloudflare:list-workers` | `src/ipc/types/cloudflare.ts:191` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `cloudflare:get-app-status` | `src/ipc/types/cloudflare.ts:197` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `cloudflare:check-repo-access` | `src/ipc/types/cloudflare.ts:203` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `cloudflare:connect-worker` | `src/ipc/types/cloudflare.ts:209` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `cloudflare:get-deployment-status` | `src/ipc/types/cloudflare.ts:221` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `cloudflare:disconnect` | `src/ipc/types/cloudflare.ts:227` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `first-prompt:commit-creation` | `src/ipc/types/first_prompt.ts:10` | `PORT` - engine request/event; port after payload and ownership review |
| `first-prompt:cancel-creation` | `src/ipc/types/first_prompt.ts:14` | `PORT` - engine request/event; port after payload and ownership review |
| `free-agent-quota:get-status` | `src/ipc/types/free_agent_quota.ts:38` | `PORT` - engine request/event; port after payload and ownership review |
| `free-model-quota:get-status` | `src/ipc/types/free_model_quota.ts:16` | `PORT` - engine request/event; port after payload and ownership review |
| `github:list-repos` | `src/ipc/types/github.ts:141` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `github:get-repo-branches` | `src/ipc/types/github.ts:147` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `github:is-repo-available` | `src/ipc/types/github.ts:153` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `github:list-local-branches` | `src/ipc/types/github.ts:159` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `github:list-remote-branches` | `src/ipc/types/github.ts:165` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `github:list-collaborators` | `src/ipc/types/github.ts:171` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `github:invite-collaborator` | `src/ipc/types/github.ts:177` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `github:remove-collaborator` | `src/ipc/types/github.ts:183` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `github:clone-repo-from-url` | `src/ipc/types/github.ts:189` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `git:get-uncommitted-files` | `src/ipc/types/github.ts:198` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `git:get-uncommitted-file-diff` | `src/ipc/types/github.ts:204` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `git:commit-changes` | `src/ipc/types/github.ts:210` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `git:cancel-commit` | `src/ipc/types/github.ts:217` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `git:discard-changes` | `src/ipc/types/github.ts:223` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `git:commit-progress` | `src/ipc/types/github.ts:232` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `help:chat:start` | `src/ipc/types/help.ts:40` | `PORT` - engine request/event; port after payload and ownership review |
| `help:chat:cancel` | `src/ipc/types/help.ts:46` | `PORT` - engine request/event; port after payload and ownership review |
| `help:chat:start` | `src/ipc/types/help.ts:57` | `PORT` - engine request/event; port after payload and ownership review |
| `help:chat:response:chunk` | `src/ipc/types/help.ts:62` | `PORT` - engine request/event; port after payload and ownership review |
| `help:chat:response:end` | `src/ipc/types/help.ts:66` | `PORT` - engine request/event; port after payload and ownership review |
| `help:chat:response:error` | `src/ipc/types/help.ts:70` | `PORT` - engine request/event; port after payload and ownership review |
| `image-generation:wait-for-operation` | `src/ipc/types/image_generation.ts:135` | `PORT` - engine request/event; port after payload and ownership review |
| `image-generation:presentation` | `src/ipc/types/image_generation.ts:169` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:list-servers` | `src/ipc/types/mcp.ts:175` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:list-catalog` | `src/ipc/types/mcp.ts:181` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `mcp:add-from-catalog` | `src/ipc/types/mcp.ts:191` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `mcp:create-server` | `src/ipc/types/mcp.ts:219` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:update-server` | `src/ipc/types/mcp.ts:225` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:delete-server` | `src/ipc/types/mcp.ts:233` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:list-tools` | `src/ipc/types/mcp.ts:249` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:get-tool-consents` | `src/ipc/types/mcp.ts:255` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:set-tool-consent` | `src/ipc/types/mcp.ts:261` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:start-oauth` | `src/ipc/types/mcp.ts:267` | `ADAPT` - desktop capability needs a browser equivalent |
| `mcp:disconnect-oauth` | `src/ipc/types/mcp.ts:288` | `ADAPT` - desktop capability needs a browser equivalent |
| `mcp:probe-callback-port` | `src/ipc/types/mcp.ts:296` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:probe-connection` | `src/ipc/types/mcp.ts:302` | `PORT` - engine request/event; port after payload and ownership review |
| `mcp:is-oauth-storage-encrypted` | `src/ipc/types/mcp.ts:312` | `ADAPT` - desktop capability needs a browser equivalent |
| `list-all-media` | `src/ipc/types/media.ts:65` | `PORT` - engine request/event; port after payload and ownership review |
| `rename-media-file` | `src/ipc/types/media.ts:71` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `delete-media-file` | `src/ipc/types/media.ts:77` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `open-media-file` | `src/ipc/types/media.ts:83` | `ADAPT` - desktop capability needs a browser equivalent |
| `move-media-file` | `src/ipc/types/media.ts:89` | `PORT` - engine request/event; port after payload and ownership review |
| `migration:migrate` | `src/ipc/types/migration.ts:72` | `PORT` - engine request/event; port after payload and ownership review |
| `migration:preview` | `src/ipc/types/migration.ts:77` | `PORT` - engine request/event; port after payload and ownership review |
| `get-language-model-providers` | `src/ipc/types/language-model.ts:108` | `PORT` - engine request/event; port after payload and ownership review |
| `get-language-models` | `src/ipc/types/language-model.ts:114` | `PORT` - engine request/event; port after payload and ownership review |
| `get-language-models-by-providers` | `src/ipc/types/language-model.ts:120` | `PORT` - engine request/event; port after payload and ownership review |
| `create-custom-language-model-provider` | `src/ipc/types/language-model.ts:126` | `PORT` - engine request/event; port after payload and ownership review |
| `edit-custom-language-model-provider` | `src/ipc/types/language-model.ts:132` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `delete-custom-language-model-provider` | `src/ipc/types/language-model.ts:138` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `create-custom-language-model` | `src/ipc/types/language-model.ts:144` | `PORT` - engine request/event; port after payload and ownership review |
| `update-custom-language-model` | `src/ipc/types/language-model.ts:150` | `PORT` - engine request/event; port after payload and ownership review |
| `delete-custom-language-model` | `src/ipc/types/language-model.ts:156` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `delete-custom-model` | `src/ipc/types/language-model.ts:162` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `local-models:list-ollama` | `src/ipc/types/language-model.ts:168` | `PORT` - engine request/event; port after payload and ownership review |
| `local-models:list-lmstudio` | `src/ipc/types/language-model.ts:174` | `PORT` - engine request/event; port after payload and ownership review |
| `stable` | `src/ipc/types/misc.ts:100` | `PORT` - engine request/event; port after payload and ownership review |
| `portal:migrate-create` | `src/ipc/types/misc.ts:457` | `PORT` - engine request/event; port after payload and ownership review |
| `get-env-vars` | `src/ipc/types/misc.ts:464` | `PORT` - engine request/event; port after payload and ownership review |
| `get-app-env-vars` | `src/ipc/types/misc.ts:471` | `PORT` - engine request/event; port after payload and ownership review |
| `set-app-env-vars` | `src/ipc/types/misc.ts:477` | `PORT` - engine request/event; port after payload and ownership review |
| `get-session-debug-bundle` | `src/ipc/types/misc.ts:484` | `PORT` - engine request/event; port after payload and ownership review |
| `add-log` | `src/ipc/types/misc.ts:491` | `PORT` - engine request/event; port after payload and ownership review |
| `clear-logs` | `src/ipc/types/misc.ts:497` | `PORT` - engine request/event; port after payload and ownership review |
| `renderer:error-toast-ready` | `src/ipc/types/misc.ts:503` | `PORT` - engine request/event; port after payload and ownership review |
| `check-problems` | `src/ipc/types/misc.ts:510` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:add-dep` | `src/ipc/types/misc.ts:517` | `PORT` - engine request/event; port after payload and ownership review |
| `app:output` | `src/ipc/types/misc.ts:532` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `app:output-batch` | `src/ipc/types/misc.ts:537` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `deep-link-received` | `src/ipc/types/misc.ts:542` | `ADAPT` - desktop capability needs a browser equivalent |
| `chat:stream:start` | `src/ipc/types/misc.ts:547` | `PORT` - engine request/event; port after payload and ownership review |
| `chat:stream:end` | `src/ipc/types/misc.ts:556` | `PORT` - engine request/event; port after payload and ownership review |
| `toast:error` | `src/ipc/types/misc.ts:561` | `PORT` - engine request/event; port after payload and ownership review |
| `toast:dismiss` | `src/ipc/types/misc.ts:576` | `PORT` - engine request/event; port after payload and ownership review |
| `plan:update` | `src/ipc/types/plan.ts:77` | `PORT` - engine request/event; port after payload and ownership review |
| `plan:exit` | `src/ipc/types/plan.ts:82` | `PORT` - engine request/event; port after payload and ownership review |
| `plan:handoff-presentation` | `src/ipc/types/plan.ts:86` | `PORT` - engine request/event; port after payload and ownership review |
| `plan:create` | `src/ipc/types/plan.ts:95` | `PORT` - engine request/event; port after payload and ownership review |
| `plan:get` | `src/ipc/types/plan.ts:101` | `PORT` - engine request/event; port after payload and ownership review |
| `plan:get-for-chat` | `src/ipc/types/plan.ts:107` | `PORT` - engine request/event; port after payload and ownership review |
| `plan:update-plan` | `src/ipc/types/plan.ts:113` | `PORT` - engine request/event; port after payload and ownership review |
| `plan:delete` | `src/ipc/types/plan.ts:119` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:show` | `src/ipc/types/preview_view.ts:41` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:hide` | `src/ipc/types/preview_view.ts:49` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:go-back` | `src/ipc/types/preview_view.ts:54` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:go-forward` | `src/ipc/types/preview_view.ts:59` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:reload` | `src/ipc/types/preview_view.ts:64` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:set-bounds` | `src/ipc/types/preview_view.ts:78` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:set-overlay-active` | `src/ipc/types/preview_view.ts:82` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:navigation-state` | `src/ipc/types/preview_view.ts:89` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:load-failed` | `src/ipc/types/preview_view.ts:93` | `PORT` - engine request/event; port after payload and ownership review |
| `preview-view:screenshot-updated` | `src/ipc/types/preview_view.ts:101` | `PORT` - engine request/event; port after payload and ownership review |
| `get-proposal` | `src/ipc/types/proposals.ts:114` | `PORT` - engine request/event; port after payload and ownership review |
| `approve-proposal` | `src/ipc/types/proposals.ts:120` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `reject-proposal` | `src/ipc/types/proposals.ts:126` | `PORT` - engine request/event; port after payload and ownership review |
| `prompts:list` | `src/ipc/types/prompts.ts:56` | `PORT` - engine request/event; port after payload and ownership review |
| `prompts:create` | `src/ipc/types/prompts.ts:62` | `PORT` - engine request/event; port after payload and ownership review |
| `prompts:update` | `src/ipc/types/prompts.ts:68` | `PORT` - engine request/event; port after payload and ownership review |
| `prompts:delete` | `src/ipc/types/prompts.ts:74` | `PORT` - engine request/event; port after payload and ownership review |
| `import-app` | `src/ipc/types/import.ts:48` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `check-app-name` | `src/ipc/types/import.ts:54` | `PORT` - engine request/event; port after payload and ownership review |
| `check-ai-rules` | `src/ipc/types/import.ts:60` | `PORT` - engine request/event; port after payload and ownership review |
| `neon:create-project` | `src/ipc/types/neon.ts:145` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:get-project` | `src/ipc/types/neon.ts:151` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:list-projects` | `src/ipc/types/neon.ts:157` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:set-app-project` | `src/ipc/types/neon.ts:163` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:unset-app-project` | `src/ipc/types/neon.ts:176` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:set-active-branch` | `src/ipc/types/neon.ts:186` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:get-email-password-config` | `src/ipc/types/neon.ts:200` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:update-email-verification` | `src/ipc/types/neon.ts:206` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:fake-connect` | `src/ipc/types/neon.ts:212` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:get-branch-env-vars` | `src/ipc/types/neon.ts:218` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `neon:set-selected-database-branch-type` | `src/ipc/types/neon.ts:224` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `get-latest-security-review` | `src/ipc/types/security.ts:46` | `PORT` - engine request/event; port after payload and ownership review |
| `get-or-create-security-fix-chat` | `src/ipc/types/security.ts:51` | `PORT` - engine request/event; port after payload and ownership review |
| `recording:start` | `src/ipc/types/recording.ts:108` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `recording:stop` | `src/ipc/types/recording.ts:113` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `recording:save-draft` | `src/ipc/types/recording.ts:118` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `recording:discard-draft` | `src/ipc/types/recording.ts:123` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `recording:draft-named` | `src/ipc/types/recording.ts:197` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `recording:setup-progress` | `src/ipc/types/recording.ts:201` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `recording:ended` | `src/ipc/types/recording.ts:205` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `recording:draft-consumed` | `src/ipc/types/recording.ts:209` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:list-organizations` | `src/ipc/types/supabase.ts:186` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:delete-organization` | `src/ipc/types/supabase.ts:192` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:list-all-projects` | `src/ipc/types/supabase.ts:198` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:create-project` | `src/ipc/types/supabase.ts:209` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:list-branches` | `src/ipc/types/supabase.ts:233` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:get-edge-logs` | `src/ipc/types/supabase.ts:239` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:set-app-project` | `src/ipc/types/supabase.ts:249` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:unset-app-project` | `src/ipc/types/supabase.ts:259` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:detect-legacy-app-key` | `src/ipc/types/supabase.ts:275` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:switch-app-to-publishable-key` | `src/ipc/types/supabase.ts:293` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:redeploy-all-functions` | `src/ipc/types/supabase.ts:305` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:fake-connect-and-set-project` | `src/ipc/types/supabase.ts:319` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `supabase:redeploy-progress` | `src/ipc/types/supabase.ts:330` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `codex-subscription:status` | `src/ipc/types/settings.ts:21` | `PORT` - engine request/event; port after payload and ownership review |
| `codex-subscription:acknowledge` | `src/ipc/types/settings.ts:45` | `PORT` - engine request/event; port after payload and ownership review |
| `codex-subscription:connect` | `src/ipc/types/settings.ts:50` | `PORT` - engine request/event; port after payload and ownership review |
| `codex-subscription:disconnect` | `src/ipc/types/settings.ts:58` | `PORT` - engine request/event; port after payload and ownership review |
| `get-user-settings` | `src/ipc/types/settings.ts:67` | `PORT` - engine request/event; port after payload and ownership review |
| `set-user-settings` | `src/ipc/types/settings.ts:77` | `PORT` - engine request/event; port after payload and ownership review |
| `validate-provider-api-key` | `src/ipc/types/settings.ts:86` | `PORT` - engine request/event; port after payload and ownership review |
| `window:minimize` | `src/ipc/types/system.ts:209` | `ADAPT` - desktop capability needs a browser equivalent |
| `window:maximize` | `src/ipc/types/system.ts:215` | `ADAPT` - desktop capability needs a browser equivalent |
| `window:close` | `src/ipc/types/system.ts:221` | `ADAPT` - desktop capability needs a browser equivalent |
| `window:focus` | `src/ipc/types/system.ts:228` | `ADAPT` - desktop capability needs a browser equivalent |
| `get-system-platform` | `src/ipc/types/system.ts:235` | `PORT` - engine request/event; port after payload and ownership review |
| `native-theme:get-state` | `src/ipc/types/system.ts:241` | `ADAPT` - desktop capability needs a browser equivalent |
| `get-initial-load-telemetry-context` | `src/ipc/types/system.ts:247` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `get-system-debug-info` | `src/ipc/types/system.ts:257` | `PORT` - engine request/event; port after payload and ownership review |
| `get-app-version` | `src/ipc/types/system.ts:263` | `PORT` - engine request/event; port after payload and ownership review |
| `nodejs-status` | `src/ipc/types/system.ts:270` | `PORT` - engine request/event; port after payload and ownership review |
| `install-pnpm` | `src/ipc/types/system.ts:276` | `PORT` - engine request/event; port after payload and ownership review |
| `install-managed-node` | `src/ipc/types/system.ts:282` | `PORT` - engine request/event; port after payload and ownership review |
| `cancel-managed-node-install` | `src/ipc/types/system.ts:288` | `PORT` - engine request/event; port after payload and ownership review |
| `remove-managed-node` | `src/ipc/types/system.ts:294` | `PORT` - engine request/event; port after payload and ownership review |
| `select-node-folder` | `src/ipc/types/system.ts:300` | `ADAPT` - desktop capability needs a browser equivalent |
| `get-node-path` | `src/ipc/types/system.ts:306` | `PORT` - engine request/event; port after payload and ownership review |
| `select-app-folder` | `src/ipc/types/system.ts:313` | `ADAPT` - desktop capability needs a browser equivalent |
| `get-custom-apps-folder` | `src/ipc/types/system.ts:320` | `ADAPT` - desktop capability needs a browser equivalent |
| `select-custom-apps-folder` | `src/ipc/types/system.ts:326` | `ADAPT` - desktop capability needs a browser equivalent |
| `set-custom-apps-folder` | `src/ipc/types/system.ts:332` | `ADAPT` - desktop capability needs a browser equivalent |
| `open-external-url` | `src/ipc/types/system.ts:339` | `ADAPT` - desktop capability needs a browser equivalent |
| `show-item-in-folder` | `src/ipc/types/system.ts:345` | `ADAPT` - desktop capability needs a browser equivalent |
| `open-file-path` | `src/ipc/types/system.ts:351` | `ADAPT` - desktop capability needs a browser equivalent |
| `clear-session-data` | `src/ipc/types/system.ts:358` | `PORT` - engine request/event; port after payload and ownership review |
| `reset-all` | `src/ipc/types/system.ts:364` | `PORT` - engine request/event; port after payload and ownership review |
| `reload-env-path` | `src/ipc/types/system.ts:370` | `PORT` - engine request/event; port after payload and ownership review |
| `does-release-note-exist` | `src/ipc/types/system.ts:377` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `get-user-budget` | `src/ipc/types/system.ts:384` | `PORT` - engine request/event; port after payload and ownership review |
| `get-subscription-status` | `src/ipc/types/system.ts:390` | `PORT` - engine request/event; port after payload and ownership review |
| `open-billing-action` | `src/ipc/types/system.ts:396` | `ADAPT` - desktop capability needs a browser equivalent |
| `upload-to-signed-url` | `src/ipc/types/system.ts:403` | `ADAPT` - desktop capability needs a browser equivalent |
| `upload-screenshot` | `src/ipc/types/system.ts:422` | `ADAPT` - desktop capability needs a browser equivalent |
| `discard-screenshot` | `src/ipc/types/system.ts:464` | `PORT` - engine request/event; port after payload and ownership review |
| `cancel-upload` | `src/ipc/types/system.ts:472` | `ADAPT` - desktop capability needs a browser equivalent |
| `recopy-screenshot` | `src/ipc/types/system.ts:486` | `PORT` - engine request/event; port after payload and ownership review |
| `take-screenshot` | `src/ipc/types/system.ts:494` | `PORT` - engine request/event; port after payload and ownership review |
| `restart-dyad` | `src/ipc/types/system.ts:504` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `native-theme:updated` | `src/ipc/types/system.ts:516` | `ADAPT` - desktop capability needs a browser equivalent |
| `telemetry:event` | `src/ipc/types/system.ts:521` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `force-close-detected` | `src/ipc/types/system.ts:526` | `PORT` - engine request/event; port after payload and ownership review |
| `managed-node:install-progress` | `src/ipc/types/system.ts:531` | `PORT` - engine request/event; port after payload and ownership review |
| `get-templates` | `src/ipc/types/templates.ts:208` | `PORT` - engine request/event; port after payload and ownership review |
| `get-themes` | `src/ipc/types/templates.ts:214` | `PORT` - engine request/event; port after payload and ownership review |
| `set-app-theme` | `src/ipc/types/templates.ts:220` | `PORT` - engine request/event; port after payload and ownership review |
| `get-app-theme` | `src/ipc/types/templates.ts:226` | `PORT` - engine request/event; port after payload and ownership review |
| `apply-app-template` | `src/ipc/types/templates.ts:232` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `get-custom-themes` | `src/ipc/types/templates.ts:239` | `PORT` - engine request/event; port after payload and ownership review |
| `get-theme-generation-model-options` | `src/ipc/types/templates.ts:245` | `PORT` - engine request/event; port after payload and ownership review |
| `create-custom-theme` | `src/ipc/types/templates.ts:251` | `PORT` - engine request/event; port after payload and ownership review |
| `update-custom-theme` | `src/ipc/types/templates.ts:257` | `PORT` - engine request/event; port after payload and ownership review |
| `delete-custom-theme` | `src/ipc/types/templates.ts:263` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `generate-theme-prompt` | `src/ipc/types/templates.ts:270` | `PORT` - engine request/event; port after payload and ownership review |
| `generate-theme-from-url` | `src/ipc/types/templates.ts:276` | `PORT` - engine request/event; port after payload and ownership review |
| `save-theme-image` | `src/ipc/types/templates.ts:282` | `PORT` - engine request/event; port after payload and ownership review |
| `cleanup-theme-images` | `src/ipc/types/templates.ts:288` | `PORT` - engine request/event; port after payload and ownership review |
| `terminal:open` | `src/ipc/types/terminal.ts:61` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `terminal:close` | `src/ipc/types/terminal.ts:67` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `terminal:kill` | `src/ipc/types/terminal.ts:73` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `terminal:write` | `src/ipc/types/terminal.ts:79` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `terminal:resize` | `src/ipc/types/terminal.ts:85` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `terminal:serialize` | `src/ipc/types/terminal.ts:91` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:get-active-run` | `src/ipc/types/tests.ts:475` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:get-run-queue` | `src/ipc/types/tests.ts:480` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:apply-assertions` | `src/ipc/types/tests.ts:485` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:discard-assertions` | `src/ipc/types/tests.ts:491` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:list` | `src/ipc/types/tests.ts:497` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:run` | `src/ipc/types/tests.ts:503` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:stop` | `src/ipc/types/tests.ts:509` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:screenshot` | `src/ipc/types/tests.ts:515` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:delete` | `src/ipc/types/tests.ts:521` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:detect-legacy` | `src/ipc/types/tests.ts:527` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:migrate-legacy` | `src/ipc/types/tests.ts:533` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:queue-state` | `src/ipc/types/tests.ts:541` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:output` | `src/ipc/types/tests.ts:545` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `tests:run-state` | `src/ipc/types/tests.ts:549` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `get-app-upgrades` | `src/ipc/types/upgrade.ts:33` | `PORT` - engine request/event; port after payload and ownership review |
| `execute-app-upgrade` | `src/ipc/types/upgrade.ts:39` | `PORT` - engine request/event; port after payload and ownership review |
| `user-input:respond` | `src/ipc/types/user_input.ts:146` | `PORT` - engine request/event; port after payload and ownership review |
| `user-input:get-pending` | `src/ipc/types/user_input.ts:154` | `PORT` - engine request/event; port after payload and ownership review |
| `user-input:reject-follow-up` | `src/ipc/types/user_input.ts:159` | `PORT` - engine request/event; port after payload and ownership review |
| `user-input:requested` | `src/ipc/types/user_input.ts:167` | `PORT` - engine request/event; port after payload and ownership review |
| `user-input:armed` | `src/ipc/types/user_input.ts:171` | `PORT` - engine request/event; port after payload and ownership review |
| `user-input:classified` | `src/ipc/types/user_input.ts:178` | `PORT` - engine request/event; port after payload and ownership review |
| `user-input:settled` | `src/ipc/types/user_input.ts:182` | `PORT` - engine request/event; port after payload and ownership review |
| `user-input:follow-up-due` | `src/ipc/types/user_input.ts:186` | `PORT` - engine request/event; port after payload and ownership review |
| `vercel:save-token` | `src/ipc/types/vercel.ts:153` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:list-projects` | `src/ipc/types/vercel.ts:159` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:is-project-available` | `src/ipc/types/vercel.ts:165` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:create-project` | `src/ipc/types/vercel.ts:171` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:connect-existing-project` | `src/ipc/types/vercel.ts:177` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:get-deployments` | `src/ipc/types/vercel.ts:183` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:disconnect` | `src/ipc/types/vercel.ts:189` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:get-sync-preview` | `src/ipc/types/vercel.ts:195` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:sync-neon-config` | `src/ipc/types/vercel.ts:201` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `vercel:remove-neon-env-vars` | `src/ipc/types/vercel.ts:207` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `version-preview:acquire-window-interest` | `src/ipc/types/version.ts:182` | `ADAPT` - desktop capability needs a browser equivalent |
| `version-preview:restore-window-interest` | `src/ipc/types/version.ts:188` | `ADAPT` - desktop capability needs a browser equivalent |
| `version-preview:release-window-interest` | `src/ipc/types/version.ts:194` | `DISABLE/ADAPT` - exclude initially; cloud integration requires credential redesign |
| `list-versions` | `src/ipc/types/version.ts:214` | `PORT` - engine request/event; port after payload and ownership review |
| `get-version-changes` | `src/ipc/types/version.ts:220` | `PORT` - engine request/event; port after payload and ownership review |
| `set-version-favorite` | `src/ipc/types/version.ts:226` | `PORT` - engine request/event; port after payload and ownership review |
| `set-version-note` | `src/ipc/types/version.ts:233` | `PORT` - engine request/event; port after payload and ownership review |
| `get-current-branch` | `src/ipc/types/version.ts:240` | `PORT` - engine request/event; port after payload and ownership review |
| `version-preview:result` | `src/ipc/types/version.ts:254` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `apply-visual-editing-changes` | `src/ipc/types/visual-editing.ts:135` | `SANDBOX` - filesystem, runtime, Git, or process side effect; runtime only |
| `analyze-component` | `src/ipc/types/visual-editing.ts:141` | `PORT` - engine request/event; port after payload and ownership review |
| `window-infrastructure:bootstrap` | `src/ipc/types/window_infrastructure.ts:23` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:open-entity-in-new-window` | `src/ipc/types/window_infrastructure.ts:39` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:begin-chat-tab-transfer` | `src/ipc/types/window_infrastructure.ts:46` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:adopt-chat-tab-transfer` | `src/ipc/types/window_infrastructure.ts:55` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:reject-chat-tab-transfer` | `src/ipc/types/window_infrastructure.ts:60` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:acknowledge-chat-tab-transfer` | `src/ipc/types/window_infrastructure.ts:65` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:confirm-source-chat-tab-removal` | `src/ipc/types/window_infrastructure.ts:70` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:focus-chat` | `src/ipc/types/window_infrastructure.ts:79` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:set-focused` | `src/ipc/types/window_infrastructure.ts:84` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:set-visible-entities` | `src/ipc/types/window_infrastructure.ts:89` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:set-chat-tab-ownership` | `src/ipc/types/window_infrastructure.ts:94` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:attach-interest` | `src/ipc/types/window_infrastructure.ts:99` | `ADAPT` - desktop capability needs a browser equivalent |
| `window-infrastructure:detach-interest` | `src/ipc/types/window_infrastructure.ts:104` | `ADAPT` - desktop capability needs a browser equivalent |
| `window:query-invalidations` | `src/ipc/types/window_infrastructure.ts:112` | `ADAPT` - desktop capability needs a browser equivalent |
| `window:entity-disposed` | `src/ipc/types/window_infrastructure.ts:116` | `ADAPT` - desktop capability needs a browser equivalent |
| `window:chat-tab-transfer-remove-source` | `src/ipc/types/window_infrastructure.ts:120` | `ADAPT` - desktop capability needs a browser equivalent |
| `window:navigate-to-chat` | `src/ipc/types/window_infrastructure.ts:128` | `ADAPT` - desktop capability needs a browser equivalent |

## Direct Electron import index

| File and line | Import statement | Note |
|---|---|---|
| `src/backup_manager.ts:3` | `import { app } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/preload.ts:4` | `import { contextBridge, ipcRenderer, webFrame } from "electron";` | IPC registration or renderer bridge |
| `src/main/window_security.ts:5` | `} from "electron";` | Electron API/type import; inspect the named symbols at file top and their call sites |
| `src/main/settings.ts:20` | `} from "electron";` | Electron API/type import; inspect the named symbols at file top and their call sites |
| `src/main/preview_web_contents_view.ts:3` | `import { WebContentsView, shell } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/main/preview_web_contents_view.ts:4` | `import type { BrowserWindow, Session, WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/main/preview_cdp_broker.ts:13` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/main_bootstrap.ts:1` | `import { app, dialog } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/main.ts:13` | `} from "electron";` | Electron API/type import; inspect the named symbols at file top and their call sites |
| `src/pro/main/ipc/handlers/local_agent/tool_definitions.ts:10` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/window_infrastructure/main/production_high_volume.ts:1` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/window_infrastructure/main/chat_notification_routing.ts:1` | `import { BrowserWindow, type WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/pro/main/ipc/handlers/local_agent/tools/types.ts:6` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/pro/main/ipc/handlers/local_agent/subagents/subagent_manager.ts:4` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/pro/main/ipc/handlers/local_agent/tools/shell_process.ts:1` | `import { app } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts:15` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/utils/performance_monitor.ts:2` | `import { app } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/pro/main/ipc/handlers/local_agent/tools/mcp_type_defs.ts:2` | `import type { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/user_input/main.ts:2` | `import { BrowserWindow, type WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/utils/window_broadcast.ts:1` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/custom_apps_folder_handlers.ts:1` | `import { dialog } from "electron";` | desktop capability requiring ADAPT or secure runtime implementation |
| `src/ipc/handlers/first_prompt_handlers.ts:1` | `import { ipcMain } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/createFromTemplate.ts:3` | `import { app } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/connection_flow_handlers.ts:1` | `import { BrowserWindow, type WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/coolify_setup_handlers.ts:1` | `import { BrowserWindow } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/debug_handlers.ts:1` | `import { BrowserWindow, clipboard } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/coolify_handlers.ts:1` | `import { BrowserWindow } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/utils/linux_libcurl_shim.ts:4` | `import { app } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/language_model_handlers.ts:24` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/git_branch_handlers.ts:1` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/app_handlers.ts:3` | `import { app, dialog } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/import_handlers.ts:2` | `import { dialog } from "electron";` | desktop capability requiring ADAPT or secure runtime implementation |
| `src/ipc/handlers/github_handlers.ts:1` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/preview_view_handlers.ts:1` | `import { BrowserWindow, ipcMain } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/compaction/compaction_handler.ts:7` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/help_bot_handlers.ts:1` | `import { app } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/session_handlers.ts:1` | `import { session } from "electron";` | Electron-only service requiring replacement or exclusion |
| `src/ipc/handlers/safe_handle.ts:1` | `import type { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/node_handlers.ts:1` | `import { dialog } from "electron";` | desktop capability requiring ADAPT or secure runtime implementation |
| `src/ipc/handlers/pro_handlers.ts:2` | `import { shell } from "electron";` | desktop capability requiring ADAPT or secure runtime implementation |
| `src/ipc/handlers/neon_handlers.ts:2` | `import type { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/native_theme_handlers.ts:1` | `import { BrowserWindow, nativeTheme } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/proposal_handlers.ts:1` | `import { type IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/services/test_run_queue_service.ts:1` | `import type { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/base.ts:1` | `import type { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/chat_stream_handlers.ts:15` | `import { app, type IpcMainInvokeEvent, type WebContents } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/utils/telemetry.ts:1` | `import { BrowserWindow } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/media_handlers.ts:20` | `import { app as electronApp, shell } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/chat_handlers.ts:22` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/mcp_handlers.ts:34` | `import { safeStorage } from "electron";` | desktop capability requiring ADAPT or secure runtime implementation |
| `src/ipc/handlers/vercel_handlers.ts:1` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/tests_handlers.ts:18` | `import { BrowserWindow } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/tests_handlers.ts:19` | `import type { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/terminal_handlers.ts:1` | `import { app } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/utils/secret_storage.ts:1` | `import { safeStorage } from "electron";` | desktop capability requiring ADAPT or secure runtime implementation |
| `src/ipc/handlers/trusted_handle.ts:1` | `import { ipcMain, type IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/handlers/window_handlers.ts:1` | `import { BrowserWindow } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/services/chat_actor_platform.ts:1` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/handlers/shell_handler.ts:1` | `import { app, shell } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/services/app_runtime_transport.ts:1` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/services/preview_storage.ts:1` | `import { session } from "electron";` | Electron-only service requiring replacement or exclusion |
| `src/ipc/processors/supabase_dependency_analysis.ts:2` | `import { utilityProcess } from "electron";` | Electron-only service requiring replacement or exclusion |
| `src/ipc/services/codex_subscription_auth.ts:1` | `import { safeStorage, shell } from "electron";` | desktop capability requiring ADAPT or secure runtime implementation |
| `src/ipc/utils/mcp_oauth_provider.ts:1` | `import { shell } from "electron";` | desktop capability requiring ADAPT or secure runtime implementation |
| `src/ipc/processors/code_explorer.ts:3` | `import { utilityProcess, type UtilityProcess } from "electron";` | Electron-only service requiring replacement or exclusion |
| `src/ipc/utils/mcp_consent.ts:4` | `import { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/services/github_ops_service.ts:1` | `import type { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/utils/managed_node.ts:1` | `import { net } from "electron";` | Electron-only service requiring replacement or exclusion |
| `src/ipc/utils/ripgrep_utils.ts:5` | `import { app } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/services/first_prompt_creation_service.ts:2` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/utils/renderer_security.ts:1` | `import type { IpcMainInvokeEvent } from "electron";` | IPC registration or renderer bridge |
| `src/ipc/utils/query_invalidation_delivery.ts:1` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |
| `src/ipc/utils/pty_session_manager.ts:4` | `import type { WebContents } from "electron";` | process paths, application lifecycle, or renderer event target |

## PostHog call-site index (all source matches)

| File and line | Call | Classification |
|---|---|---|
| `src/first_prompt/FirstPromptProvider.tsx:191` | `posthog.capture("home:chat-submit", {` | DISABLE per Seltra plan |
| `src/first_prompt/FirstPromptProvider.tsx:194` | `posthog.capture("chat:home_submit", {` | DISABLE per Seltra plan |
| `src/first_prompt/FirstPromptProvider.tsx:212` | `posthog.capture("home:ai-setup-dialog-open");` | DISABLE per Seltra plan |
| `src/lib/toast.tsx:164` | `posthog.capture("extra-files:error", {` | DISABLE per Seltra plan |
| `src/lib/toast.tsx:173` | `posthog.capture("extra-files:warning", {` | DISABLE per Seltra plan |
| `src/lib/integrationSetupTelemetry.ts:19` | `posthog.capture("integration-setup:start", event);` | DISABLE per Seltra plan |
| `src/lib/integrationSetupTelemetry.ts:29` | `posthog.capture("integration-setup:complete", event);` | DISABLE per Seltra plan |
| `src/renderer.tsx:113` | `const posthogClient = posthog.init(` | DISABLE per Seltra plan |
| `src/renderer.tsx:116` | `api_host: "https://us.i.posthog.com",` | DISABLE per Seltra plan |
| `src/renderer.tsx:220` | `posthog.capture("navigation", {` | DISABLE per Seltra plan |
| `src/renderer.tsx:226` | `posthog.capture("$pageview", {` | DISABLE per Seltra plan |
| `src/renderer.tsx:241` | `posthog.captureException(` | DISABLE per Seltra plan |
| `src/renderer.tsx:248` | `posthog.capture(eventName, properties);` | DISABLE per Seltra plan |
| `src/hooks/useSettings.ts:96` | `posthog.capture(` | DISABLE per Seltra plan |
| `src/hooks/useChatModeToggle.ts:80` | `posthog.capture("chat:mode_toggle", {` | DISABLE per Seltra plan |
| `src/components/SubscriptionStatusBanner.tsx:50` | `posthog.capture("billing_nudge_shown", {` | DISABLE per Seltra plan |
| `src/components/SubscriptionStatusBanner.tsx:60` | `posthog.capture("billing_nudge_resolved", {` | DISABLE per Seltra plan |
| `src/components/SubscriptionStatusBanner.tsx:157` | `posthog.capture("billing_nudge_clicked", {` | DISABLE per Seltra plan |
| `src/components/SubscriptionStatusBanner.tsx:175` | `posthog.capture("billing_nudge_dismissed", {` | DISABLE per Seltra plan |
| `src/components/SetupBanner.tsx:70` | `posthog.capture("setup-flow:ai-provider-setup:chatgpt:click");` | DISABLE per Seltra plan |
| `src/components/SetupBanner.tsx:75` | `posthog.capture("setup-flow:ai-provider-setup:openrouter:click");` | DISABLE per Seltra plan |
| `src/components/SetupBanner.tsx:82` | `posthog.capture("setup-flow:ai-provider-setup:dyad:click");` | DISABLE per Seltra plan |
| `src/components/SetupBanner.tsx:89` | `posthog.capture("setup-flow:ai-provider-setup:other:click");` | DISABLE per Seltra plan |
| `src/components/SetupBanner.tsx:321` | `posthog.capture("setup-flow:ai-provider-setup:openrouter:click");` | DISABLE per Seltra plan |
| `src/pages/home.tsx:223` | `posthog.capture("home:setup-pill:click");` | DISABLE per Seltra plan |
| `src/components/preview_panel/VisualEditingChangesDialog.tsx:37` | `posthog.capture("visual-editor:edit");` | DISABLE per Seltra plan |
| `src/components/preview_panel/VisualEditingChangesDialog.tsx:91` | `posthog.capture("visual-editor:save");` | DISABLE per Seltra plan |
| `src/components/preview_panel/VisualEditingChangesDialog.tsx:158` | `posthog.capture("visual-editor:save");` | DISABLE per Seltra plan |
| `src/components/ModelPicker.tsx:280` | `posthog.capture("model-picker:select", {` | DISABLE per Seltra plan |
| `src/components/ModelPicker.tsx:378` | `posthog.capture("model-picker:open", {` | DISABLE per Seltra plan |
| `src/components/ModelPicker.tsx:850` | `posthog.capture("model-picker:locked-model-click", {` | DISABLE per Seltra plan |
| `src/components/ModelPicker.tsx:859` | `posthog.capture("model-picker:upgrade-click", {` | DISABLE per Seltra plan |
| `src/components/ModelPicker.tsx:872` | `posthog.capture("model-picker:upgrade-click", {` | DISABLE per Seltra plan |
| `src/components/ModelPicker.tsx:887` | `posthog.capture("model-picker:add-own-key-click", {` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:472` | `posthog.capture("issue-form:opened", { source });` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:488` | `posthog.capture("issue-form:blocked", {` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:791` | `posthog.capture("screenshot-prompt:bar-opened", {` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:800` | `posthog.capture("screenshot-prompt:bar-cancelled", {` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:813` | `posthog.capture("screenshot-prompt:capture-attempt", {` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:831` | `posthog.capture("screenshot-prompt:captured", {` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:838` | `posthog.capture("screenshot-prompt:capture-failed", {` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:864` | `posthog.capture("screenshot-prompt:removed", {` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:956` | `posthog.capture("screenshot-prompt:upload-attempt", { source });` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:970` | `posthog.capture("screenshot-prompt:uploaded", { source });` | DISABLE per Seltra plan |
| `src/components/HelpDialog.tsx:978` | `posthog.capture("screenshot-prompt:upload-failed", { source, failure });` | DISABLE per Seltra plan |
| `src/components/chat/ChatInput.tsx:744` | `posthog.capture("chat:submit", { chatMode });` | DISABLE per Seltra plan |
| `src/components/chat/ChatInput.tsx:802` | `posthog.capture("chat:approve");` | DISABLE per Seltra plan |
| `src/components/chat/ChatInput.tsx:844` | `posthog.capture("chat:reject");` | DISABLE per Seltra plan |
| `src/components/chat/ChatInput.tsx:1333` | `posthog.capture("action:rebuild");` | DISABLE per Seltra plan |
| `src/components/chat/ChatInput.tsx:1356` | `posthog.capture("action:restart");` | DISABLE per Seltra plan |
| `src/components/chat/ChatInput.tsx:1376` | `posthog.capture("action:refresh");` | DISABLE per Seltra plan |
| `src/components/ErrorBoundary.tsx:14` | `posthog.captureException(error);` | DISABLE per Seltra plan |
| `src/ipc/handlers/debug_handlers.ts:174` | `telemetryUrl: "https://us.i.posthog.com", // Hardcoded from renderer.tsx` | DISABLE per Seltra plan |

## dyad.sh host call-site index

| File and line | URL / call | Initial handling |
|---|---|---|
| `src/connection_flow/oauth_deep_link.ts:9` | `neon: "https://oauth.dyad.sh/api/integrations/neon/login",` | Review host and classify; disable desktop service unless required |
| `src/connection_flow/oauth_deep_link.ts:10` | `supabase: "https://supabase-oauth.dyad.sh/api/connect-supabase/login",` | Review host and classify; disable desktop service unless required |
| `src/components/AppUpgrades.tsx:135` | `upgrade.manualUpgradeUrl ?? "https://dyad.sh/docs",` | Review host and classify; disable desktop service unless required |
| `src/main/window_security.ts:8` | `"https://dyad.sh",` | Review host and classify; disable desktop service unless required |
| `src/main/window_security.ts:9` | `"https://www.dyad.sh",` | Review host and classify; disable desktop service unless required |
| `src/pages/home.tsx:201` | `"https://www.dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=home-upgrade-to-pro",` | Review host and classify; disable desktop service unless required |
| `src/main/settings.ts:96` | `"https://www.dyad.sh/docs/guides/migrate-restore#restoring-settings-from-backup";` | Review host and classify; disable desktop service unless required |
| `src/components/CapacitorControls.tsx:140` | `"https://dyad.sh/docs/guides/mobile-app#troubleshooting",` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatErrorBox.tsx:82` | `href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=free-quota-error"` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatErrorBox.tsx:110` | `href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=rate-limit-error"` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatErrorBox.tsx:116` | `<ExternalLink href="https://dyad.sh/docs/help/ai-rate-limit">` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatErrorBox.tsx:168` | `href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=free-agent-quota-exceeded"` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatErrorBox.tsx:206` | `href="https://academy.dyad.sh/subscription?utm_source=dyad-app&utm_medium=app&utm_campaign=exceeded-budget-error"` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatErrorBox.tsx:226` | `href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=general-error"` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatErrorBox.tsx:246` | `<ExternalLink href="https://www.dyad.sh/docs/faq">` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatInput.tsx:1021` | `ipc.system.openExternalUrl("https://dyad.sh/pro");` | Review host and classify; disable desktop service unless required |
| `src/components/chat/ChatInput.tsx:1126` | `ipc.system.openExternalUrl("https://dyad.sh/pro")` | Review host and classify; disable desktop service unless required |
| `src/supabase_admin/supabase_management_client.ts:280` | `"https://supabase-oauth.dyad.sh/api/connect-supabase/refresh",` | Review host and classify; disable desktop service unless required |
| `src/supabase_admin/supabase_management_client.ts:428` | `"https://supabase-oauth.dyad.sh/api/connect-supabase/refresh",` | Review host and classify; disable desktop service unless required |
| `src/supabase_admin/supabase_context.ts:91` | `"Dyad couldn't find a publishable key for this Supabase project. It may be paused or connected through the wrong Supabase account. Resume the project in Supabase, or reconnect the correct project in Dyad. See https://dyad.sh/docs/integrations/supabase#no-publishable-keys",` | Review host and classify; disable desktop service unless required |
| `src/neon_admin/neon_management_client.ts:54` | `"https://oauth.dyad.sh/api/integrations/neon/refresh",` | Review host and classify; disable desktop service unless required |
| `src/main.ts:642` | `const host = `https://api.dyad.sh/v1/update/${postfix}`;` | DISABLE or replace with Seltra service |
| `src/components/chat/HomeChatInput.tsx:232` | `ipc.system.openExternalUrl("https://dyad.sh/pro")` | Review host and classify; disable desktop service unless required |
| `src/components/chat/FreeAgentQuotaBanner.tsx:47` | `ipc.system.openExternalUrl("https://dyad.sh/pro");` | Review host and classify; disable desktop service unless required |
| `src/components/DyadProTrialDialog.tsx:22` | ``https://academy.dyad.sh/redirect-to-checkout?trialCode=7PRO30&${utmParams}`,` | Review host and classify; disable desktop service unless required |
| `src/components/DyadProTrialDialog.tsx:28` | `ipc.system.openExternalUrl(`https://www.dyad.sh/pro?${utmParams}`);` | Review host and classify; disable desktop service unless required |
| `src/components/HelpDialog.tsx:47` | `const UPLOAD_URL_ENDPOINT = "https://upload-logs.dyad.sh/generate-upload-url";` | Review host and classify; disable desktop service unless required |
| `src/components/HelpDialog.tsx:1114` | `ipc.system.openExternalUrl("https://www.dyad.sh/docs")` | Review host and classify; disable desktop service unless required |
| `src/components/GitHubConnector.tsx:77` | `href="https://www.dyad.sh/docs/integrations/github#troubleshooting"` | Review host and classify; disable desktop service unless required |
| `src/components/GitHubConnector.tsx:81` | `"https://www.dyad.sh/docs/integrations/github#troubleshooting",` | Review host and classify; disable desktop service unless required |
| `src/components/ModelPicker.tsx:109` | `"https://www.dyad.sh/pro?utm_source=dyad-app&utm_medium=app";` | Review host and classify; disable desktop service unless required |
| `src/components/ModelPicker.tsx:1644` | `"https://academy.dyad.sh/subscription",` | Review host and classify; disable desktop service unless required |
| `src/components/preview_panel/AnnotatorOnlyForPro.tsx:11` | `ipc.system.openExternalUrl("https://dyad.sh/pro");` | Review host and classify; disable desktop service unless required |
| `src/components/PortalMigrate.tsx:44` | `"https://www.dyad.sh/docs/templates/portal#create-a-database-migration",` | Review host and classify; disable desktop service unless required |
| `src/components/preview_panel/PackageManagerWarningBanner.tsx:90` | `? "https://dyad.sh/docs/upgrades/pnpm-migration"` | Review host and classify; disable desktop service unless required |
| `src/__tests__/evals/README.md:48` | ``https://engine.dyad.sh/v1`).` | Model gateway/runtime route; never expose provider credentials |
| `src/__tests__/evals/helpers/get_eval_model.ts:18` | `process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";` | Model gateway/runtime route; never expose provider credentials |
| `src/components/RuntimeModeSelector.tsx:122` | `onClick={() => ipc.system.openExternalUrl("https://dyad.sh/pro#ai")}` | Review host and classify; disable desktop service unless required |
| `src/components/SetupBanner.tsx:84` | `"https://academy.dyad.sh/redirect-to-checkout?trialCode=7PRO30&utm_source=dyad-app&utm_medium=app&utm_campaign=setup-dialog-v2",` | Review host and classify; disable desktop service unless required |
| `src/components/preview_panel/SecurityPanel.tsx:283` | `"https://www.dyad.sh/docs/guides/security-review",` | Review host and classify; disable desktop service unless required |
| `src/components/ReleaseChannelSelector.tsx:33` | `ipc.system.openExternalUrl("https://dyad.sh/download");` | Review host and classify; disable desktop service unless required |
| `src/components/ProModeSelector.tsx:72` | `ipc.system.openExternalUrl("https://dyad.sh/pro#ai");` | Review host and classify; disable desktop service unless required |
| `src/components/ProModeSelector.tsx:74` | `title="Visit dyad.sh/pro to unlock Pro features"` | Review host and classify; disable desktop service unless required |
| `src/components/ProBanner.tsx:40` | `ipc.system.openExternalUrl("https://academy.dyad.sh/settings");` | Review host and classify; disable desktop service unless required |
| `src/components/ProBanner.tsx:56` | `"https://www.dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=in-app-banner-ai-access",` | Review host and classify; disable desktop service unless required |
| `src/components/ProBanner.tsx:123` | `"https://www.dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=in-app-banner-smart-context",` | Review host and classify; disable desktop service unless required |
| `src/components/TelemetryBanner.tsx:48` | `"https://dyad.sh/docs/policies/privacy-policy",` | Review host and classify; disable desktop service unless required |
| `src/shared/subscription_billing_error.ts:10` | `url: "https://academy.dyad.sh/subscription",` | Review host and classify; disable desktop service unless required |
| `src/shared/subscription_billing_error.ts:17` | `url: "https://academy.dyad.sh",` | Review host and classify; disable desktop service unless required |
| `src/__tests__/evals/appbench_cell.eval.ts:287` | `"git add -A && git -c user.email=bench@dyad.sh -c user.name=bench commit -m 'appbench: env + lockfile' --allow-empty",` | Review host and classify; disable desktop service unless required |
| `src/__tests__/evals/appbench_cell.eval.ts:358` | ``git add -A && git -c user.email=bench@dyad.sh -c user.name=bench commit -m 'checkpoint m${m}' --allow-empty && git tag -f checkpoint-m${m}`,` | Review host and classify; disable desktop service unless required |
| `src/testing/HYBRID_HARNESS.md:348` | ``api.dyad.sh/v1/desktop-config`). They are caught and logged, not failures. The act, pnpm-install, and DB-teardown noise **is** handled (S6, S8).` | DISABLE or replace with Seltra service |
| `src/testing/chat_flow_harness.ts:354` | `// api.dyad.sh.` | DISABLE or replace with Seltra service |
| `src/__tests__/evals/fixtures/compaction/generate.mjs:38` | `const ENGINE_URL = process.env.DYAD_ENGINE_URL \\|\\| "https://engine.dyad.sh/v1";` | Model gateway/runtime route; never expose provider credentials |
| `src/ipc/utils/dyad_engine_url.ts:2` | `return process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";` | Model gateway/runtime route; never expose provider credentials |
| `src/ipc/utils/git_author.ts:17` | `email: "git@dyad.sh",` | Review host and classify; disable desktop service unless required |
| `src/ipc/handlers/app_upgrade_handlers.ts:37` | `manualUpgradeUrl: "https://dyad.sh/docs/upgrades/select-component",` | Review host and classify; disable desktop service unless required |
| `src/ipc/handlers/app_upgrade_handlers.ts:45` | `"https://dyad.sh/docs/guides/mobile-app#upgrade-your-app",` | Review host and classify; disable desktop service unless required |
| `src/ipc/handlers/app_upgrade_handlers.ts:54` | `manualUpgradeUrl: "https://dyad.sh/docs/upgrades/pnpm-migration",` | Review host and classify; disable desktop service unless required |
| `src/ipc/utils/openrouter_attribution.ts:1` | `export const OPENROUTER_APP_REFERER = "https://www.dyad.sh";` | Review host and classify; disable desktop service unless required |
| `src/ipc/utils/socket_firewall.ts:70` | `"https://api.dyad.sh/v1/default-approve-builds.txt";` | DISABLE or replace with Seltra service |
| `src/ipc/utils/template_utils.ts:41` | `const response = await fetch("https://api.dyad.sh/v1/templates");` | DISABLE or replace with Seltra service |
| `src/ipc/handlers/help_bot_handlers.ts:69` | `baseURL: "https://helpchat.dyad.sh/v1",` | Review host and classify; disable desktop service unless required |
| `src/ipc/handlers/help_bot_handlers.ts:79` | `// responses API via a custom baseURL (helpchat.dyad.sh).` | Review host and classify; disable desktop service unless required |
| `src/ipc/handlers/free_agent_quota_handlers.ts:24` | `* Uses the HTTP Date header from api.dyad.sh.` | DISABLE or replace with Seltra service |
| `src/ipc/handlers/free_agent_quota_handlers.ts:40` | `const response = await fetch("https://api.dyad.sh/health", {` | DISABLE or replace with Seltra service |
| `src/ipc/handlers/pro_handlers.ts:74` | `"https://academy.dyad.sh/api/desktop/subscription-status"` | Review host and classify; disable desktop service unless required |
| `src/ipc/handlers/pro_handlers.ts:107` | `url.hostname !== "academy.dyad.sh" \\|\\|` | Review host and classify; disable desktop service unless required |
| `src/ipc/handlers/shell_handler.ts:14` | `// (Neon, Supabase, and Dyad Pro all live under *.dyad.sh).` | Review host and classify; disable desktop service unless required |
| `src/ipc/handlers/shell_handler.ts:18` | `return host === "dyad.sh" \\|\\| host.endsWith(".dyad.sh");` | Review host and classify; disable desktop service unless required |
| `src/ipc/shared/remote_mcp_catalog.ts:24` | `return "https://api.dyad.sh/v1/mcp-catalog";` | DISABLE or replace with Seltra service |
| `src/ipc/shared/remote_language_model_catalog.ts:43` | `return "https://api.dyad.sh/v1/language-model-catalog";` | DISABLE or replace with Seltra service |
| `src/ipc/shared/language_model_constants.ts:649` | `websiteUrl: "https://academy.dyad.sh/subscription",` | Review host and classify; disable desktop service unless required |
| `src/ipc/shared/remote_desktop_config.ts:36` | `return "https://api.dyad.sh/v1/desktop-config";` | DISABLE or replace with Seltra service |
| `src/ipc/handlers/release_note_handlers.ts:28` | `const releaseNoteUrl = `https://www.dyad.sh/docs/releases/${version}`;` | Review host and classify; disable desktop service unless required |
| `src/ipc/services/user_budget_service.ts:26` | `process.env.DYAD_USER_INFO_URL ?? "https://api.dyad.sh/v1/user/info",` | DISABLE or replace with Seltra service |

## Native module and child-process source index

| File and line | Match | Classification |
|---|---|---|
| `src/lib/packaging_cleanup.ts:226` | `path.join(appPath, "node_modules", "node-pty"),` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/windows_command.ts:10` | `* Node's spawn (and node-pty) won't find it without the extension.` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/windows_command.ts:55` | `* Single source of truth for both spawn (`spawn_streaming`) and node-pty` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/windows_command.ts:61` | `* `child_process.spawn` via `windowsVerbatimArguments: true`, and node-pty by` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/windows_command.ts:63` | `* node-pty don't apply a *second* MSVC `\"` argv-escaping layer on top of` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/socket_firewall.ts:1137` | `// Forward the verbatim flag so node-pty doesn't re-escape the cmd-quoted` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_session_manager.ts:3` | `import { spawn as defaultSpawnPty } from "node-pty";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_command_runner.ts:2` | `import { spawn as spawnPty } from "node-pty";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_command_runner.ts:170` | `* When true, `args` is a pre-escaped command line that node-pty must forward` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_command_runner.ts:174` | `* second escaping layer would corrupt every quoted argument. node-pty is` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_command_runner.ts:395` | `// node-pty is a native module built for Electron's ABI; under a plain node` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_command_runner.ts:508` | `// already quoted. Pass it as a single string so node-pty's` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_command_runner.ts:513` | `// the array so node-pty applies its normal argv-quoting for real` | SANDBOX; process/file/database capability stays in runtime |
| `src/__tests__/evals/appbench_cell.eval.ts:29` | `// node-pty is Electron-ABI; under vitest it posix_spawnp-fails (broke` | SANDBOX; process/file/database capability stays in runtime |
| `src/data/default-approve-builds.txt:22` | `@cdktf/node-pty-prebuilt-multiarch` | SANDBOX; process/file/database capability stays in runtime |
| `src/data/default-approve-builds.txt:262` | `node-pty` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/handlers/node_handlers.ts:133` | `// invocation get mangled by the cmd.exe quoting that node-pty applies,` | SANDBOX; process/file/database capability stays in runtime |
| `src/main.ts:398` | `return path.join(app.getAppPath(), "node_modules/dugite/git");` | SANDBOX; process/file/database capability stays in runtime |
| `src/lib/packaging_cleanup.ts:286` | `// dugite-native's git distribution bundles Git Credential Manager (GCM), a` | SANDBOX; process/file/database capability stays in runtime |
| `src/lib/packaging_cleanup.ts:313` | `// assemblies; audit this sweep when upgrading dugite's bundled git layout.` | SANDBOX; process/file/database capability stays in runtime |
| `src/lib/packaging_cleanup.ts:347` | `// minGit subfolder varies by arch (see dugite's git-environment).` | SANDBOX; process/file/database capability stays in runtime |
| `src/data/default-approve-builds.txt:157` | `dugite` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/linux_libcurl_shim.ts:10` | `* The bundled dugite git http helpers (git-remote-https/git-remote-http) are` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/git_utils.ts:9` | `} from "dugite";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/git_utils.ts:919` | `// Perform the commit using dugite with -c user.name/email config` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/ripgrep_utils.ts:24` | `// Dev: app.getAppPath() is the project root (same pattern as dugite)` | SANDBOX; process/file/database capability stays in runtime |
| `src/backup_manager.ts:5` | `import Database from "better-sqlite3";` | SANDBOX; per-workspace SQLite database |
| `src/chat_stream/persistence.ts:2` | `import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";` | SANDBOX; per-workspace SQLite database |
| `src/db/index.ts:5` | `} from "drizzle-orm/better-sqlite3";` | SANDBOX; per-workspace SQLite database |
| `src/db/index.ts:6` | `import Database from "better-sqlite3";` | SANDBOX; per-workspace SQLite database |
| `src/db/index.ts:8` | `import { migrate } from "drizzle-orm/better-sqlite3/migrator";` | SANDBOX; per-workspace SQLite database |
| `src/data/default-approve-builds.txt:121` | `better-sqlite3` | SANDBOX; per-workspace SQLite database |
| `src/lib/packaging_cleanup.ts:230` | `pruneBetterSqlite3(path.join(appPath, "node_modules", "better-sqlite3")),` | SANDBOX; per-workspace SQLite database |
| `src/testing/test_db.ts:1` | `import Database from "better-sqlite3";` | SANDBOX; per-workspace SQLite database |
| `src/testing/test_db.ts:5` | `} from "drizzle-orm/better-sqlite3";` | SANDBOX; per-workspace SQLite database |
| `src/testing/test_db.ts:6` | `import { migrate } from "drizzle-orm/better-sqlite3/migrator";` | SANDBOX; per-workspace SQLite database |
| `src/ipc/handlers/version_handlers.ts:1780` | `// the chat insert. better-sqlite3 transactions are synchronous, so the` | SANDBOX; per-workspace SQLite database |
| `src/ipc/handlers/chat_turn_acceptance.ts:1` | `import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";` | SANDBOX; per-workspace SQLite database |
| `src/pro/main/ipc/handlers/local_agent/chat_search_indexer.ts:16` | `* Everything runs on the main process against the single shared better-sqlite3` | SANDBOX; per-workspace SQLite database |
| `src/main/safe_storage_legacy.ts:1` | `import { execFileSync } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/main/linux_protocol_registration.ts:1` | `import { execFile } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/main.ts:16` | `import { execFile } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/utils/process_memory_diagnostics.ts:1` | `import { execFile } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/testing/hybrid_chat_harness.tsx:1` | `import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/testing/headless_app_preview.ts:21` | `*     -> child_process.spawn("<pnpm\\|npm> install && . run dev --port <p>")` | SANDBOX; process/file/database capability stays in runtime |
| `src/testing/electron_mock.ts:192` | `// Functional shim: forks the real worker bundle via child_process with` | SANDBOX; process/file/database capability stays in runtime |
| `src/testing/electron_mock.ts:199` | `require("node:child_process") as typeof import("node:child_process");` | SANDBOX; process/file/database capability stays in runtime |
| `src/testing/code_explorer_fork_wrapper.cjs:2` | `// child_process.fork child so the real code-explorer worker bundle runs in` | SANDBOX; process/file/database capability stays in runtime |
| `src/testing/chat_flow_harness.ts:21` | `import { execFileSync } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/windows_env_path.ts:1` | `import { spawn } from "child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/windows_command.ts:61` | `* `child_process.spawn` via `windowsVerbatimArguments: true`, and node-pty by` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/spawn_streaming.ts:1` | `import { spawn, type ChildProcess } from "child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/runShellCommand.ts:1` | `import { spawn } from "child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_command_runner.ts:1` | `import { spawn as spawnProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/pty_command_runner.ts:397` | `// DYAD_DISABLE_PTY=1 opts into a plain child_process execution with the` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/process_manager.ts:1` | `import { ChildProcess, spawn } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/buffered_process.ts:1` | `import { spawn, type ChildProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/__tests__/evals/appbench_cell.eval.ts:16` | `import { execSync } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/__tests__/evals/appbench_cell.eval.ts:30` | `// add_dependency in early S-FORMS runs). Use the child_process fallback.` | SANDBOX; process/file/database capability stays in runtime |
| `src/pro/main/ipc/handlers/local_agent/tools/shell_process.ts:2` | `import { spawn, spawnSync } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/managed_node.ts:8` | `import { spawn } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/linux_libcurl_shim.ts:1` | `import { execFileSync } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/utils/kill_process_tree_sync.ts:1` | `import { spawnSync } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/pro/main/ipc/handlers/local_agent/tools/grep.ts:2` | `import { spawn } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/services/e2e_test_workspace.ts:1` | `import type { ChildProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/services/e2e_test_runtime.ts:1` | `import { spawn, type ChildProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/services/e2e_test_process_registry.ts:1` | `import type { ChildProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/services/claude_code/runtime.ts:1` | `import { spawn, execFile, type ChildProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/services/isolated_package_install.ts:1` | `import type { ChildProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/services/app_runtime_service.ts:1` | `import { spawn, type ChildProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/handlers/app_handlers.ts:20` | `import { spawn } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |
| `src/ipc/handlers/tests_handlers.ts:1` | `import type { ChildProcess } from "node:child_process";` | SANDBOX; process/file/database capability stays in runtime |

## Path and preview URL source index

| File and line | Match | Note |
|---|---|---|
| `src/db/index.ts:11` | `import { getUserDataPath } from "../paths/paths";` | User data path; isolate per runtime workspace |
| `src/db/index.ts:23` | `return path.join(getUserDataPath(), "sqlite.db");` | User data path; isolate per runtime workspace |
| `src/db/index.ts:55` | `fs.mkdirSync(getUserDataPath(), { recursive: true });` | User data path; isolate per runtime workspace |
| `src/coolify_setup/server_key.ts:4` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/coolify_setup/server_key.ts:28` | `return path.join(getUserDataPath(), "coolify_server_key");` | User data path; isolate per runtime workspace |
| `src/backup_manager.ts:56` | `this.userDataPath = app.getPath("userData");` | Path use; review for workspace-root confinement |
| `src/main.ts:113` | `getUserDataPath,` | User data path; isolate per runtime workspace |
| `src/main.ts:196` | `const devUserData = getUserDataPath();` | User data path; isolate per runtime workspace |
| `src/main.ts:310` | `const crashDumpsDir = app.getPath("crashDumps");` | Path use; review for workspace-root confinement |
| `src/main.ts:314` | `const retainDir = path.join(app.getPath("userData"), "dyad-crash-reports");` | Path use; review for workspace-root confinement |
| `src/main.ts:435` | `void registerDyadProtocolLinux(app.getPath("userData"));` | Path use; review for workspace-root confinement |
| `src/main.ts:513` | `// Add dyad-apps directory to git safe.directory (required for Windows).` | Application root literal/helper; map to workspace apps directory |
| `src/main.ts:583` | `logger.info("Crash dumps directory:", app.getPath("crashDumps"));` | Path use; review for workspace-root confinement |
| `src/main.ts:593` | `cacheRoot: getMediaThumbnailCacheRoot(app.getPath("sessionData")),` | Path use; review for workspace-root confinement |
| `src/main.ts:1208` | `await clearLegacyWindowSessionPersistence(app.getPath("userData"));` | Path use; review for workspace-root confinement |
| `src/main/settings.ts:3` | `import { getUserDataPath } from "../paths/paths";` | User data path; isolate per runtime workspace |
| `src/main/settings.ts:119` | `return path.join(getUserDataPath(), SETTINGS_FILE);` | User data path; isolate per runtime workspace |
| `src/main/settings.ts:123` | `return path.join(getUserDataPath(), CRASH_SENTINEL_FILE);` | User data path; isolate per runtime workspace |
| `src/main/settings.ts:237` | `return path.join(getUserDataPath(), RENDERER_CRASH_FILE);` | User data path; isolate per runtime workspace |
| `src/main/linux_protocol_registration.ts:30` | `// Absolute userData dir the running dev instance is using (app.getPath).` | Path use; review for workspace-root confinement |
| `src/main/linux_protocol_registration.ts:31` | `// In dev, getUserDataPath() falls back to path.resolve("./userData"), i.e.` | User data path; isolate per runtime workspace |
| `src/main/linux_protocol_registration.ts:76` | `// "development", and getUserDataPath() then resolves "./userData" relative` | User data path; isolate per runtime workspace |
| `src/main/linux_protocol_registration.ts:140` | `// `devUserDataDir` should be the running instance's app.getPath("userData"); it` | Path use; review for workspace-root confinement |
| `src/main/last_session_store.ts:8` | `import { getUserDataPath } from "../paths/paths";` | User data path; isolate per runtime workspace |
| `src/main/last_session_store.ts:21` | `return path.join(getUserDataPath(), LAST_SESSION_FILE);` | User data path; isolate per runtime workspace |
| `src/plan_handoff/persistence.ts:4` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/plan_handoff/persistence.ts:21` | `return path.join(getUserDataPath(), "plan-handoffs", `${chatId}.json`);` | User data path; isolate per runtime workspace |
| `src/paths/paths.ts:10` | `// Whether `dyad-apps` has been created` | Application root literal/helper; map to workspace apps directory |
| `src/paths/paths.ts:14` | `* Gets the default path of the base dyad-apps directory (without a specific app subdirectory)` | Application root literal/helper; map to workspace apps directory |
| `src/paths/paths.ts:19` | `return path.join(electron!.app.getPath("userData"), "dyad-apps");` | Application root literal/helper; map to workspace apps directory |
| `src/paths/paths.ts:21` | `return path.join(os.homedir(), "dyad-apps");` | Application root literal/helper; map to workspace apps directory |
| `src/paths/paths.ts:25` | `* Gets the default path of the base dyad-apps directory (without a specific app subdirectory),` | Application root literal/helper; map to workspace apps directory |
| `src/paths/paths.ts:106` | `return path.join(electron.app.getPath("sessionData"), "typescript-cache");` | Path use; review for workspace-root confinement |
| `src/paths/paths.ts:110` | `return path.join(getUserDataPath(), "typescript-cache");` | User data path; isolate per runtime workspace |
| `src/paths/paths.ts:119` | `export function getUserDataPath(): string {` | User data path; isolate per runtime workspace |
| `src/paths/paths.ts:129` | `return electron!.app.getPath("userData");` | Path use; review for workspace-root confinement |
| `src/i18n/locales/zh-CN/home.json:24` | `"copyToDyadApps": "??? dyad-apps ???",` | Application root literal/helper; map to workspace apps directory |
| `src/i18n/locales/tr/home.json:27` | `"copyToDyadApps": "dyad-apps klasorune kopyala",` | Application root literal/helper; map to workspace apps directory |
| `src/user_input/questionnaire_journal.ts:13` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/user_input/questionnaire_journal.ts:33` | `const directory = () => path.join(getUserDataPath(), "questionnaire-receipts");` | User data path; isolate per runtime workspace |
| `src/utils/performance_monitor.ts:13` | `import { getUserDataPath } from "../paths/paths";` | User data path; isolate per runtime workspace |
| `src/utils/performance_monitor.ts:239` | `const diskUsage = getDiskUsageMB(getUserDataPath());` | User data path; isolate per runtime workspace |
| `src/testing/electron_mock.ts:9` | `*   - `app.getPath("userData")` resolves to the per-test temp dir chosen by the` | Path use; review for workspace-root confinement |
| `src/i18n/locales/ko/home.json:27` | `"copyToDyadApps": "dyad-apps ??? ??",` | Application root literal/helper; map to workspace apps directory |
| `src/lib/settingsSearchIndex.ts:136` | `keywords: ["customize", "apps", "path", "folder", "directory", "dyad-apps"],` | Application root literal/helper; map to workspace apps directory |
| `src/i18n/locales/es/home.json:27` | `"copyToDyadApps": "Copiar a la carpeta dyad-apps",` | Application root literal/helper; map to workspace apps directory |
| `src/i18n/locales/en/home.json:27` | `"copyToDyadApps": "Copy to the dyad-apps folder",` | Application root literal/helper; map to workspace apps directory |
| `src/i18n/locales/pt-BR/home.json:24` | `"copyToDyadApps": "Copiar para a pasta dyad-apps",` | Application root literal/helper; map to workspace apps directory |
| `src/pro/main/ipc/handlers/local_agent/tools/run_build.ts:35` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/pro/main/ipc/handlers/local_agent/tools/run_build.ts:212` | `return path.join(getUserDataPath(), SNAPSHOT_ROOT_NAME);` | User data path; isolate per runtime workspace |
| `src/components/ImportAppDialog.tsx:432` | `id="copy-to-dyad-apps"` | Application root literal/helper; map to workspace apps directory |
| `src/components/ImportAppDialog.tsx:433` | `aria-label="Copy to the dyad-apps folder"` | Application root literal/helper; map to workspace apps directory |
| `src/components/ImportAppDialog.tsx:441` | `htmlFor="copy-to-dyad-apps"` | Application root literal/helper; map to workspace apps directory |
| `src/ipc/handlers/createFromTemplate.ts:80` | `app.getPath("userData"),` | Path use; review for workspace-root confinement |
| `src/ipc/handlers/shell_handler.ts:72` | `await registerDyadProtocolLinux(app.getPath("userData"));` | Path use; review for workspace-root confinement |
| `src/ipc/handlers/shell_handler.ts:94` | `// The dyad-apps tree contains AI-generated code, so opening arbitrary files` | Application root literal/helper; map to workspace apps directory |
| `src/ipc/handlers/shell_handler.ts:96` | `// App paths may be under the default dyad-apps base directory (normal) or` | Application root literal/helper; map to workspace apps directory |
| `src/ipc/handlers/app_handlers.ts:26` | `getUserDataPath,` | User data path; isolate per runtime workspace |
| `src/ipc/handlers/app_handlers.ts:2014` | `const userDataPath = getUserDataPath();` | User data path; isolate per runtime workspace |
| `src/ipc/handlers/app_handlers.ts:2058` | `// Delete the default `dyad-apps` folder, even if the user no longer uses it` | Application root literal/helper; map to workspace apps directory |
| `src/ipc/services/chat_journal_cleanup.ts:3` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/ipc/services/chat_journal_cleanup.ts:16` | `rm(path.join(getUserDataPath(), directory, `${chatId}${suffix}`), {` | User data path; isolate per runtime workspace |
| `src/ipc/services/codex_subscription_auth.ts:9` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/ipc/services/codex_subscription_auth.ts:55` | `return path.join(getUserDataPath(), "codex-subscription.enc");` | User data path; isolate per runtime workspace |
| `src/ipc/services/e2e_test_workspace.ts:6` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/ipc/services/e2e_test_workspace.ts:147` | `path.join(getUserDataPath(), E2E_TEST_SANDBOX_DIR),` | User data path; isolate per runtime workspace |
| `src/ipc/services/e2e_test_workspace.ts:150` | `path.join(getUserDataPath(), E2E_TEST_ARTIFACT_DIR),` | User data path; isolate per runtime workspace |
| `src/ipc/services/e2e_test_workspace.ts:742` | `path.join(getUserDataPath(), E2E_TEST_ARTIFACT_DIR),` | User data path; isolate per runtime workspace |
| `src/ipc/services/e2e_test_workspace.ts:769` | `const userDataPath = getUserDataPath();` | User data path; isolate per runtime workspace |
| `src/ipc/utils/coolify_deploy_key.ts:6` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/ipc/utils/coolify_deploy_key.ts:31` | `return path.join(getUserDataPath(), "coolify_deploy_keys");` | User data path; isolate per runtime workspace |
| `src/ipc/services/version_preview_persistence.ts:4` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/ipc/services/version_preview_persistence.ts:151` | `return path.join(getUserDataPath(), "state-machines");` | User data path; isolate per runtime workspace |
| `src/ipc/utils/managed_tools.ts:3` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/ipc/utils/managed_tools.ts:19` | `return path.join(getUserDataPath(), MANAGED_TOOLS_DIR);` | User data path; isolate per runtime workspace |
| `src/ipc/utils/linux_libcurl_shim.ts:75` | `const shimDir = path.join(app.getPath("userData"), "native-shims");` | Path use; review for workspace-root confinement |
| `src/ipc/utils/test_screenshot.ts:4` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/ipc/utils/test_screenshot.ts:63` | `path.join(getUserDataPath(), E2E_TEST_ARTIFACT_DIR),` | User data path; isolate per runtime workspace |
| `src/ipc/services/claude_code/model.ts:38` | `import { getUserDataPath } from "@/paths/paths";` | User data path; isolate per runtime workspace |
| `src/ipc/services/claude_code/model.ts:200` | `getUserDataPath(),` | User data path; isolate per runtime workspace |

### Renderer/runtime localhost and preview references

| File and line | Match | Note |
|---|---|---|
| `src/app_run/testing.ts:93` | `appUrl: "http://localhost:3210",` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/app_run/testing.ts:94` | `originalUrl: "http://localhost:5173",` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/prompts/system_prompt.ts:441` | `- If you sign in programmatically with \`page.request.*\` against the app's own auth endpoint, remember that \`page.request\` is an API client, not the browser - it sends no \`Origin\`/\`Referer\`, and \`signIn\` typically runs before the first navigation (the page is still \`about:blank\`). Auth servers with a CSRF / trusted-origin check (e.g. Better Auth) answer that with a 403. Pass the app's own origin explicitly: \`const origin = new URL(process.env.DYAD_TEST_BASE_URL \\|\\| "http://localhost:32100").origin;\` then send \`headers: { origin, referer: origin + "/" }\`. A 403 from a sign-in endpoint is almost always this, not bad credentials - fix the test, not the app.`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:38` | `previewUrl: string \\| null;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:135` | `previewUrl: null,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:160` | `const previewUrl = URL.createObjectURL(file);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:163` | `previewUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:174` | `previewUrl: null,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:176` | `URL.revokeObjectURL(previewUrl);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:183` | `URL.revokeObjectURL(previewUrl);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:190` | `setAvatar({ url: null, uploading: false, error: null, previewUrl: null });` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/__tests__/evals/fixtures/UserProfileFull.tsx:194` | `avatar.previewUrl ?? avatar.url ?? "/default-avatar.png";` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/lib/test_recorder/fixture_templates.ts:53` | ``    process.env.DYAD_TEST_BASE_URL \\|\\| "http://localhost:32100",`,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/types/mcp.ts:8` | `// `http://localhost:<this-port>/callback` into the redirect-URI field;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/two_window_harness.ts:127` | `url: "http://localhost:5173/chat",` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/renderer_ipc_bridge.ts:142` | `devServerUrl: "http://localhost:5173",` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/renderer_ipc_bridge.ts:244` | `const frame = { url: "http://localhost:5173/" };` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/hybrid_chat_harness.tsx:1549` | `/HTTP MCP server running on http:\/\/localhost:(\d+)\/mcp/,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/hybrid_chat_harness.tsx:1577` | `const url = `http://localhost:${port}/mcp`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/types/app.ts:204` | `previewUrl: z.string(),` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/headless_proxy_server.ts:13` | `* `runningApps.get(appId).proxyUrl` stays undefined, and every` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/headless_proxy_server.ts:19` | `* downstream (proxyUrl, `[dyad-proxy-server]started=[.]`, the app-run actor's` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/headless_proxy_server.ts:73` | `onStarted?: (proxyUrl: string) => void;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/headless_app_preview.ts:158` | `return { ok: true, url: runningApps.get(appId)?.proxyUrl, port };` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/headless_app_preview.ts:175` | `return Boolean(info?.proxyUrl);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/headless_app_preview.ts:180` | `return runningApps.get(appId)?.proxyUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/shared/remote_mcp_catalog.ts:21` | `return `http://localhost:${process.env.FAKE_LLM_PORT}/api/mcp-catalog`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/shared/remote_language_model_catalog.ts:40` | `return `http://localhost:${process.env.FAKE_LLM_PORT}/api/language-model-catalog`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/electron_mock.ts:64` | `const frame = { url: "http://localhost:5173/" };` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/chat_flow_harness.ts:304` | `devServerUrl: "http://localhost:5173",` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/testing/chat_flow_harness.ts:531` | `runningApps.get(appId)?.proxyUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/vercel_utils.ts:15` | `const TEST_SERVER_BASE = `http://localhost:${process.env.FAKE_LLM_PORT \\|\\| "3500"}`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/start_proxy_server.ts:19` | `onStarted?: (proxyUrl: string) => void;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/provider_api_key_validation_service.ts:173` | `return `http://localhost:${process.env.FAKE_LLM_PORT}/google/v1beta`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/provider_api_key_validation_service.ts:180` | `return `http://localhost:${process.env.FAKE_LLM_PORT}/openrouter/v1`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/isolated_test_db.ts:414` | `if (!info?.proxyUrl)` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/isolated_test_db.ts:419` | `const previewUrl = new URL(info.proxyUrl);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/isolated_test_db.ts:424` | `if (previewUrl.hostname === "localhost") {` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/isolated_test_db.ts:430` | `origin: previewUrl.origin,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/isolated_test_db.ts:442` | `origin: previewUrl.origin,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/isolated_test_db.ts:1008` | `* returned a successful response. We still require `proxyUrl` before returning` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/isolated_test_db.ts:1041` | `const baseUrl = appInfo.proxyUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/process_manager.ts:42` | `proxyUrl?: string;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/playwright_bootstrap.ts:537` | `baseURL: process.env.${TEST_BASE_URL_ENV} \\|\\| "http://localhost:32100",` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/playwright_bootstrap.ts:1523` | `* other: a `//` inside a string (the template's own `"http://localhost:32100"`)` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/playwright_bootstrap.ts:1643` | `const baseUrlLine = `    baseURL: process.env.${TEST_BASE_URL_ENV} \\|\\| "http://localhost:32100",`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/ollama_provider.ts:10` | `* Base URL for the Ollama API. For real Ollama, use e.g. http://localhost:11434/api` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/ollama_provider.ts:12` | `* If undefined, defaults to http://localhost:11434/api` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/ollama_provider.ts:30` | `options?.baseURL ?? "http://localhost:11434",` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/codex_subscription_auth.ts:25` | `const REDIRECT = "http://localhost:1455/auth/callback";` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/codex_subscription_auth.ts:356` | `redirect = `http://localhost:${address.port}/auth/callback`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/cloudflare_deploy/api.ts:15` | `? `http://localhost:${process.env.FAKE_LLM_PORT \\|\\| "3500"}/cloudflare/api`` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/client_logic/template_hook.ts:56` | `value: `http://localhost:${getAppPort(appId)}`,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/mcp_oauth_provider.ts:282` | `return `http://localhost:${this.callbackPort}/callback`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/mcp_oauth_flow.ts:191` | `const url = new URL(req.url, `http://localhost:${request.port}`);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/mcp_oauth_flow.ts:278` | ``OAuth callback listener bind settled on http://localhost:${request.port} (${boundHosts.length} stack${boundHosts.length === 1 ? "" : "s"})`,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/lm_studio_utils.ts:2` | `return process.env.LM_STUDIO_BASE_URL_FOR_TESTING \\|\\| "http://localhost:1234";` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:475` | `proxyUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:483` | `proxyUrl: string;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:491` | `message: `[dyad-proxy-server]started=[${proxyUrl}] original=[${originalUrl}] mode=[${mode}]`,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:517` | `(appInfo.proxyUrl` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:518` | `? new URL(appInfo.proxyUrl).hostname === "localhost"` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:545` | `if (!appInfo.proxyUrl) return;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:547` | `await registerPreviewOrigin(appId, appInfo, appInfo.proxyUrl, target, output);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:559` | `proxyUrl: appInfo.proxyUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:570` | `proxyUrl: string,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:579` | `new URL(proxyUrl).hostname !== getAppPreviewHostname(appId)` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:583` | `const origin = new URL(proxyUrl).origin;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:675` | `if (output && appInfo.proxyUrl === proxyUrl && appInfo.originalUrl) {` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:679` | `proxyUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:727` | `appInfo.proxyUrl &&` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:728` | `new URL(appInfo.proxyUrl).hostname === hostname &&` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:747` | `appInfo.proxyUrl &&` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:748` | `new URL(appInfo.proxyUrl).hostname === hostname &&` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:758` | `proxyUrl: appInfo.proxyUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:780` | `appInfo.proxyUrl = undefined;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:813` | `const proxyUrl = await readyUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:815` | `appInfo.proxyUrl = proxyUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:816` | `await registerPreviewOrigin(appId, appInfo, proxyUrl, undefined, output);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:821` | `proxyUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:845` | `appInfo.proxyUrl = undefined;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1158` | `const urlMatch = message.match(/(https?:\/\/localhost:\d+\/?)/);` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1572` | `let previewUrl: string \\| undefined;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1583` | `previewUrl = createResult.previewUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1592` | `previewUrl = uploadResult.previewUrl ?? previewUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1608` | `const resolvedPreviewUrl = previewUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1856` | `previewUrl: string;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1969` | `if (existing.proxyUrl && existing.originalUrl) {` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1973` | `existing.proxyUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:1985` | `proxyUrl: existing.proxyUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:2328` | `input.appInfo.cloudPreviewUrl = result.previewUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:2335` | `input.appInfo.proxyUrl &&` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:2336` | `input.appInfo.originalUrl === result.previewUrl &&` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:2342` | `input.appInfo.proxyUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:2348` | `originalUrl: result.previewUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/services/app_runtime_service.ts:2418` | `if (appInfo.proxyUrl) {` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/components/HelpDialog.tsx:55` | `* VITE_IMAGE_UPLOAD_SERVICE_ORIGIN=http://localhost:8080` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/components/plugins/PluginSetupSection.tsx:142` | `http://localhost:{callbackPort ?? "."}/callback` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/components/plugins/AddPluginDialog.tsx:278` | `placeholder="http://localhost:3000"` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/components/plugins/AddPluginDialog.tsx:356` | `http://localhost:` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/cloud_sandbox_provider.ts:41` | `previewUrl: z.string().trim().min(1),` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/cloud_sandbox_provider.ts:46` | `previewUrl: z.string().trim().min(1).optional(),` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/cloud_sandbox_provider.ts:51` | `previewUrl: z.string().trim().min(1),` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/cloud_sandbox_provider.ts:62` | `previewUrl: z.string().trim().min(1),` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/cloud_sandbox_provider.ts:195` | `previewUrl: string;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/cloud_sandbox_provider.ts:204` | `): Promise<{ previewUrl?: string; previewAuthToken?: string }>;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/utils/cloud_sandbox_provider.ts:207` | `): Promise<{ previewUrl: string; previewAuthToken: string }>;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/app_handlers.ts:1366` | `appInfo.cloudPreviewUrl !== status.previewUrl \\|\\|` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/app_handlers.ts:1368` | `appInfo.cloudPreviewUrl = status.previewUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/app_handlers.ts:1377` | `originalUrl: status.previewUrl,` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/app_handlers.ts:1382` | `appInfo.originalUrl = status.previewUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/github_handlers.ts:81` | `return `http://localhost:${process.env.FAKE_LLM_PORT \\|\\| "3500"}`;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/local_model_ollama_handler.ts:11` | `return "http://localhost:11434";` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/mcp_error_classifiers.ts:66` | `//   `ECONNREFUSED localhost:4012` don't match. Catches the SDK's` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/recording_handlers.ts:143` | `if (!runningApps.get(appId)?.proxyUrl) {` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/recording_handlers.ts:346` | `const proxyUrl = runningApp?.proxyUrl;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/recording_handlers.ts:347` | `if (!proxyUrl) {` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/recording_handlers.ts:373` | `const origin = new URL(proxyUrl).origin;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |
| `src/ipc/handlers/tests_handlers.ts:352` | `return runningApps.get(appId)?.proxyUrl ?? null;` | Distinguish preview URLs from OAuth, local provider, test, and user-entered URLs before rewriting |

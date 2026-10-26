# Experiment 2 baseline

Captured 2026-10-17 (UTC), before Experiment 2 implementation changes.

## Scope and repository state

- Repository: Seltra-branded Dyad (`seltra.co@1.19.0`), branch `main`, HEAD `66c30c5`.
- OS: Windows PowerShell. Node.js `v24.20.0`; package manager is npm (use `npm.cmd` because PowerShell blocks `npm.ps1`).
- The embedded `E-commerce-Runtime-Builder/E-commerce-Runtime-Builder` is a separate reference project. Its runtime, agents, API, database, sandbox, and browser worker are not part of the implementation target. This experiment uses only the existing Dyad runtime and its extension seams.
- Initial working tree already contained deletions of `CODEX_FIX_M1.md` through `CODEX_FIX_M5.md`, `CODEX_TASK_M1.md`, and `IMPLEMENTATION.md`, plus untracked `E-commerce-Runtime-Builder/` and `SELTRA-V5-EXPERIMENT-2-LAB.md`. These predate implementation and are preserved.

## Baseline commands

| Purpose                          | Command                                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type check                       | `npm.cmd run ts`                                                                           | Pass. Main and both worker type checks completed with exit code 0.                                                                                                                                                                                                                                                                                                                     |
| Web focused tests                | `npm.cmd run web:test` (sandbox), then the same command with approval outside the sandbox  | Sandbox attempt blocked because esbuild could not read an ancestor directory. Approved retry built `server/dist/main.mjs`, then failed because the server dependency `jose` is absent (`ERR_MODULE_NOT_FOUND`).                                                                                                                                                                        |
| Web build                        | `npm.cmd run web:build` (sandbox), then the same command with approval outside the sandbox | Sandbox attempt blocked because esbuild could not read an ancestor directory. Approved retry built Dyad's existing runtime bundle and gateway, passed their type checks, then Vite transformed 2,917 modules and failed because Rollup could not resolve the local package `pg-schema-classifier` imported by `src/lib/sqlSchemaMutation.ts`. No separate/reference runtime was built. |
| Lint (non-mutating scoped check) | `node_modules/.bin/oxlint.cmd src server scripts/web`                                      | Fails on one error: unused `user` in `server/src/prisma_control_store.ts:9`. Five pre-existing warnings were also reported, including two in web bridge code.                                                                                                                                                                                                                          |
| Repository lint script           | Not run                                                                                    | `npm run lint` invokes `oxlint --fix`, which mutates files; a read-only baseline check was used instead. An exploratory root-wide `npm.cmd exec -- oxlint` was stopped after it began traversing the embedded reference's vendored `node_modules.windows`; no source edits were intended from that command.                                                                            |
| Start                            | Not run                                                                                    | Desktop `npm start` launches Electron. Web start requires local `.env.web` credentials/state; the runbook documents the setup. No start process or credentials were created for baseline capture.                                                                                                                                                                                      |

The repo's earlier `docs/web-port/BASELINE.md` captures a separate web-port milestone (2026-10-14) and its tests. It is historical context, not a substitute for this Experiment 2 baseline.

## Existing Dyad capabilities and seams

- Chat modes include Agent, Build, Ask, and Plan. Plan mode persists a plan; explicit Build and Plan overrides and the local-agent tool loop already exist. Keep the existing mode admission/resolution and chat actor lifecycle as the authority.
- The local agent has an iterative tool loop, bounded steps, durable todo/plan support, registered specialist subagents, writer coordination, cancellation, and review/repair tools. `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts`, `tool_definitions.ts`, `tools/subagent_tools.ts`, and `subagents/` are the coordination seams.
- Existing code generation/editing remains the Dyad response processor/local-agent tools. Existing package installation, runtime lifecycle, preview, file history, undo, and repair remain owned by Dyad.
- Search already exists via `web_search`, `web_fetch`, and `web_crawl` local-agent tools. Import and chat attachments already exist; images and PDFs have model/capability checks. Voice-to-text exists in `src/voice_to_text/` and `src/hooks/useVoiceToText.ts`.
- Preview supports runtime/iframe integration and preview test automation through the scoped CDP broker (`src/main/preview_cdp_broker.ts`); the web port uses the existing runtime bridge and preview proxy. The web-port runbook records ZIP/folder import as unavailable in web mode.
- Existing web models default to Cloudflare Workers AI through `AI_PROVIDER=cloudflare`, `AI_MODEL_DEFAULT=@cf/moonshotai/kimi-k2.7-code`, with optional reasoning/fast/vision/image aliases and API key/account configuration in `.env.web.example` and `server/src/config.ts`.
- Existing image attachments do not imply that a configured text model supports vision. Figma has an available MCP catalog integration path, not a dedicated native Figma importer.

## Reference-only review

Read the reference README, prompt and UI briefs, plus its `packages/agents/src` contracts and agent implementations. Reusable ideas include typed structured outputs, explicit dependency/task status, validation of planner coverage, a design artifact, evidence-bearing browser verification, research provenance, and a bounded critique/repair loop. The separate Next.js builder, Prisma commerce API, agent runtime, Cloudflare sandbox worker, and their deployment scripts are not to be copied or built.

## Known gaps for Experiment 2

- No Experiment 2 task/artifact contract or run-level evidence report is currently present in Dyad.
- Existing subagents coordinate coding/review work but do not provide a commerce-aware supervisor that automatically drafts a structured brief/design specification on ordinary prompts.
- Existing preview test automation can exercise a preview, but there is no general multi-route desktop/tablet/mobile evidence report tied to design criteria by default.
- No purpose-built commerce reasoning contract or Figma API import flow is present. Payment, inventory, and customer workflows must remain explicitly unconfigured unless the user configures and verifies integrations in the generated application.
- No Experiment 2 benchmark results or before/after screenshots have been captured yet.

## Baseline paths

- Dyad architecture and safety: `docs/architecture.md`, `docs/agent_architecture.md`, `docs/security.md`, `rules/chat-modes.md`, `rules/app-operation-coordination.md`, `rules/state-machines.md`, `rules/model-effort-and-catalog.md`, `rules/e2e-testing.md`, `rules/user-app-test-isolation.md`.
- Web host and prior acceptance: `docs/web-port/{INVENTORY,ACCEPTANCE,ALLOWED_SEAMS,BLOCKERS,PHASES-3-5,RUNBOOK,BASELINE}.md`.
- Existing agent: `src/pro/main/ipc/handlers/local_agent/`, including `subagents/`, plus `src/ipc/handlers/chat_stream_handlers.ts`.
- Existing browser/preview: `src/main/preview_cdp_broker.ts`, `src/components/preview_panel/`, `src/web/`.
- Existing research, import, voice, image: `src/pro/main/ipc/handlers/local_agent/tools/{web_search,web_fetch,web_crawl}.ts`, `src/ipc/handlers/import_handlers.ts`, `src/voice_to_text/`, and `src/ipc/utils/chat_attachment_utils.ts`.
- Read-only runtime reference: `E-commerce-Runtime-Builder/E-commerce-Runtime-Builder/packages/agents/src/`.

## Feature flags and rollback

Experiment-only orchestration/design/verification behavior must be opt-in and default off until its phase gate is met. It must fail closed to current Dyad behavior if its flag is absent, invalid, or disabled. Keep the stable path behind existing chat-mode selection and feature gates. Rollback consists of disabling the relevant Seltra flag and restarting the web gateway; no generated app data or source format migration is allowed. Target flags: `SELTRA_ORCHESTRATION_ENABLED=0`, `SELTRA_DESIGN_INTELLIGENCE_ENABLED=0`, `SELTRA_BROWSER_QA_ENABLED=0`, and `SELTRA_MULTIMODAL_INPUT_ENABLED=0`. All four flags are default-off in `.env.web.example` and passed through Dyad's existing web gateway/runtime environment. Existing Dyad attachment and voice features remain governed by their current settings and capabilities; the multimodal flag gates only Experiment 2's ZIP inventory and safe excerpt enrichment.

## Screenshots

No browser session was launched for this baseline, so there are no screenshots. The exact UI baseline can be captured after the local web gateway has been configured using `docs/web-port/RUNBOOK.md` and the Volta Gold prompts; no model credentials are present in the checked-in example.

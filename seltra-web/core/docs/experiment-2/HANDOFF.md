# Experiment 2 lab handoff

**Updated:** 2026-10-22  
**Purpose:** Resume the Experiment 2 work without repeating completed investigation or mistaking partial evidence for a phase pass.

## Mission and runtime boundary

The lab goal is to preserve Dyad's existing full-stack generation capability as Seltra's only application runtime, then strengthen it with coordination, design intelligence, commerce reasoning, multimodal input, browser verification, and research/asset intelligence.

`E-commerce-Runtime-Builder` is read-only reference material. Do not build, launch, restore, or depend on its runtime. Keep application source generation, edits, build/runtime lifecycle, preview, and repair in Dyad. The user stopped the prior build/test activity after raising an approval concern. This handoff does not authorize a build or app launch; check with the user before starting either. Focused tests have been run when needed for code changes.  `E-commerce-Runtime-Builder` has now been removed from the source as reference since the initial work has been completed.

## Overall state

**Experiment 2 is incomplete. No phase should be represented as fully green, and the production release gate is open.** Implementation and focused tests exist across all phases, but several acceptance requirements still require integrated/live evidence. The broad repository test gate also remains open due to a recorded run with environment-sensitive failures.

| Phase | Current status | Main outstanding gate |
| --- | --- | --- |
| 0. Baseline and boundaries | Baseline, flags, redacted logging, and flags-off rollback proof recorded; broad suite gate open | Triage the broad-suite failures and preserve the default Dyad path |
| 1. Supervisor and specialist coordination | Partial; host task-graph safeguards and selected integrations pass | Complete mode/override, routing, lifecycle, cancellation, and real conflict E2E matrix |
| 2. Design intelligence | Partial; typed artifacts, scorecard, and repair bounds exist | Host-attached critique, targeted repair/recheck, before/after evidence, and complete live-generation run |
| 3. Commerce intelligence | Partial; typed CommerceSpec and prompt/fixture coverage exist | Live commerce-aware routing and vertical workflow benchmarks; verify any production integrations before claiming them |
| 4. Browser verification | Objective direct preview checks passed; host-linked cycle remains incomplete | Complete an end-to-end `run_tests` Local Agent tool run, then critique, repair, and recheck from attached evidence |
| 5. Multimodal input | Partial; voice, attachments/ZIP, and Figma URL/API paths exist | Live browser/API acceptance, persist and verify `design_reference`, test supported image/document inputs, and complete multimodal benchmark |
| 6. Research and asset intelligence | Partial; bounded provenance and asset-plan guidance exist | Fact verification, prompt-injection behavior, external asset fallback/repair/recheck, and image-generation integration |
| 7. Evaluation and release gate | Not passed | Frozen multi-scenario benchmark, comparative scorecard, regression/hardening gates, and explicit final decision |

## Work completed and evidence by phase

### Phase 0 — baseline and boundaries

- Recorded the baseline and existing Dyad seams in [`BASELINE.md`](./BASELINE.md); reuse existing chat modes, tools, runtime, preview, import, voice, search, and repair.
- Added default-off Experiment 2 flags and opt-in redacted run events. The flags-off Dyad generation/preview/reload E2E passed.
- The 2026-10-20 full `npm.cmd test` run was not clean: 768 files passed, 99 failed, 6 skipped; 9,917 tests passed, 87 failed, 52 skipped, plus one runner error. Windows symlink permissions, timeouts, cleanup contention, and other failures were recorded but not individually isolated. Do not call the broad suite green.

### Phase 1 — supervisor and specialist coordination

- Added typed, versioned artifacts and host enforcement for task dependencies, legal transitions, completion evidence, two-attempt limits, and overlapping active writer scopes.
- Focused integrations cover automatic plan/build/evidence completion, optional specialist failure degradation, overlapping-writer-plan rejection, and writer ownership/cancellation. Basic Agent (5/5), Ask (3/3), Plan (7/7), and chat-mode (11/11) integration suites are recorded as passing.
- Still missing the broader manual mode/override matrix, business-aware routing across request types, durable lifecycle coverage, and complete live cancellation/concurrency/failure coverage. See [`AGENT-COORDINATION.md`](./AGENT-COORDINATION.md).

### Phase 2 — design intelligence

- Added typed `DesignSpec`, route requirements, evidence-linked eight-dimension visual critiques, score aggregation, exact screenshot linkage, and a maximum-three-iteration repair budget.
- Text-only EchoForm generations were repaired and objectively replayed across desktop, tablet, and mobile for responsive behavior, validation, rating interaction, and submission. The user rated the latest repaired screenshots **4/5** (“good, minor polish needed”); no specific blocking defect was identified.
- Still missing a completed live-generation E2E and the full host-authored VerificationReport → attached screenshots → valid structured critique → targeted repair → fresh screenshot recheck cycle. Preserve before/after evidence and route-level visual scores when completing it.

### Phase 3 — commerce intelligence

- Added commerce classification and CommerceSpec guidance to the existing Local Agent. It distinguishes relevant customer/merchant workflows, demo behavior, and unconfigured production integrations; general requests should not be routed through commerce reasoning unnecessarily.
- Focused prompt/chat-flow coverage includes a demo handmade-goods store, optional specialist failure, non-commerce classification, and evidence that unconfigured payments/inventory are not represented as live.
- Still missing a real commerce-aware generation/routing run and vertical workflow benchmarks (for example storefront, food ordering/booking, and merchant operations). No live payment, inventory, tax, or shipping integration has been verified.

### Phase 4 — browser verification and repair

- The host collector validates and saves screenshots, associates them with routes/viewports, and records objective findings for readiness, content, overflow, images, fonts, console errors, uncaught errors, and failed requests. It keeps clean objective coverage at `needs_review` pending visual approval.
- Focused Phase 4 suites passed **147 tests across 4 files** plus the root's **55 Node checks**. A deterministic Dyad preview replay passed `/` at 1440×900, 768×1024, and 390×844, form validation, keyboard rating navigation, and valid submission. Screenshots/report are under [`evidence/phase4-echoform-2026-10-22/`](./evidence/phase4-echoform-2026-10-22/). The user's visual rating for the same repaired EchoForm is 4/5.
- A subsequent live `run_tests` attempt through Local Agent did not finish cleanly. It exposed a 2-minute isolated-server readiness timeout while pnpm linked 379 packages. The readiness timeout was changed to 5 minutes, but the host-tool run has not been verified after that change. The subsequent sanitized attempt wrote evidence but did not exit cleanly, so do not count it as a passing E2E.
- A production `npm run build` was started after the readiness-timeout source change to prepare for E2E validation. Its completion was not confirmed in the session. Do not infer that build or the E2E passed; ask the user before restarting build/test activity.

### Phase 5 — multimodal input

- Existing work includes browser speech recognition with editable transcript controls, the established desktop voice path, existing attachment/media handling, bounded non-extracting ZIP summaries, and a Figma URL/API importer with safe URL validation, response limits, and bounded retry handling.
- The current Figma prompt serialization carries normalized source URL, retrieval time, bounded page/node summaries, tokens, components, asset metadata, and limitations. It instructs the opt-in orchestrated agent to save a versioned `design_reference` and avoid fetching the same file again. This handoff is prompt guidance, not a verified live artifact write.
- Focused Figma import/reference tests passed **14/14** after the latest metadata change. The voice/UI tests and ZIP safety tests are recorded elsewhere in `RESULTS.md`.
- Still missing browser acceptance for microphone permission-denied, cancellation, empty/editable transcript and successful submission; private/unauthorized/rate-limited/successful Figma interaction cases; a live saved `design_reference`; image-byte import; and the multimodal benchmark. Do not transmit or reproduce Figma credentials in artifacts/logs.

### Phase 6 — web research and asset intelligence

- Existing Dyad `web_search`, `web_fetch`, and `web_crawl` remain the search path. Writable orchestrated turns capture bounded URL/title/time and excerpts into a low-confidence `ResearchArtifact`; excerpts remain unverified and are treated as untrusted input.
- `ContentAssetPlan` schema and prompt guidance exist. The prompt asks for needed assets, aspect ratio, placement, provenance, fallback, and detailed prompts; image generation and app edits remain serialized through Dyad.
- Prompt/research suites passed **56/56**, including a hostile page-text case retained only as an unverified source statement. Together with Figma tests, the latest Phase 5–6 focused run passed **70 tests across 4 suites**, plus **55 root Node checks**. Scoped formatting and lint passed.
- Still missing independent fact review/corroboration, an end-to-end instruction-injection behavior test, automated broken external asset fallback/repair plus browser recheck, and evidence that Cloudflare image generation works through Dyad's separate `generate_image` `/images/generations` endpoint. The `AI_MODEL_IMAGE` chat alias alone does not establish that endpoint's support.

### Phase 7 — evaluation and release gate

- One Cloudflare-backed generated portfolio has route/viewport evidence (15 route/viewport combinations) and a user-provided overall 5/5 visual rating for that older screenshot set. A later EchoForm set has a user-provided 4/5 rating. Usage data for one run was independently reconciled.
- Still missing the frozen benchmark set and scorecards: counter regression, AmyBeats, storefront, food/booking, merchant/POS, general non-commerce app, multimodal input, and deliberate defect repair. Compare default Dyad baseline, each opt-in feature independently, and integrated flow. Record time, turns, tools, build/test and repair attempts, route coverage, human intervention, and usage where available. Finish all phase gates and make an explicit PASS/FAIL release decision; current decision is **INCOMPLETE**.

## Suggested resume sequence

1. Start with Phase 4's post-timeout host-tool verification because it can validate the Phase 2 screenshot/critique handoff as well. Confirm the user's desired test/build scope before rebuilding Dyad or launching any app. Do not build or launch the reference runtime.
2. Once the host evidence path is healthy, complete Phase 2's host-attached critique → targeted repair → recheck and save the before/after results.
3. Close Phase 1's missing lifecycle/mode/routing E2E items and run Phase 3 commerce workflows through Dyad.
4. Complete Phase 5's browser interactions and live `design_reference` persistence; then run the Phase 6 research/asset safety and fallback cases.
5. Freeze prompts/configuration and execute Phase 7 benchmarks. Update phase statuses only from evidence that satisfies the lab's stated gates.

## Key records and implementation paths

- Lab definition and requirements: [`../../SELTRA-V5-EXPERIMENT-2-LAB.md`](../../SELTRA-V5-EXPERIMENT-2-LAB.md)
- Detailed dated evidence/results: [`RESULTS.md`](./RESULTS.md)
- Coordination architecture and remaining orchestration coverage: [`AGENT-COORDINATION.md`](./AGENT-COORDINATION.md)
- Baseline and rollback boundaries: [`BASELINE.md`](./BASELINE.md)
- Phase 5: `src/web/figma_reference.ts`, `src/web/client/figma_import.ts`, `src/voice_to_text/`, `src/hooks/useVoiceToText.ts`, `src/ipc/utils/zip_attachment_summary.ts`, `src/ipc/handlers/chat_stream_handlers.ts`
- Phase 6: `src/pro/main/ipc/handlers/local_agent/tools/{web_search,web_fetch,web_crawl,research_provenance}.ts`, `src/ipc/services/experiment_research.ts`, `src/ipc/types/experiment_artifact.ts`, and `src/prompts/local_agent_prompt.ts`
- Phase 4 evidence: [`evidence/phase4-echoform-2026-10-22/`](./evidence/phase4-echoform-2026-10-22/) and host run artifacts under `e2e-web/artifacts/`

The working tree contained many pre-existing modified and untracked files during this work. Do not clean, reset, or overwrite unrelated user changes while resuming.

# Experiment 2 design benchmark

## Frozen prompt set

The prompts below are benchmark identifiers. Keep their exact source text unchanged once a run starts; add a new version rather than silently editing a prompt.

| ID                      | Scenario                                                                                                                          | Source/status                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `counter-v1`            | Simple counter app                                                                                                                | Existing app-builder benchmark fixture; freeze exact prompt before running.                                                                                        |
| `amybeats-v1`           | Amysbeats makeup-service portfolio and appointment request site                                                                   | Reference scenario in `E-commerce-Runtime-Builder/E-commerce-Runtime-Builder/prompts.md`; preserve as a prompt source, but verify it contains no real credentials. |
| `fashion-v1`            | Fashion catalog, variants, filters, product details, demo cart                                                                    | To be authored and frozen before evaluation.                                                                                                                       |
| `restaurant-v1`         | Restaurant menu and pickup/delivery request flow                                                                                  | To be authored and frozen before evaluation.                                                                                                                       |
| `merchant-dashboard-v1` | Merchant operations dashboard or POS workflow                                                                                     | To be authored and frozen before evaluation.                                                                                                                       |
| `calendar-v1`           | General non-commerce calendar/dashboard                                                                                           | To be authored and frozen before evaluation.                                                                                                                       |
| `multimodal-v1`         | User-supplied image or reference-file task                                                                                        | Run only when an actual compatible input/model path is available.                                                                                                  |
| `defect-repair-v1`      | Introduced visual/functional defect and evidence-based repair                                                                     | Run only in an isolated disposable generated app.                                                                                                                  |
| `figma-portfolio-v1`    | William's portfolio using the authorized Parwar's Portfolio 2 design reference; exact prompt hash is recorded in the run evidence | Live Cloudflare/Dyad run on 2026-10-19; responsive gate passed and gateway usage reconciled, visual score pending.                                                 |

## Run protocol

1. Capture the existing Dyad baseline with the same frozen prompt, selected model/provider, app framework, settings, and viewport set as the feature run.
2. Record prompt hash, app/chat IDs, model ID, feature flags, elapsed time, tool/model calls when available, build/test outcomes, interventions, and evidence paths. Never record provider credentials, attachment bytes, or sensitive customer data.
3. Inspect every required route at desktop `1440x900`, tablet `768x1024`, and mobile `390x844` where the selected host supports those viewports. Store screenshots under an ignored/local evidence directory; do not commit user files.
4. Exercise the task's named workflows. A homepage screenshot alone is not a functional pass.
5. Score from 0 to 100: functional correctness (20), visual quality (25), design coherence (15), requirements/commerce coverage (15), responsive/accessibility quality (10), code/assets (5), verified repair (5), speed/intervention (5).
6. Record unsupported checks as unavailable/blocked. Missing screenshots or routes are never scored as a pass. Human review is required for visual quality.

## Results table

One live Figma-informed generation has objective responsive evidence and an overall human visual rating. The partial run is not scored as a full Experiment 2 evaluation because rubric-level route scoring, functionality outside the tested contact path, and the repair/recheck gate remain incomplete.

| Prompt ID            | Variant                              | Model                            | Functional /20 |                                                         Visual /25 | Coherence /15 | Coverage /15 |          Responsive /10 | Code /5 | Repair /5 | Speed /5 |      Total | Evidence                          |
| -------------------- | ------------------------------------ | -------------------------------- | -------------: | -----------------------------------------------------------------: | ------------: | -----------: | ----------------------: | ------: | --------: | -------: | ---------: | --------------------------------- |
| `figma-portfolio-v1` | Dyad web / Figma import / Cloudflare | See `cloudflare-generation.json` |        Pending | Pending (user visual review: 5/5 overall for saved screenshot set) |       Pending |      Pending | Objective checks passed | Pending |   Not run |  Pending | Not scored | `evidence/cloudflare-2026-10-19/` |

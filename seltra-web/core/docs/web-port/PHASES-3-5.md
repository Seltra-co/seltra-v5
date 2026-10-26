# Phases 3–5 progress

Updated 2026-10-14 (UTC). This is implementation progress, not a declaration
that the phase gates passed.

## Local verification

- `npm.cmd run ts`: passed after adding the Phase 3–5 source.
- Focused Vitest run: 12 tests passed across workspace path containment,
  circuit-breaker transitions, verification ordering, classification, and
  bounded repair behavior. The test runner's separate Node stage passed 55/55.
- `oxlint` passed for the changed TypeScript files; `oxfmt` was applied to the
  changed TypeScript and Prisma/JSON files.
- The full `npm test` suite and desktop `npm start` were not rerun. The recorded
  Phase 0 full-suite result is the comparison baseline; see `BASELINE.md`.
- No Docker build or container isolation test was possible because Docker and
  an orchestrator configuration are not part of this workspace.

## Phase 3: workspace runtime sandbox

- Added `runtime/Dockerfile`: Node 24, pnpm, Git, ripgrep, Chromium, non-root
  runtime user, and persistent `/workspace` volume.
- Added `runtime/README.md` with required orchestrator policy for capabilities,
  read-only root, resource limits, egress, secrets, and disk quotas.
- Added `resolveWorkspaceProjectPath` with traversal and realpath/symlink
  containment checks, plus tests for relative traversal, absolute escape, and
  symlink escape.
- Not complete: no container lifecycle manager, preview reverse proxy, signed
  preview tokens, or egress/quota policy is enforceable from this repository
  without a deployment orchestrator. The Gate 3 two-workspace isolation test is
  pending that infrastructure.

## Phase 4: control plane and resilience

- Added the requested Prisma schema for users, workspaces, usage, repairs, and
  publications.
- Added an in-memory circuit breaker with closed/open/half-open transitions,
  bounded probes, failure classes, and unit coverage through the root Vitest
  project.
- Not complete: PostgreSQL migrations/client wiring, authenticated gateway,
  OpenAI-compatible model proxy, usage ledger writes, token/request/time budgets,
  and provider integration tests require the missing gateway and credentials.

## Phase 5: verification and bounded repair

- Added a fixed-name command runner interface and deterministic install,
  typecheck, build, desktop/mobile browser verification sequence. Deployments
  must map the names to fixed executables and collect screenshots/console
  errors; arbitrary command strings are not accepted as a step name.
- Added failure normalization/fingerprinting, classification, bounded repair
  controller, attempt recording interface, and a focused prompt helper for
  contract violations such as `undefined.eyebrow`.
- Not complete: there is no runtime command adapter, Chromium browser adapter,
  model-backed repair implementation, persisted attempt writer, or Volta Gold
  injected-bug run. Gate 5 remains pending those integrations.

## Dependencies and gate order

Phase 2 Gate 2 is pending in `BASELINE.md`. In particular, this checkout has no
browser-facing gateway/session auth or ZIP upload. Phases 3–5 foundations can
be reviewed independently, but end-to-end phase gates depend on those seams and
an orchestrated container environment.

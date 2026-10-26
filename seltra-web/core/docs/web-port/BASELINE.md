# Phase 0 baseline

Date: 2026-10-14 (UTC)

## Repository state

- The working directory contains no `.git` directory. `git status --short` fails with `fatal: not a git repository`; commit boundaries and clean-checkout status cannot be verified in this environment.
- Node dependencies are present at the repository root. The fake LLM server's separate dependencies were initially absent, and root `better-sqlite3` was initially built for Node ABI 143 while the running Node requires ABI 137. The fake LLM package dependencies have since been installed and `better-sqlite3` rebuilt for ABI 137.

## Commands

| Command | Result |
|---|---|
| `npm.cmd run ts` | Passes after installing `testing/fake-llm-server/` dependencies, as prescribed by the repository guide. |
| `npm.cmd test` | Node test stage: 55 passed, 0 failed. Vitest failed: 35 files failed, 804 passed, 6 skipped (845 files); 54 tests failed, 10,043 passed, 54 skipped (10,151 tests total), plus 3 hook errors. Duration 2,840.95 seconds. |

The first Vitest run's failures included `better-sqlite3` ABI mismatch (ABI 143 binary vs ABI 137 runtime); that native dependency was rebuilt for the active Node 24 ABI before the final run. The final run's failures include slow hybrid UI/hook timeouts (including Supabase integration setup), Windows symlink/process cleanup limits, and external service requests. One obsolete security-review snapshot was reported. These are baseline observations, not evidence that failures were caused by the web-port work. The working directory has no `.git` metadata, although tests that create their own temporary repositories do run.

The first sandboxed Vitest startup was separately blocked by esbuild access to an ancestor directory. The final suite was rerun with approval outside the sandbox and completed, producing the counts above. `testing/fake-llm-server/` dependencies were installed before the final type check.

## Gate 0 status

Met for the Phase 0 comparison gate: required artifacts exist, TypeScript passes, and the full test result above is recorded as the baseline. The checkout has no Git metadata, so clean-checkout verification and the plan's one-task-per-commit rule are unavailable in this environment; see `DEVIATIONS.md`.

## Phase 1 verification so far

- `npm.cmd run ts`: passes after the Phase 1 shim, bootstrap, and RPC changes.
- Targeted RPC and shim suites: 7 tests pass; the preceding Node test stage reports 55 passed and 0 failed.
- `node scripts/build-runtime.mjs`: passes on Windows.
- `node scripts/web/smoke-rpc.mjs`: passes on Windows; app creation, fake LLM stream events, generated `file1.txt`, two Git commits, and a second app lookup were verified. The fake server source is `testing/fake-llm-server/index.ts`.
- The full root Vitest suite and desktop `npm start` were not rerun after Phase 1 edits. Linux smoke execution has not been performed. Gate 1 remains pending those cross-platform/desktop checks.

## Phase 2 verification so far

- `npm.cmd run ts`: passes after the browser bridge, capability checks, and preview rewriting changes.
- Targeted shim/RPC Vitest suites: 8 tests pass. The preceding Node test stage reports 55 passed and 0 failed.
- `npm.cmd run build:web`: passes after prepending the bridge import to the renderer entry; 4,295 modules transformed. The generated renderer bundle contains the connection-lost handling code. Vite reports existing large-chunk and Tailwind CSS minification warnings.
- Browser preview URL rewriting has a unit assertion for localhost preview fields and unchanged unrelated localhost URLs. It runs in the runtime RPC boundary because the planned gateway has not yet been implemented.
- Gate 2 remains pending: browser end-to-end Volta Gold run, browser auth/session gateway, and ZIP upload. Bridge injection is verified in the generated renderer bundle; reconnect has not been exercised in a browser session.

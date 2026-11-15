# Publish P2 - Disposable workspace lifecycle (implementation status)

Date: 2026-11-05

P2 is **partially implemented and not production-ready**. Core now has a Docker execution provider and rejects production host execution. This establishes an implementation boundary; it does not prove the deployed Render service has a usable Docker daemon, a correctly isolated network, or an external package-proxy firewall. Do not enable production workspaces until those deployment prerequisites and drills D16-D24 pass.

## Changes

- `seltra-web/core/server/src/execution_provider.ts`: host-only development provider and Docker provider; validates the configured image by immutable image ID and requires a Docker `Internal` network; applies non-root UID, read-only container root, capability drop, no-new-privileges, resource limits, workspace-only bind mount, and loopback-published runtime port.
- `seltra-web/core/server/src/workspace_supervisor.ts`: retains the existing agent runtime, delegates runtime start/stop to the provider, and uses the explicit `WORKSPACE_ROOT`.
- `seltra-web/core/server/src/config.ts` and `main.ts`: production defaults to Docker, checks provider readiness before serving, and refuses unsafe production host mode.
- `seltra-web/core/runtime/Dockerfile` and `README.md`: runtime image definition and operator requirements.
- `seltra-web/core/server/src/publish/snapshot.ts`: uses only `WORKSPACE_ROOT` (or a temp-directory default, never `DATA_ROOT`); restore consults the Neon durable journal even when local SQLite files exist, stages the restored workspace, and replaces local state only after source/data checks succeed.
- `seltra-web/core/src/seltra_publish/*test.ts`: focused tests for provider selection, environment filtering, save/restore and restore over stale local files.

## Verification

- `npm.cmd run ts:main` in `seltra-web/core`: PASS.
- `vitest run src/seltra_publish/durability.test.ts src/seltra_publish/execution_provider.test.ts src/web/publish_security.test.ts` in `seltra-web/core`: PASS, 17 tests.
- `npm.cmd test -- --runTestsByPath src/__tests__/publish.service.test.ts` in `seltra-web/backend`: PASS, 19 tests.
- `docker --version`: PASS. `docker info`: FAIL; Docker Desktop engine pipe is unavailable in this environment. No image/container/network integration was run.

## Open gates

- Render deployment configuration and its Docker daemon/network topology are not present in this checkout. The current Render build/start configuration does not build or launch the per-workspace Docker image.
- A `--internal` Docker network blocks direct egress, but host firewall rules restricting `host.docker.internal` to the Core RPC/model gateway and an approved package proxy are external prerequisites. They have not been configured or verified here.
- D22 cross-app filesystem isolation, secret non-access, network policy, resource limits, cleanup, and fresh-instance recovery have not been proven with real containers. A single workspace mount contains that workspace's app directories, so a stricter per-app filesystem boundary also remains to be demonstrated against the existing runtime's app-install/preview behavior.
- Restore locking across multiple Core instances, queueing/capacity reporting, shadow-mode comparison, and WORKSPACE_RESTORING/CAPACITY state transitions remain incomplete. Do not treat P2 as complete.
- No Neon migration was applied. No production flags or env files were changed. No real GitHub, R2, Render, or Vercel resources were modified.

## Commands and outcome

- Core typecheck: PASS.
- Core focused tests: PASS (17/17).
- Backend publish tests: PASS (19/19).
- Docker daemon check: FAIL because the local Docker engine is not running/available.
- Render integration and destructive recovery drills: NOT RUN; deployment and disposable test infrastructure are unavailable in this workspace.

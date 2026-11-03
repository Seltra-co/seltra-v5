# Workspace runtime image

Build the image only after `node scripts/build-runtime.mjs` has produced
`dist/runtime/runtime_main.js`. The image installs the Playwright Chromium
bundle, including headless shell, at `/ms-playwright`. Runtime startup launches
Chromium and captures a PNG. Set `REQUIRE_PLAYWRIGHT=1` to make startup fail
when the browser or its required system libraries are unavailable. The
container expects its persistent volume at `/workspace`; mount it read-write
and keep the container root filesystem read-only.

## Native Render deployment

Render's native Node build does not run as root, so do not use Playwright's
`--with-deps` there. The `render:build` script installs only Chromium's
headless shell with `PLAYWRIGHT_BROWSERS_PATH=0`, which keeps it under
`node_modules` and available in both build and runtime. Set the Render
environment variable `PLAYWRIGHT_BROWSERS_PATH=0` as well; runtime defaults it
for web mode when unset. `--with-deps` is reserved for the Docker image, where
the image build can install operating-system packages.

Do not install the browser on Render's persistent disk. Keep that disk for
`DYAD_USER_DATA` and `DYAD_APPS_DIR`; the browser is part of the deploy artifact.
Set `REQUIRE_PLAYWRIGHT=1` on Render after confirming Chromium works in the
deployed environment.

The image deliberately does not configure a Docker socket, capabilities,
network policy, CPU/memory/pid limits, or disk quota. Those are deployment
properties and must be supplied by the container orchestrator. Required policy:

- non-root UID/GID 10001; `cap_drop: [ALL]`; default seccomp; no privileged mode
- read-only root, with only `/workspace` and `/tmp` writable
- per-workspace CPU, memory, pid and volume quota
- deny metadata and private/link-local network ranges; allow only package
  registries and the model gateway (GitHub is a later publishing exception)
- no Docker socket or host mounts beyond that workspace's volume
- publish runtime RPC on loopback/private networking only and set a unique
  `RUNTIME_RPC_SECRET` and `RUNTIME_SECRETS_KEY` per workspace

Docker itself cannot enforce a portable disk quota for an ordinary bind mount.
Use a quota-capable volume driver or filesystem project quota. A runtime must
not be considered isolated until the deployment supplies and tests these rules.

# Workspace runtime image

Build the image only after `node scripts/build-runtime.mjs` has produced
`dist/runtime_main.js`. The container expects its persistent volume at
`/workspace`; mount it read-write and keep the container root filesystem
read-only.

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

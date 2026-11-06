# Ephemeral workspace runtime image

`server/src/execution_provider.ts` runs one container per workspace using this image. Build after the Core build produces `dist/runtime/runtime_main.js`:

```powershell
npm.cmd run build-runtime

docker build -f runtime/Dockerfile -t seltra-workspace-runtime:<immutable-build-id> .
docker image inspect seltra-workspace-runtime:<immutable-build-id> --format '{{.Id}}'
```

Set Core's `WORKSPACE_EXECUTION_MODE=docker`, `WORKSPACE_RUNTIME_IMAGE` to the built image reference, `WORKSPACE_DOCKER_NETWORK` to a pre-created Docker network whose `Internal` property is `true`, and `WORKSPACE_DOCKER_HOST_GATEWAY` to the gateway address reachable from that network. Production Core refuses the host-process provider and startup fails if Docker, the image or the internal network is unavailable.

Each runtime uses a private per-workspace bind mount at `/workspace`. The image root is read-only, the container runs as a non-root UID, drops all Linux capabilities, enables `no-new-privileges`, has memory/CPU/PID limits, and has no host source, secrets, sibling workspace or Docker socket mount. The only published port binds to host loopback. The container's network is internal to deny direct Internet egress.

This is not deployable safely until the worker host additionally applies host firewall rules that expose only the model/RPC gateway to this internal network and provides an allowlisted package-registry proxy for dependency installation. Package registry access must never enable arbitrary egress. The current Render service configuration is not represented in this repository and has not been verified to provide a Docker daemon, internal network, firewall controls or that proxy. Until that infrastructure exists and the D22 isolation tests pass, production workspace startup must remain disabled; do not choose host mode as a fallback.

Docker bind mounts need host/container UID compatibility. The provider runs with the Core process UID/GID where available; verify that the deployed worker can write its own workspace and no other tenant's workspace. Apply a quota-capable volume/filesystem project quota before production use; ordinary Docker bind mounts have no portable disk quota.

# Sandbox gateway smoke

Run the signed create, runtime RPC, app launch, preview, diagnostics, and cleanup smoke against the dev gateway from PowerShell:

```powershell
cd seltra-web/edge/sandbox-gateway
$env:SIGNING_SECRET = '<DEV_GATEWAY_SIGNING_SECRET>'; $env:SANDBOX_GATEWAY_URL = '<DEV_GATEWAY_URL>'; npm run smoke:dev
```

`SIGNING_SECRET` is the dev gateway signing secret. `SANDBOX_GATEWAY_URL` is the dev Worker base URL. The smoke output redacts secret values.

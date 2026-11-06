# Cloudflare sandbox gateway setup

## Deployment model

The platform repository is the monorepo containing `seltra-web`; its GitHub Actions secrets own Cloudflare deployment credentials. Merchant repositories under `Seltra-Cloud` remain private and must never receive gateway or deployment secrets.

Build and deploy the Worker/container from CI, not a developer machine. Current Cloudflare documentation supports deploying a Dockerfile-backed Container Worker with `wrangler deploy` in a build environment; Wrangler builds and pushes the image, so the Docker-compatible engine is needed on that CI runner, not locally. Cloudflare Workers Builds can also build container images, and a prebuilt registry image can avoid Docker during deploy, but the requested protected manual production gate is clearest in the platform repository's GitHub Actions workflow. The Worker and container deployment are not transactional: the Worker can activate before container provisioning finishes, so readiness must be confirmed with the gateway self-test before Core uses it. [Cloudflare Deploy Containers](https://developers.cloudflare.com/containers/guides/deploy/), [Cloudflare CI/CD](https://developers.cloudflare.com/workers/ci-cd/)

Each workspace uses a separately keyed Durable Object/container instance. Cloudflare routes container requests through the Worker and runs the container in a Firecracker microVM. The instance filesystem is ephemeral; GitHub, Neon, and R2 remain the durable stores. [Container lifecycle and isolation](https://developers.cloudflare.com/containers/concepts/architecture/)

## One-time Willy checklist

Do this once in the platform GitHub repository and Render Core service:

1. In Cloudflare, create an account API token scoped to this account with **Workers Scripts: Admin** (the workflow creates the dev and prod Workers) and **Containers: Edit**. Do not add zone/DNS permissions; this workflow uses `workers.dev`. Do not reuse the Workers AI token. Cloudflare documents the separate Worker creation/deploy and Container permissions in its [Workers role guidance](https://developers.cloudflare.com/workers/authorization/) and [API token permission list](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).
2. In the platform repository's **Settings → Secrets and variables → Actions**, add these four repository secrets. Never add them to `Seltra-Cloud` merchant repos:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `SANDBOX_GATEWAY_SIGNING_SECRET_DEV`
   - `SANDBOX_GATEWAY_SIGNING_SECRET_PROD`
3. Generate the two signing values locally with `node seltra-web/core/scripts/generate-sandbox-gateway-secrets.mjs`. It writes the dev value into ignored `.env.web` and both values into ignored local secret files; it prints only names and safe `gh secret set` steps. Feed each generated file to `gh secret set` using the printed commands. Enter the Cloudflare token and account ID with the CLI's interactive secret prompts. Do not put secret values on a command line or echo them.
4. Configure GitHub Environment `production` with required reviewers and restrict deployment branches to `main`. The workflow's production job must use that environment and be manually selected.
5. After the dev workflow succeeds, set the deployed **dev gateway URL** and the dev signing value in ignored Core `.env.web` as `SANDBOX_GATEWAY_URL` and `SANDBOX_GATEWAY_SIGNING_SECRET`. Set `CORE_PUBLIC_URL` to a public HTTPS Core URL so Cloudflare runtimes can call Core's model API. Configure those three names on Render Core with the production gateway URL, production signing value, and Render Core URL. Core receives no Cloudflare deploy token or R2 credentials for gateway access.
6. Verify `/healthz` and the authenticated create/run/destroy self-test for the dev Worker before running the local browser test. Do not enable the local browser flow before this passes.

## GitHub CLI

Once `.github/workflows/deploy-sandbox-gateway.yml` exists and the four platform-repository secrets are configured, trigger the dev deployment from the platform repository root with:

```sh
gh workflow run deploy-sandbox-gateway.yml --ref main -f environment=dev
```

Production must be triggered manually with `environment=prod` from `main`; GitHub's protected `production` Environment approval is required.

## Credentials and fail-closed behavior

- Core requires `SANDBOX_GATEWAY_URL`, `SANDBOX_GATEWAY_SIGNING_SECRET`, and `CORE_PUBLIC_URL` for Cloudflare execution; startup validation reports missing variable names only.
- `MODEL_ACCOUNT_ID` and `R2_ACCOUNT_ID` refer to the same Cloudflare account. `MODEL_API_KEY` is a Workers AI token only.
- `CLOUDFLARE_API_TOKEN` exists only as the platform repository's Actions secret. `CLOUDFLARE_ACCOUNT_ID` is used only by deployment automation.
- Gateway requests use a timestamped HMAC signature. The Worker never returns the signing secret or accepts unsigned runtime/control calls.
- No Cloudflare Worker or container runs locally. If the dev gateway has not been deployed or its self-test fails, stop with `BLOCKED`; never select the host provider silently.

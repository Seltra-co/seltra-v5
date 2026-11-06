# Release checklist

Status reflects this checkout as of 2026-11-06. Production has not been touched.

1. **Dev self-test green — NOT RUN for the diagnostic fix.** Previous dev deployment's create/startup self-test failed after a 121.5-second timeout. New bootstrap, image smoke, and signed post-deploy checks must pass on `publish/p0-safety`.
2. **Willy's browser test passes — NOT RUN.** Require generated project build, preview load, second-project isolation, and cleanup evidence.
3. **Merge feature branch to main — NOT APPROVED / NOT DONE.** Review the production migration and auto-deploy safety gates first.
4. **Deploy prod gateway via manual dispatch (`environment=prod`, protected `production` approval) — NOT RUN.** The workflow requires a successful dev deploy/self-test of the same commit before this job can start.
5. **Set Render Core environment — NOT DONE.** Set production `SANDBOX_GATEWAY_URL`, production `SANDBOX_GATEWAY_SIGNING_SECRET`, Render Core `CORE_PUBLIC_URL`, and `EXECUTION_PROVIDER=cloudflare`; redeploy Core.
6. **Verify production `/healthz` and authenticated self-test — NOT RUN.** This checklist does not authorize production changes.
7. **Consider feature flags — OFF.** Keep `NEXT_PUBLIC_FF_PUBLISH=false` and `PUBLISH_ENABLED=false` until production health and publish review are complete.
8. **Rollback plan — PREPARED, NOT DRILLED.** Use the previous Worker version via `wrangler rollback` in CI, redeploy the previous Render Core release, and disable feature flags. Do not merge or deploy production as part of the dev browser test.

Before production release, verify the GitHub `production` Environment requires reviewers and restricts deployment branches to `main`. Gateway and deploy secrets belong only to the platform repository's Actions secrets; merchant repositories under `Seltra-Cloud` must contain none.

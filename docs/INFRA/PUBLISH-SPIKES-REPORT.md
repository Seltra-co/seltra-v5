# Publish provider spikes

**Date:** 2026-11-06  
**Status:** BLOCKED / NOT RUN. No provider request was made and no disposable resource was created. These entries are not provider results.

## Safety and current local evidence

- Existing Core env file has non-empty GitHub App, Vercel, R2 credential, master-key and public API URL entries. Secret values were not read or printed.
- The current Core env file does not set `WORKSPACE_PERSISTENCE_ENABLED`, `WORKSPACE_RESTORE_ENABLED`, or `WORKSPACE_ROOT`. It has a generic R2 bucket entry; route/workspace bucket names are not explicit.
- Docker is installed, but availability of the Docker engine and the configured isolated network/image were not verified in this run.
- No request was sent to GitHub, Vercel, R2, Neon or Cloudflare. No repository, project, deployment, route, tenant, or slug was changed.
- Do not use the existing Backend `.env` for a drill until its database target has been verified as staging. Presence of database variables is not evidence of their target.

## S1-S6

| Spike | Result | Evidence / next action |
|---|---|---|
| S1: private-repo push deployment disabled by first-commit `vercel.json` | NOT RUN | Requires a newly created private scratch repo and Vercel project; neither was created. U1 remains open. |
| S2: SHA-pinned API deployment and returned SHA equality | NOT RUN | No disposable project/deployment was created. U2 remains open. |
| S3: GitHub organization connection, Hobby/Team mode and team scope | NOT RUN | Credential presence does not prove plan capability or connection. No Vercel/GitHub account request was made. U3 remains open. |
| S4: immutable URL protection and automation access | NOT RUN | No scratch deployment exists to inspect. U4 remains open. |
| S5: retention, build events/log endpoint, rate-limit headers | NOT RUN | No deployment was created or polled. U5, U11 and U12 remain open. |
| S6: reverse-proxy/client-IP behavior | NOT RUN | No Worker preview or disposable origin was exercised. U9 remains open. |

No failure or fallback architecture is inferred from an unrun spike. Private repositories remain mandatory; publishing remains disabled until the relevant gates are run against disposable resources.

## U1-U12

| Question | Status |
|---|---|
| U1 first-commit auto-deployment control | NOT RUN |
| U2 exact-SHA deployment behavior | NOT RUN |
| U3 GitHub org connection/team scope | NOT RUN |
| U4 immutable deployment protection | NOT RUN |
| U5 deployment retention | NOT RUN |
| U6 usage/billing API | NOT RUN |
| U7 build concurrency allowance | NOT RUN |
| U8 existing route/store/authorization predicates | NOT RUN against live data; local code review is recorded in the phase reports |
| U9 reverse proxy/client-IP behavior | NOT RUN |
| U10 Render shutdown window | NOT RUN |
| U11 build event/log endpoint | NOT RUN |
| U12 actual rate-limit headers and limit discrepancy | NOT RUN |

## Gate

`PUBLISH_ENABLED=false` is required until S1-S3 and S5 (or a written approved fallback decision) pass, and D16-D24 and the disposable publish/routing checks are complete. The current environment does not establish that private organization repositories can be deployed on Hobby. If the test proves Hobby cannot do so, use the private-capable Vercel Pro merchant-app team required by the spec; never make a source repository public or use a tarball deployment.

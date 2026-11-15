# P3B Report - Worker and safe activation

## 1. Files created or changed

- `seltra-web/edge/subdomain-router/worker.js` - validates R2 routes, preserves legacy fallback, proxies to Vercel, uses trusted Cloudflare client-IP forwarding, sanitizes response headers/cookies, and returns a generic upstream failure page.
- `seltra-web/edge/subdomain-router/worker.test.js` - fake R2/fetch coverage for routing, redirect/cookie/header behavior, body streaming, and failures.
- `seltra-web/edge/subdomain-router/README.md` - paste deployment, `ROUTES` binding, rollout gate, route contract, and V4 comparison instructions.
- `seltra-web/edge/subdomain-router/smoke-v4.mjs` - before/after V4 marker and response comparison utility.
- `seltra-web/core/server/src/publish/orchestrator.ts` - restores prior routes on activation failure and verifies route removal on unpublish.
- `seltra-web/frontend/app/store/[slug]/page.tsx` - avoids a self-redirect on the public slug hostname.

## 2. Commands run

- `node --test worker.test.js` in `seltra-web/edge/subdomain-router` - PASS, 8 tests.
- `npm.cmd run ts:main` in `seltra-web/core` - PASS.
- `npx.cmd tsc --noEmit` in `seltra-web/frontend` - PASS.

## 3. Deviations and why

- No Cloudflare Worker was pasted, bound, preview-deployed, or attached to DNS. D0 route-format and U4/U9 questions remain unverified against live infrastructure.
- No V4 smoke comparison was run because no disposable URL/marker list was supplied.
- Incoming `x-forwarded-*`, client IP aliases, Vercel control headers, and Seltra control headers are discarded and rebuilt from trusted request data. The same filtering and response sanitation now apply to legacy fallback.
- Tests use Node's Fetch API with fakes; they do not substitute for Cloudflare runtime verification.

## 4. Open questions

- Confirm the current R2 route shape and slug ownership mapping against staging data.
- Resolve deployment protection and client-IP guidance in D0 U4/U9.
- Run disposable Cloudflare preview and V4 before/after checks before attaching production routes.

## 5. What could not be verified

- Cloudflare bindings, R2 consistency/cache behavior, wildcard DNS/SSL, live Vercel protection, deployed client-IP propagation, or live V4 compatibility.
- Deployed browser redirect behavior.

**Status: local Worker implementation and tests complete; live compatibility and activation gates remain closed.**

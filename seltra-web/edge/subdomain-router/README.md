# Seltra V5 subdomain router

`worker.js` routes published slugs to their verified Vercel deployment and sends all other eligible requests through the existing shared storefront path.

## Cloudflare paste deployment

1. Save a copy of the current Cloudflare routing configuration and complete `smoke-v4.mjs capture` for every production V4 store and the dashboard before changing routes.
2. In Cloudflare Workers & Pages, create or open the `seltra-subdomain-router` Worker and paste the contents of `worker.js` in the module editor.
3. Add an R2 bucket binding named `ROUTES`, mapped to the existing route bucket. The Worker only reads keys under `routes/`; it never writes route records.
4. Deploy the Worker to a preview URL and run the disposable-route checks against it. Then attach the production route `*.seltra.co/*` only after the before/after V4 smoke comparison passes.
5. Keep the legacy wildcard DNS record proxied. Confirm the Worker route is the one handling the wildcard requests and that the Worker can still reach `https://seltra-merchant.vercel.app`.
6. Publish activation is safe only after Core has populated a validated `routes/<slug>.json` record and the Worker returns its opaque `x-seltra-deployment` value. Rollback restores the previous R2 record; unpublish deletes only the current route record.

Route records are written by Core in this shape:

```json
{
  "slug": "shop",
  "tenantId": "tenant-id",
  "appId": "tenant-app-id",
  "origin": "shop-abc123.vercel.app",
  "deploymentId": "opaque-seltra-deployment-id",
  "vercelDeploymentId": "dpl_12345678",
  "sha": "40-or-64-character-git-sha",
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```

Do not paste a real deployment or connect production until P3A source/build/health checks and the P3B Worker test suite pass. Keep `PUBLISH_ENABLED=false` until the disposable end-to-end gate is approved.

## V4 smoke comparison

Create a UTF-8 text file with one row per URL: `https://host<TAB>regex-that-matches-a-stable-V4-page-marker`. Include every live V4 storefront and the dashboard host. The expression is JavaScript regex syntax and must match text in the returned HTML.

```powershell
node smoke-v4.mjs capture v4-urls.tsv before.json
# Deploy the Worker route and allow the route cache to expire.
node smoke-v4.mjs compare v4-urls.tsv before.json
```

The script reports the URL, HTTP status and whether the marker/redirect location changed. Do not put authorization headers or secrets in the URLs file.

# P3C Report - Dashboard

## 1. Files created or changed

- `seltra-web/frontend/components/dashboard/PublishPanel.tsx` - Backend status/history, Core SSE with polling fallback, resume on open/refresh, copy/open URL, rollback, confirmed unpublish, repair handoff, and capacity/retry state.
- `seltra-web/frontend/app/(dashboard)/dashboard/page.tsx` - new panel behind `NEXT_PUBLIC_FF_PUBLISH === 'true'`; flag-off keeps the previous Coming soon panel.
- `seltra-web/frontend/app/store/[slug]/page.tsx` - skips a self-redirect when the published URL is already the current public slug hostname.
- Panel refinements clear stale state when changing apps, support Escape to close, label failed actions as retries, and accurately describe automatic queue retry.

## 2. Commands run

- `npx.cmd tsc --noEmit` in `seltra-web/frontend` - PASS.
- `npm.cmd run build` in `seltra-web/frontend` - PASS with network access; 17 static pages generated.
- No browser/UI automation was run.

## 3. Deviations and why

- The feature remains off unless `NEXT_PUBLIC_FF_PUBLISH=true`; this is not a production enablement recommendation. Backend and Core kill switches remain authoritative.
- The first sandbox build could not fetch existing Google Fonts; the same build passed with network access. Font configuration was not changed.
- UI states have type/build coverage but no deployed authenticated SSE or browser session coverage.

## 4. Open questions

- Confirm dashboard runtime configuration for `NEXT_PUBLIC_CORE_URL`, `NEXT_PUBLIC_FF_PUBLISH`, and `NEXT_PUBLIC_ROOT_DOMAIN`.
- Perform browser checks for SSE reconnection, keyboard/focus behavior, rollback/unpublish controls, and flag-off visual equivalence.
- Keep the panel disabled until P3A provider gates pass.

## 5. What could not be verified

- Deployed production rendering, focus trapping/screen-reader behavior, authenticated SSE through the deployed proxy, or live Backend state transitions.
- No real tenant or deployment was used.

**Status: feature-gated implementation, static type-check, and production build complete; browser verification remains outstanding.**

Copilot's answers confirm the diagnosis and tell me exactly what to change.

**What they confirm**
- The token TTL is hard-coded to `5m` (`main.ts:441`), and the cookie is capped at `Max-Age=300` (`main.ts:581`). The session therefore dies at 5 minutes no matter what the cookie does, and the iframe has no refresh path (answer 5).
- The 401 is built before the proxy step, so it keeps `X-Frame-Options: SAMEORIGIN` (`main.ts:87/338`). That is the "refused to connect" screen.
- Everything else is fine: the cookie is `HttpOnly`, `Lax`, `Secure`, and the iframe sandbox includes `allow-same-origin`. The `app-16` and `commerce` hosts share `seltra.co`, so a `Lax` cookie is sent in the iframe.

**A second problem Copilot's answer exposed**
The runtime stores user data and apps in `/workspace`, and the code never references `/var/data`. Your Render disk is mounted at `/var/data` and shows about 0 GB used. That suggests your apps live on Render's ephemeral filesystem and will be wiped on every redeploy or restart, which would also kill previews. I've asked Copilot to confirm this in the prompt below.

**Paste this to Copilot (implementation prompt)**

```
Implement the following in dyad-main. Make minimal, focused changes and add/adjust tests.

GOAL: Preview iframe must not die after 5 minutes. Today the preview JWT TTL
(server/src/main.ts:441, "5m") and cookie Max-Age=300 (main.ts:581) expire the
session, every request then gets 401 PREVIEW_TOKEN_REQUIRED with
X-Frame-Options: SAMEORIGIN, and the iframe shows "refused to connect".

A) Server: long-lived sliding preview session (server/src/main.ts)
 1. Keep the short query-token JWT (purpose "preview") as a one-time hand-off,
    but make its TTL configurable via env PREVIEW_TOKEN_TTL (default "5m").
 2. When a valid query token is verified (the branch near line 581 that sets the
    cookie and 302-redirects), mint a NEW JWT with purpose "preview_session",
    same workspaceId and label, TTL from env PREVIEW_SESSION_TTL_SECONDS
    (default 28800 = 8h). Put THAT in the seltra_preview cookie with
    Max-Age = the same TTL. Keep Path=/; HttpOnly; SameSite=Lax; Secure (https).
    Still no Domain attribute (host-only).
 3. In validatePreviewAccess and the WebSocket upgrade check (~line 1409):
    - Verification order: try the query token; if it is missing OR EXPIRED/invalid,
      fall back to the cookie instead of failing. Only throw
      PREVIEW_TOKEN_REQUIRED if neither is valid.
    - Cookie may contain purpose "preview_session" (or legacy "preview").
      A "preview_session" token must NOT be accepted from the query string.
    - Still enforce workspaceId and label match for this host.
    - Sliding refresh: if a valid cookie session has less than half its TTL
      left, re-issue the cookie via Set-Cookie on the proxied response
      (for HTTP only; skip for WebSocket upgrades).
 4. 401 response for PREVIEW_TOKEN_REQUIRED:
    - Remove X-Frame-Options and set
      Content-Security-Policy: frame-ancestors 'self' <primary origin, e.g. https://commerce.seltra.co>
      (derive the origin from config, do not hard-code). Also Cache-Control: no-store.
    - If the request is a navigation (Accept includes text/html, or
      Sec-Fetch-Dest is iframe/document), return a tiny HTML page (status 401)
      with an inline script:
        parent.postMessage({type:"seltra:preview-auth-expired", label:"<label from host>"}, "<primary origin>")
      plus a short "Refreshing preview..." text. Otherwise keep the JSON body.

B) Client: auto-recover (src/components/preview_panel/PreviewIframe.tsx,
   src/preview_iframe/usePreviewIframe.ts)
 1. Add a window "message" listener. Accept only if event.origin equals the
    iframe's preview origin (new URL(appUrl).origin) AND
    event.data?.type === "seltra:preview-auth-expired".
 2. On receipt, obtain a freshly rewritten app URL with a new token the same way
    the existing flow does (the RPC/event path the gateway rewrites at
    main.ts:453/1307/1532, e.g. re-select/re-fetch the app URL for the current
    app), update the stored appUrl, and bump the iframe epoch so the iframe
    reloads. Show the existing loading state meanwhile.
 3. Guard against loops: max 3 recoveries per 60 seconds, then show the existing
    error UI with a Retry button.
 4. Also re-mint proactively every ~4 minutes ONLY if the app is the selected
    preview and the tab is visible (document.visibilityState === "visible"),
    using the same mechanism, WITHOUT reloading the iframe unless the URL's
    token changed in a way that requires it (prefer not to reload; the cookie
    session already keeps it alive). If this complicates things, skip B4 and
    report that you skipped it.

C) Confirm and report (no code change unless trivial):
 1. Which env var / function decides the base directory for userData and apps
    (src/paths/paths.ts, getUserDataPath / getDyadAppsBaseDirectory,
    DYAD_USER_DATA / DYAD_APPS_DIR)? What is the default in web mode? Is it
    /workspace? Our Render persistent disk is mounted at /var/data. Tell me the
    exact env values to set so apps and userData live under /var/data.
 2. When the gateway proxies to an app whose process is not running (runtime
    restarted/redeployed, idle collector stopped it), what response does the
    client get? Is the app auto-started on demand? If not, point to where an
    on-demand start could be hooked in.

Tests / acceptance:
 - Valid query token -> 302 + cookie with purpose preview_session and
   Max-Age ~= PREVIEW_SESSION_TTL_SECONDS.
 - Expired query token + valid cookie -> request succeeds (no 401).
 - No/invalid token and cookie -> 401, no X-Frame-Options, has frame-ancestors CSP;
   navigation gets HTML with the postMessage script, XHR/asset gets JSON.
 - preview_session token in the query string is rejected.
 - WebSocket upgrade works with a valid long-lived cookie after >5 minutes.
 - Existing tests still pass.
Then summarize every changed file with line ranges.
```
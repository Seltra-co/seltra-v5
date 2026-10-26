const PREVIEW_FIELDS = new Set([
  "proxyUrl",
  "previewUrl",
  "url",
  "appUrl",
  "originalUrl",
]);

/** Rewrite only engine-owned preview URL fields, preserving per-app origins. */
export function rewritePreviewUrls<T>(
  value: T,
  workspaceId = process.env.DYAD_WORKSPACE_ID,
  baseDomain = process.env.PREVIEW_BASE_DOMAIN,
  scheme = process.env.PREVIEW_PUBLIC_SCHEME ?? "https",
  port = process.env.PREVIEW_PUBLIC_PORT,
  tenantScoped = false,
): T {
  if (!workspaceId || !baseDomain || (scheme !== "http" && scheme !== "https")) return value;
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(workspaceId) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(baseDomain)
  ) return value;
  const visit = (item: unknown, field?: string, appId?: unknown): unknown => {
    if (typeof item === "string" && field && PREVIEW_FIELDS.has(field)) {
      try {
        const url = new URL(item);
        const match = url.hostname.match(/^app-(\d+)\.localhost$/i);
        if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || match)) {
          const id = match?.[1] ?? (Number.isSafeInteger(appId) ? appId : undefined);
          const label = id === undefined
            ? (tenantScoped ? `ws-${workspaceId}` : workspaceId)
            : tenantScoped ? `ws-${workspaceId}-app-${id}` : `app-${id}`;
          url.protocol = `${scheme}:`;
          url.hostname = `${label}.${baseDomain}`;
          url.port = scheme === "https" ? "" : (port ?? "");
          return url.toString();
        }
      } catch {
        // Leave malformed or unrelated URLs unchanged.
      }
      return item;
    }
    if (Array.isArray(item)) return item.map((entry) => visit(entry, undefined, appId));
    if (item && typeof item === "object") {
      const objectAppId = (item as { appId?: unknown }).appId ?? appId;
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry, key, objectAppId)]));
    }
    return item;
  };
  return visit(value) as T;
}

export type ViteHmrEnvironment = Record<string, string | undefined>

/** Public address used by generated Vite configs inside a web workspace. */
export function getPublicViteHmrEnvironment(env: ViteHmrEnvironment, appId: number) {
  if (env.DYAD_WEB_RUNTIME !== "1") return {}
  const workspaceKey = env.DYAD_WORKSPACE_ID?.trim()
  const baseDomain = env.PREVIEW_BASE_DOMAIN?.trim()
  const scheme = env.PREVIEW_PUBLIC_SCHEME === "https" ? "https" : "http"
  if (!workspaceKey || !baseDomain || !Number.isSafeInteger(appId) || appId <= 0) return {}
  const clientPort = Number(env.PREVIEW_PUBLIC_PORT) || (scheme === "https" ? 443 : 8080)
  return {
    VITE_HMR_HOST: `ws-${workspaceKey}-app-${appId}.${baseDomain}`,
    VITE_HMR_CLIENT_PORT: String(clientPort),
    VITE_HMR_PROTOCOL: scheme === "https" ? "wss" : "ws",
    VITE_HMR_PATH: "/",
  }
}

export type ViteHmrEnvironment = Record<string, string | undefined>

/** Public address used by generated Vite configs inside a web workspace. */
export function getPublicViteHmrEnvironment(env: ViteHmrEnvironment, appId: number) {
  // Preview HMR is intentionally disabled behind the sandbox gateway: the
  // public websocket path is not currently supported reliably and triggers the
  // noisy Vite WebSocket errors/fallback overlay seen in the preview. We keep
  // the wrapper logic resilient by treating missing HMR env as "off".
  void env;
  void appId;
  return {};
}

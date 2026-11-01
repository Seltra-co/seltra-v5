/** Forward only the Seltra Engine connection values needed by Core. */
export function getSeltraEngineEnv(config) {
  return {
    ...(config.SELTRA_ENGINE_URL?.trim()
      ? { SELTRA_ENGINE_URL: config.SELTRA_ENGINE_URL.trim() }
      : {}),
    ...(config.SELTRA_ENGINE_API_KEY?.trim()
      ? { SELTRA_ENGINE_API_KEY: config.SELTRA_ENGINE_API_KEY.trim() }
      : {}),
  }
}

export function formatSeltraEngineStartup(config) {
  let baseUrl = "<not configured>";
  if (config.SELTRA_ENGINE_URL?.trim()) {
    try {
      const parsed = new URL(config.SELTRA_ENGINE_URL.trim());
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      baseUrl = parsed.toString().replace(/\/$/, "");
    } catch {
      baseUrl = "<invalid URL>";
    }
  }
  return `Seltra Engine configured: ${baseUrl} (key present: ${Boolean(config.SELTRA_ENGINE_API_KEY?.trim()) ? "yes" : "no"})`;
}

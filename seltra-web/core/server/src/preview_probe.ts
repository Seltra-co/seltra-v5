export type BrowserPreviewProbe = { ready: boolean; status: number; redactedBodyPrefix?: string }

export async function probeBrowserPreview(url: string, fetchImpl: typeof fetch = fetch): Promise<BrowserPreviewProbe> {
  const response = await fetchImpl(url, {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(5_000),
  })
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return { ready: response.status === 200, status: response.status }
  }
  const redactedBodyPrefix = (await response.text().catch(() => "")).slice(0, 512)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/((?:token|secret|password|authorization|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
  return { ready: false, status: response.status, ...(redactedBodyPrefix ? { redactedBodyPrefix } : {}) }
}

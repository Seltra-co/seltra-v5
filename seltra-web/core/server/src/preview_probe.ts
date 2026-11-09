export type BrowserPreviewProbe = { ready: boolean; status: number; redactedBodyPrefix?: string }

export function browserPreviewProbeUrl(input: {
  label: string
  baseDomain: string
  scheme: "http" | "https"
  port?: number
  token: string
}): string {
  const url = new URL(`${input.scheme}://${input.label}.${input.baseDomain}/`)
  if (input.port !== undefined) url.port = String(input.port)
  url.searchParams.set("preview_token", input.token)
  return url.toString()
}

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

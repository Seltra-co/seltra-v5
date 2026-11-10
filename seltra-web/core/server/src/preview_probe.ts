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
  const initial = new URL(url)
  let current = initial
  let cookie: string | undefined
  let response: Response | undefined
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetchImpl(current, {
      redirect: "manual",
      headers: { accept: "text/html", ...(cookie ? { cookie } : {}) },
      signal: AbortSignal.timeout(5_000),
    })
    const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    const setCookie = setCookies?.[0] ?? response.headers.get("set-cookie")
    if (setCookie) cookie = setCookie.split(";", 1)[0]
    if (response.status < 300 || response.status >= 400) break
    const location = response.headers.get("location")
    if (!location) break
    const next = new URL(location, current)
    if (next.origin !== initial.origin) break
    await response.body?.cancel().catch(() => undefined)
    current = next
  }
  if (!response) return { ready: false, status: 0 }
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return { ready: response.status === 200, status: response.status }
  }
  const redactedBodyPrefix = (await response.text().catch(() => "")).slice(0, 512)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/((?:token|secret|password|authorization|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
  return { ready: false, status: response.status, ...(redactedBodyPrefix ? { redactedBodyPrefix } : {}) }
}

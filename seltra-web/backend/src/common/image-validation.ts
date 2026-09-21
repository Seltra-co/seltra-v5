//common/image-validation.ts
export interface ImageValidationResult {
  valid: boolean
  reason?: string
  contentType?: string
}

const TIMEOUT_MS = 8000

/**
 * Confirms a URL is reachable and actually serves image bytes before we ever
 * persist it. This is the check that was missing — a merchant (or an LLM)
 * pasting a dead/placeholder URL like example.com/foo.jpg used to go straight
 * into the DB and only fail later, deep inside next/image's optimizer.
 */
export async function validateImageUrl(url: string): Promise<ImageValidationResult> {
  if (!url) return { valid: false, reason: 'Empty URL' }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, reason: 'Not a valid URL' }
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, reason: 'URL must be http:// or https://' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // Some CDNs (e.g. certain S3 configs) reject HEAD — fall back to a
    // ranged GET so we don't download the whole file just to check it.
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    if (!res.ok || !res.headers.get('content-type')) {
      res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-2048' },
        signal: controller.signal,
      })
    }
    if (!res.ok) {
      return { valid: false, reason: `URL returned HTTP ${res.status}` }
    }
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { valid: false, reason: `URL did not return an image (got "${contentType || 'unknown'}")` }
    }
    return { valid: true, contentType }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { valid: false, reason: `Could not reach that URL (${message})` }
  } finally {
    clearTimeout(timer)
  }
}
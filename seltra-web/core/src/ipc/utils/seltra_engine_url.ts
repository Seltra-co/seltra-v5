let warnedLegacyUrl = false

export function getSeltraEngineBaseUrl(): string {
  const modelGatewayUrl = process.env.DYAD_WEB_RUNTIME === '1' ? process.env.MODEL_GATEWAY_URL?.trim() : undefined
  if (modelGatewayUrl) return modelGatewayUrl.replace(/\/$/, '')

  const seltraUrl = process.env.SELTRA_ENGINE_URL?.trim()
  if (seltraUrl) return seltraUrl.replace(/\/$/, '')

  const legacyUrl = process.env.DYAD_ENGINE_URL?.trim()
  if (legacyUrl) {
    if (!warnedLegacyUrl) {
      warnedLegacyUrl = true
      console.warn('[Seltra Engine] legacy engine settings in use; migrate to SELTRA_ENGINE_*')
    }
    return legacyUrl.replace(/\/$/, '')
  }

  throw new Error('Seltra Engine URL is not configured. Set SELTRA_ENGINE_URL to enable engine-backed features.')
}

export function isSeltraEngineUrlConfigured(): boolean {
  return Boolean(
    process.env.SELTRA_ENGINE_URL?.trim() ||
    (process.env.DYAD_WEB_RUNTIME === '1' && process.env.MODEL_GATEWAY_URL?.trim()) ||
    process.env.DYAD_ENGINE_URL?.trim(),
  )
}

export type PreviewOverlayEvent = {
  type: string
  message?: string
}

export type PreviewOverlayTransition =
  | { action: 'set'; reason: 'PREVIEW_FAILED' | 'UNCAUGHT_PAGE_ERROR' }
  | { action: 'clear' }

// Keep this noise list aligned with isIgnoredBrowserNoise in core/tools/repair_app.ts.
function isIgnoredPreviewNoise(message: string): boolean {
  return /\[vite\].*websocket|websocket.*handshake|failed to connect to websocket|\[dyad-screenshot\]|favicon\.ico.*(?:404|not found|failed)|ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/i.test(message)
}

export function previewOverlayTransition(event: PreviewOverlayEvent): PreviewOverlayTransition | null {
  if (event.type === 'preview.ready') return { action: 'clear' }
  if (event.type === 'preview.failed') return { action: 'set', reason: 'PREVIEW_FAILED' }
  if (['window-error', 'unhandled-rejection', 'iframe-sourcemapped-error'].includes(event.type)) {
    if (isIgnoredPreviewNoise(event.message ?? '')) return null
    return { action: 'set', reason: 'UNCAUGHT_PAGE_ERROR' }
  }
  // Console messages, including HMR/WebSocket failures, never own the overlay.
  return null
}

export function enqueueBrowserQaEvent<T>(buffer: T[], payload: T, limit = 50): boolean {
  const dropped = buffer.length >= limit
  if (dropped) buffer.shift()
  buffer.push(payload)
  return dropped
}

export function takePendingBrowserQaEvents<T>(buffer: T[], runId?: string): T[] {
  if (!runId) return []
  return buffer.splice(0)
}

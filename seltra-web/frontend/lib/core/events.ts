import type { CoreClient } from './client'

export class CoreEvents {
  private socket?: WebSocket
  private stopped = false
  private retry = 500
  private opening = false
  private timer?: number
  private stableTimer?: number
  private reconnectStartedAt = 0
  private reconnectFailureShown = false
  private lastEventId?: string
  private generation = 0
  private listenersAttached = false
  private readonly resumeOnFocus = () => {
    if (document.visibilityState === 'visible') this.retryNow()
  }

  constructor(
    private readonly client: CoreClient,
    private readonly onFrame: (frame: { channel: string; payload: unknown }) => void,
    private readonly onStatus: (connected: boolean) => void,
    private readonly onError: (message: string) => void = () => undefined,
    private readonly beforeConnect?: () => Promise<void>,
  ) {}

  connect() {
    this.stopped = false
    this.reconnectStartedAt ||= Date.now()
    if (!this.listenersAttached) {
      window.addEventListener('online', this.resumeOnFocus)
      window.addEventListener('focus', this.resumeOnFocus)
      document.addEventListener('visibilitychange', this.resumeOnFocus)
      this.listenersAttached = true
    }
    if (this.opening || this.socket?.readyState === WebSocket.CONNECTING || this.socket?.readyState === WebSocket.OPEN) return
    void this.open()
  }

  retryNow() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return
    this.generation += 1
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = undefined
    if (this.stableTimer) window.clearTimeout(this.stableTimer)
    this.stableTimer = undefined
    this.stopped = true
    this.opening = false
    const previous = this.socket
    this.socket = undefined
    // The Core server invalidates the runtime session as soon as this socket
    // closes. Clear consumers' cached runtime ID before opening the replacement
    // socket so an RPC cannot race with that invalidation and get a 403.
    this.onStatus(false)
    if (previous) {
      previous.onclose = null
      previous.onerror = null
      previous.onmessage = null
      previous.onopen = null
      previous.close(1000, 'Retry requested')
    }
    this.retry = 500
    this.reconnectStartedAt = Date.now()
    this.reconnectFailureShown = false
    this.stopped = false
    this.onError('')
    void this.open()
  }

  private async open() {
    if (this.stopped || this.opening) return
    this.opening = true
    const generation = this.generation
    try {
      await this.beforeConnect?.()
      if (this.stopped || generation !== this.generation) return
      const ticket = await this.client.wsTicket()
      if (this.stopped || generation !== this.generation) return
      const url = this.client.eventsUrl
      url.searchParams.set('ticket', ticket)
      url.searchParams.set('runId', this.client.traceId)
      if (this.lastEventId) url.searchParams.set('cursor', this.lastEventId)
      const socket = new WebSocket(url)
      const projectId = this.client.workspaceId ?? null
      socket.onopen = () => {
        if (generation !== this.generation) return
        console.info(JSON.stringify({ event: 'core_project_phase', projectId, phase: 'WS open', at: new Date().toISOString(), monotonicMs: Math.round(performance.now()) }))
      }
      socket.binaryType = 'arraybuffer'
      this.socket = socket
      socket.onmessage = async (event) => {
        if (generation !== this.generation) return
        try {
          let source: string
          if (typeof event.data === 'string') source = event.data
          else if (event.data instanceof Blob) source = await event.data.text()
          else if (event.data instanceof ArrayBuffer) source = new TextDecoder().decode(event.data)
          else if (ArrayBuffer.isView(event.data)) source = new TextDecoder().decode(event.data)
          else throw new Error(`Unsupported websocket frame: ${Object.prototype.toString.call(event.data)}`)
          const frame = JSON.parse(source) as { channel?: string; payload?: unknown }
          if (frame.channel) {
            this.lastEventId = (frame.payload as { cursor?: string } | null)?.cursor ?? this.lastEventId
            this.onFrame({ channel: frame.channel, payload: frame.payload })
            if (frame.channel === 'web:session') {
              this.onStatus(true)
              this.onError('')
              this.reconnectStartedAt = Date.now()
              this.reconnectFailureShown = false
              if (this.stableTimer) window.clearTimeout(this.stableTimer)
              this.stableTimer = window.setTimeout(() => {
                this.stableTimer = undefined
                if (generation === this.generation && socket.readyState === WebSocket.OPEN) this.retry = 500
              }, 30_000)
            }
          }
        } catch {
          socket.close(1011, 'Invalid event frame')
        }
      }
      socket.onclose = () => {
        if (generation !== this.generation) return
        if (this.stableTimer) window.clearTimeout(this.stableTimer)
        this.stableTimer = undefined
        this.onStatus(false)
        if (!this.stopped) this.scheduleRetry()
      }
      socket.onerror = () => {
        if (generation !== this.generation) return
        socket.close()
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.onStatus(false)
      if (isPermanentConnectionError(error)) {
        this.stopped = true
        this.onError(connectionFailureMessage(error))
      } else if (!this.stopped) this.scheduleRetry()
    } finally {
      if (generation === this.generation) this.opening = false
    }
  }

  private scheduleRetry() {
    if (!this.reconnectFailureShown && Date.now() - this.reconnectStartedAt >= 120_000) {
      this.reconnectFailureShown = true
      this.onError('Seltra could not reconnect to your project yet. Your saved work is safe; retry or contact support.')
    }
    const delay = Math.round(this.retry * (0.75 + Math.random() * 0.5))
    this.retry = Math.min(this.retry * 2, 15_000)
    this.timer = window.setTimeout(() => {
      this.timer = undefined
      void this.open()
    }, delay)
  }

  send(channel: string, payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ channel, payload }))
  }

  close() {
    this.generation += 1
    this.stopped = true
    this.opening = false
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = undefined
    if (this.stableTimer) window.clearTimeout(this.stableTimer)
    this.stableTimer = undefined
    this.socket?.close(1000, 'Builder closed')
    if (this.listenersAttached) {
      window.removeEventListener('online', this.resumeOnFocus)
      window.removeEventListener('focus', this.resumeOnFocus)
      document.removeEventListener('visibilitychange', this.resumeOnFocus)
      this.listenersAttached = false
    }
  }

}

function isPermanentConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const failure = error as { status?: unknown; code?: unknown }
  const status = typeof failure.status === 'number' ? failure.status : undefined
  const code = typeof failure.code === 'string' ? failure.code.toUpperCase() : ''
  return Boolean(
    (status !== undefined && [400, 401, 403, 404, 410].includes(status)) ||
    [
      'APP_NOT_FOUND',
      'INVALID_REQUEST',
      'MANIFEST_NOT_VERIFIED',
      'WORKSPACE_DESTROYED',
      'WORKSPACE_KEY_MISMATCH',
      'WORKSPACE_OWNER_MISMATCH',
      'WORKSPACE_RESTORE_FAILED',
      'STORE_SLUG_MISMATCH',
    ].includes(code),
  )
}

function connectionFailureMessage(error: unknown): string {
  const failure = error && typeof error === 'object' ? error as { status?: unknown } : {}
  if (failure.status === 401 || failure.status === 403) {
    return 'You no longer have access to this project. Sign in again or contact support.'
  }
  return 'Seltra could not safely restore this project. Your saved work has been kept. Retry or contact support.'
}

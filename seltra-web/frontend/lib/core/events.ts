import type { CoreClient } from './client'

export class CoreEvents {
  private static readonly maxAttempts = 5
  private socket?: WebSocket
  private stopped = false
  private retry = 250
  private attempts = 0
  private opening = false
  private timer?: number
  private lastEventId?: string
  private generation = 0

  constructor(
    private readonly client: CoreClient,
    private readonly onFrame: (frame: { channel: string; payload: unknown }) => void,
    private readonly onStatus: (connected: boolean) => void,
    private readonly onError: (message: string) => void = () => undefined,
  ) {}

  connect() {
    this.stopped = false
    if (this.opening || this.socket?.readyState === WebSocket.CONNECTING || this.socket?.readyState === WebSocket.OPEN) return
    void this.open()
  }

  retryNow() {
    this.generation += 1
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = undefined
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
    this.attempts = 0
    this.retry = 250
    this.stopped = false
    void this.open()
  }

  private async open() {
    if (this.stopped || this.opening) return
    this.opening = true
    const generation = this.generation
    this.attempts += 1
    try {
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
              this.attempts = 0
              this.retry = 250
              this.onStatus(true)
              this.onError('')
            }
          }
        } catch (error) {
          this.onError(error instanceof Error ? `Could not decode a Seltra Core event: ${error.message}` : 'Could not decode a Seltra Core event.')
        }
      }
      socket.onclose = () => {
        if (generation !== this.generation) return
        this.onStatus(false)
        if (!this.stopped) this.onError('Seltra connection closed. Reconnecting...')
        if (!this.stopped) this.scheduleRetry()
      }
      socket.onerror = () => {
        if (generation !== this.generation) return
        this.onError('Could not connect to the Seltra Core gateway. Reconnecting...')
        socket.close()
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.onStatus(false)
      this.onError(error instanceof Error ? `${error.message} Reconnecting...` : 'Could not start the Seltra Core connection. Reconnecting...')
      if (!this.stopped) this.scheduleRetry()
    } finally {
      if (generation === this.generation) this.opening = false
    }
  }

  private scheduleRetry() {
    if (this.attempts >= CoreEvents.maxAttempts) {
      this.onError(`Connection paused after ${CoreEvents.maxAttempts} attempts. Retry to reconnect.`)
      return
    }
    const delay = Math.round(this.retry * (0.75 + Math.random() * 0.5))
    this.retry = Math.min(this.retry * 2, 10_000)
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
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = undefined
    this.socket?.close(1000, 'Builder closed')
  }
}

import type { CoreClient } from './client'

export class CoreEvents {
  private socket?: WebSocket
  private stopped = false
  private retry = 250
  private timer?: number
  private lastEventId?: string

  constructor(
    private readonly client: CoreClient,
    private readonly onFrame: (frame: { channel: string; payload: unknown }) => void,
    private readonly onStatus: (connected: boolean) => void,
    private readonly onError: (message: string) => void = () => undefined,
  ) {}

  connect() { this.stopped = false; void this.open() }

  private async open() {
    if (this.stopped) return
    try {
      const ticket = await this.client.wsTicket()
      if (this.stopped) return
      const url = this.client.eventsUrl
      url.searchParams.set('ticket', ticket)
      if (this.lastEventId) url.searchParams.set('cursor', this.lastEventId)
      const socket = new WebSocket(url)
      // The Core gateway preserves the runtime frame type. Browsers expose
      // binary websocket frames as Blob by default, so request ArrayBuffer and
      // still decode Blob for browsers that deliver it before this takes effect.
      socket.binaryType = 'arraybuffer'
      this.socket = socket
      socket.onmessage = async (event) => {
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
            }
            this.retry = 250
          }
        } catch (error) {
          this.onError(error instanceof Error ? `Could not decode a Seltra Core event: ${error.message}` : 'Could not decode a Seltra Core event.')
        }
      }
      socket.onclose = () => {
        this.onStatus(false)
        if (!this.stopped) this.onError('The Seltra Core connection closed. Reconnecting…')
        if (!this.stopped) {
          const delay = this.retry
          this.retry = Math.min(this.retry * 2, 10_000)
          this.timer = window.setTimeout(() => void this.open(), delay)
        }
      }
      socket.onerror = () => {
        this.onError('Could not connect to the Seltra Core gateway. Reconnecting…')
        socket.close()
      }
    } catch (error) {
      this.onStatus(false)
      this.onError(error instanceof Error ? `${error.message} Reconnecting…` : 'Could not start the Seltra Core connection. Reconnecting…')
      if (!this.stopped) {
        this.timer = window.setTimeout(() => void this.open(), this.retry)
        this.retry = Math.min(this.retry * 2, 10_000)
      }
    }
  }

  send(channel: string, payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ channel, payload }))
  }

  close() { this.stopped = true; if (this.timer) window.clearTimeout(this.timer); this.socket?.close(1000, 'Builder closed') }
}

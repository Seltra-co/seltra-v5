import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoreEvents } from '../../../frontend/lib/core/events'

describe('CoreEvents reconnect circuit breaker', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('caps failed ticket attempts and allows an explicit retry', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('WebSocket', { CONNECTING: 0, OPEN: 1 })
    const wsTicket = vi.fn().mockRejectedValue(new Error('ticket unavailable'))
    const errors: string[] = []
    const events = new CoreEvents(
      { wsTicket } as never,
      () => undefined,
      () => undefined,
      (message) => errors.push(message),
    )

    events.connect()
    await vi.runAllTimersAsync()
    expect(wsTicket).toHaveBeenCalledTimes(5)
    expect(errors.at(-1)).toBe('Connection paused after 5 attempts. Retry to reconnect.')

    events.retryNow()
    await Promise.resolve()
    expect(wsTicket).toHaveBeenCalledTimes(6)
    events.close()
  })

  it('does not start overlapping ticket requests when connect is called twice', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('WebSocket', { CONNECTING: 0, OPEN: 1 })
    let finishTicket!: (ticket: string) => void
    const wsTicket = vi.fn(() => new Promise<string>((resolve) => { finishTicket = resolve }))
    const events = new CoreEvents({ wsTicket } as never, () => undefined, () => undefined)

    events.connect()
    events.connect()
    expect(wsTicket).toHaveBeenCalledTimes(1)
    events.close()
    finishTicket('unused')
    await Promise.resolve()
  })

  it('ignores a late ticket from an invalidated connection attempt', async () => {
    vi.stubGlobal('window', globalThis)
    const sockets: Array<{ close: ReturnType<typeof vi.fn> }> = []
    class FakeWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      close = vi.fn()
      constructor() { sockets.push(this) }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    let resolveFirst!: (ticket: string) => void
    const wsTicket = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce('fresh-ticket')
    const events = new CoreEvents({
      wsTicket,
      eventsUrl: new URL('ws://localhost/events'),
      traceId: '00000000-0000-4000-8000-000000000001',
    } as never, () => undefined, () => undefined)

    events.connect()
    events.retryNow()
    await Promise.resolve()
    await Promise.resolve()
    resolveFirst('stale-ticket')
    await Promise.resolve()
    expect(wsTicket).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(1)
    events.close()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoreEvents } from '../../../frontend/lib/core/events'

describe('CoreEvents reconnect recovery', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps retrying transient failures with bounded backoff without exposing transport errors', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
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
    const wsTicket = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue('fresh-ticket')
    const errors: string[] = []
    const events = new CoreEvents(
      {
        wsTicket,
        eventsUrl: new URL('ws://localhost/events'),
        traceId: '00000000-0000-4000-8000-000000000001',
      } as never,
      () => undefined,
      () => undefined,
      (message) => errors.push(message),
    )

    events.connect()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(wsTicket).toHaveBeenCalledTimes(6)
    expect(sockets).toHaveLength(1)
    expect(errors).toEqual([])
    events.close()
  })

  it('restores the workspace before each fresh WebSocket ticket', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.stubGlobal('window', globalThis)
    const order: string[] = []
    const sockets: Array<{ close: ReturnType<typeof vi.fn>; onclose: (() => void) | null }> = []
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
    const wsTicket = vi.fn(async () => {
      order.push('ticket')
      return 'fresh-ticket'
    })
    const events = new CoreEvents(
      {
        wsTicket,
        eventsUrl: new URL('ws://localhost/events'),
        traceId: '00000000-0000-4000-8000-000000000001',
      } as never,
      () => undefined,
      () => undefined,
      undefined,
      async () => { order.push('restore') },
    )

    events.connect()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    expect(order).toEqual(['restore', 'ticket'])
    sockets[0].onclose?.()
    await vi.advanceTimersByTimeAsync(500)
    expect(order).toEqual(['restore', 'ticket', 'restore', 'ticket'])
    events.close()
  })

  it('surfaces permanent restore authorization failures without retrying', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('WebSocket', { CONNECTING: 0, OPEN: 1 })
    const errors: string[] = []
    const beforeConnect = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }))
    const wsTicket = vi.fn()
    const events = new CoreEvents(
      { wsTicket } as never,
      () => undefined,
      () => undefined,
      (message) => errors.push(message),
      beforeConnect,
    )

    events.connect()
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(errors).toEqual(['You no longer have access to this project. Sign in again or contact support.'])
    expect(beforeConnect).toHaveBeenCalledTimes(1)
    expect(wsTicket).not.toHaveBeenCalled()
    events.close()
  })

  it('surfaces a product-level recovery error after prolonged outages while continuing retries', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('WebSocket', { CONNECTING: 0, OPEN: 1 })
    const errors: string[] = []
    const wsTicket = vi.fn().mockRejectedValue(new Error('temporary failure'))
    const events = new CoreEvents(
      { wsTicket } as never,
      () => undefined,
      () => undefined,
      (message) => errors.push(message),
    )

    events.connect()
    await vi.advanceTimersByTimeAsync(130_000)
    expect(wsTicket.mock.calls.length).toBeGreaterThan(5)
    expect(errors).toEqual(['Seltra could not reconnect to your project yet. Your saved work is safe; retry or contact support.'])
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
    await vi.waitFor(() => expect(wsTicket).toHaveBeenCalledTimes(1))
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
    await vi.waitFor(() => expect(wsTicket).toHaveBeenCalledTimes(1))
    events.retryNow()
    await vi.waitFor(() => expect(wsTicket).toHaveBeenCalledTimes(2))
    resolveFirst('stale-ticket')
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    expect(wsTicket).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(1)
    events.close()
  })

  it('marks the current runtime session unavailable before retrying its socket', () => {
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('WebSocket', { CONNECTING: 0, OPEN: 1 })
    const statuses: boolean[] = []
    const events = new CoreEvents(
      { wsTicket: vi.fn().mockResolvedValue('ticket') } as never,
      () => undefined,
      (connected) => statuses.push(connected),
    )

    events.retryNow()

    expect(statuses).toEqual([false])
    events.close()
  })
})

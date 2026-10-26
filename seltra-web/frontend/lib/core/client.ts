export type CoreSession = {
  coreToken: string
  expiresIn: number
  workspaceId: string
  coreWorkspaceKey: string
  storeSlug: string
  plan: string
  limits: Record<string, unknown>
}

type CoreIpcEnvelope<T> = {
  __dyadIpcEnvelope: 'dyad-ipc-envelope-v1'
  ok: boolean
  value?: T
  error?: { name?: string; message?: string; code?: string }
}

function unwrapCoreIpcEnvelope<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || (value as { __dyadIpcEnvelope?: unknown }).__dyadIpcEnvelope !== 'dyad-ipc-envelope-v1') {
    return value as T
  }
  const envelope = value as CoreIpcEnvelope<T>
  if (!envelope.ok) {
    const error = new Error(envelope.error?.message || 'Seltra Core RPC failed.') as Error & { code?: string }
    error.name = envelope.error?.name || error.name
    if (envelope.error?.code) error.code = envelope.error.code
    throw error
  }
  return envelope.value as T
}

export class CoreClient {
  constructor(private readonly getSession: () => Promise<CoreSession>, private readonly refreshSession: () => Promise<CoreSession> = getSession) {}

  private get baseUrl() {
    const url = process.env.NEXT_PUBLIC_CORE_URL
    if (!url) throw new Error('The Seltra builder is not configured.')
    const parsed = new URL(url)
    if (process.env.NODE_ENV === 'production' && (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))) {
      throw new Error('Seltra Core is misconfigured for production. Set NEXT_PUBLIC_CORE_URL to the HTTPS address of the Core gateway (for example, https://build.seltra.co).')
    }
    // The local gateway binds to 127.0.0.1. Browsers may resolve `localhost`
    // to ::1 first, where the dev gateway is not listening, which breaks the
    // WebSocket upgrade even though ordinary HTTP health checks may fall back.
    if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1'
    return parsed.toString().replace(/\/$/, '')
  }

  async invoke<T>(channel: string, args: unknown[] = [], runtimeSession?: string): Promise<T> {
    let session = await this.getSession()
    const send = () => fetch(`${this.baseUrl}/api/rpc/${encodeURIComponent(channel)}`, {
      method: 'POST', headers: {
        authorization: `Bearer ${session.coreToken}`,
        'content-type': 'application/json',
        ...(runtimeSession ? { 'x-runtime-session': runtimeSession } : {}),
      }, body: JSON.stringify({ args, undefinedArgs: args.flatMap((arg, i) => arg === undefined ? [i] : []) }),
    })
    let response = await send()
    if (response.status === 401) {
      session = await this.refreshSession()
      response = await send()
    }
    const result = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; error?: { message?: string; code?: string } }
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error?.message || 'Builder request failed.'), { code: result.error?.code, status: response.status })
    // Core's Electron IPC boundary wraps invoke results in a success/error
    // envelope. Its own web bridge unwraps that envelope before returning to
    // the renderer; Seltra talks to the gateway directly and must do the same
    // or create-app/create-chat/machine RPCs see the envelope as their result.
    return unwrapCoreIpcEnvelope<T>(result.result)
  }

  async wsTicket(): Promise<string> {
    const accessToken = localStorage.getItem('seltra:token')
    const session = await this.getSession()
    const response = await fetch('/api/v5/builder/ws-ticket', {
      method: 'POST', headers: { authorization: `Bearer ${accessToken || ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: session.workspaceId }), cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({})) as { ticket?: string; message?: string }
    if (response.status === 401) window.dispatchEvent(new Event('seltra:auth-expired'))
    if (!response.ok || !payload.ticket) throw new Error(payload.message || 'Could not reconnect to the builder.')
    return payload.ticket
  }

  get eventsUrl() {
    const url = new URL(`${this.baseUrl}/api/events`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url
  }
}

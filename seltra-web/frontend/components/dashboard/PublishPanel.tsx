'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, ExternalLink, History, Loader2, RotateCcw, Rocket, X } from 'lucide-react'
import type { StoreData } from '@/components/storefront/StorefrontPreview'

type CoreSession = { coreToken: string }
type Deployment = { id: string; status: string; sourceCommitSha?: string | null; createdAt?: string; liveAt?: string | null; errorCode?: string | null; errorMessage?: string | null; buildLogTail?: string | null; verifiedAt?: string | null; rollbackEligible?: boolean }
type PublishStatus = { enabled: boolean; publicationStatus: string; liveUrl?: string | null; live?: Deployment | null; current?: Deployment | null; queuePosition?: number; workspaceStatus?: string; persistenceStatus?: string; recent?: Deployment[] }
type HistoryPage = { items: Array<Deployment & { rollbackEligible?: boolean }>; nextCursor?: string | null }
type Props = { open: boolean; store: StoreData; isAgentBusy: boolean; getCoreSession: () => Promise<CoreSession>; onClose: () => void; onFixWithSeltra: (logTail: string) => void }

const CORE_URL = (process.env.NEXT_PUBLIC_CORE_URL || '').replace(/\/$/, '')
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'seltra.co'
const ACTIVE_STATES = new Set(['QUEUED', 'PREPARING_WORKSPACE', 'SAVING_SOURCE', 'BUILDING', 'VERIFYING', 'ACTIVATING'])
const STAGE_LABELS: Record<string, string> = {
  QUEUED: 'Queued', PREPARING_WORKSPACE: 'Preparing workspace', SAVING_SOURCE: 'Saving source', BUILDING: 'Building and deploying',
  VERIFYING: 'Verifying deployment', ACTIVATING: 'Activating public URL', LIVE: 'Published', FAILED: 'Publish failed',
  SUPERSEDED: 'Replaced by a newer deployment', DISABLED: 'Unpublished',
}

export function PublishPanel({ open, store, isAgentBusy, getCoreSession, onClose, onFixWithSeltra }: Props) {
  const coreAppId = store.dashboardApp?.coreAppId ?? store.apps?.[0]?.coreAppId
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const [history, setHistory] = useState<HistoryPage['items']>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [streamConnected, setStreamConnected] = useState(false)
  const [copied, setCopied] = useState(false)
  const [stageMessage, setStageMessage] = useState('')
  const activeDeploymentId = status?.current?.id
  const active = Boolean(status?.current && ACTIVE_STATES.has(status.current.status))
  const liveUrl = status?.liveUrl || store.dashboardApp?.publishedUrl || (status?.publicationStatus === 'PUBLISHED' ? `https://${store.slug}.${ROOT_DOMAIN}` : '')
  const sourceSha = status?.live?.sourceCommitSha || status?.current?.sourceCommitSha

  useEffect(() => {
    setStatus(null)
    setHistory([])
    setError('')
    setStageMessage('')
  }, [coreAppId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onClose])

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const session = await getCoreSession()
    if (!CORE_URL) throw new Error('Seltra Core is not configured for this dashboard.')
    const response = await fetch(`${CORE_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${session.coreToken}`, 'content-type': 'application/json', ...(init.headers || {}) },
      cache: 'no-store',
    })
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      const error = new Error(typeof body.message === 'string' ? body.message : `Publish request failed (HTTP ${response.status}).`) as Error & { code?: string; status?: number }
      error.code = typeof body.code === 'string' ? body.code : undefined
      error.status = response.status
      throw error
    }
    return body as T
  }, [getCoreSession])

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!coreAppId) return
    const body = await request<PublishStatus>(`/api/publish/status?appId=${encodeURIComponent(coreAppId)}`, { signal })
    setStatus(body)
    const page = await request<HistoryPage>(`/api/publish/deployments?appId=${encodeURIComponent(coreAppId)}&limit=10`, { signal })
    setHistory(Array.isArray(page.items) ? page.items : [])
  }, [coreAppId, request])

  useEffect(() => {
    if (!open || !coreAppId) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void load(controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load publish status.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    const timer = window.setInterval(() => {
      if (!streamConnected) void load(controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not refresh publish status.') })
    }, 2_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [open, coreAppId, load, streamConnected])

  useEffect(() => {
    if (!open || !activeDeploymentId || !CORE_URL) return
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let closed = false
    void (async () => {
      try {
        const session = await getCoreSession()
        const response = await fetch(`${CORE_URL}/api/publish/${encodeURIComponent(activeDeploymentId)}/events`, { headers: { authorization: `Bearer ${session.coreToken}`, accept: 'text/event-stream' }, signal: controller.signal, cache: 'no-store' })
        if (!response.ok || !response.body) throw new Error('Publish event stream is unavailable.')
        setStreamConnected(true)
        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!closed) {
          const item = await reader.read()
          if (item.done) break
          buffer += decoder.decode(item.value, { stream: true })
          let boundary = buffer.indexOf('\n\n')
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const eventName = block.match(/^event:\s*(.+)$/m)?.[1]?.trim()
            const dataLine = block.match(/^data:\s*(.+)$/m)?.[1]
            if (dataLine) {
              const data = JSON.parse(dataLine) as { status?: string; message?: string; outcome?: string }
              if (eventName === 'stage') {
                if (data.status) setStatus((current) => current ? { ...current, current: current.current ? { ...current.current, status: data.status! } : current.current } : current)
                setStageMessage(data.message || '')
              }
              if (eventName === 'done') { setStreamConnected(false); await load(controller.signal) }
            }
            boundary = buffer.indexOf('\n\n')
          }
        }
      } catch {
        if (!controller.signal.aborted) setStreamConnected(false)
      }
    })()
    return () => { closed = true; controller.abort(); void reader?.cancel().catch(() => undefined); setStreamConnected(false) }
  }, [open, activeDeploymentId, getCoreSession, load])

  const start = async (confirmReplaceLegacy = false, key = crypto.randomUUID()) => {
    if (!coreAppId) return
    setBusy(true); setError(''); setStageMessage('')
    try {
      await request('/api/publish/start', { method: 'POST', body: JSON.stringify({ appId: coreAppId, idempotencyKey: key, confirmReplaceLegacy }) })
      await load()
    } catch (cause) {
      const issue = cause as Error & { code?: string }
      if (issue.code === 'LEGACY_STORE_LIVE_CONFIRMATION_REQUIRED' && !confirmReplaceLegacy && window.confirm('Publishing replaces the currently live legacy storefront. Unpublishing later restores that legacy page. Continue?')) return start(true, key)
      setError(issue.message || 'The app could not be published.')
    } finally { setBusy(false) }
  }

  const rollback = async (deploymentId: string) => {
    if (!coreAppId) return
    setBusy(true); setError('')
    try {
      await request('/api/publish/rollback', { method: 'POST', body: JSON.stringify({ appId: coreAppId, deploymentId, idempotencyKey: crypto.randomUUID() }) })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The previous version could not be restored.') }
    finally { setBusy(false) }
  }

  const unpublish = async () => {
    if (!coreAppId || !window.confirm('Unpublish this app? Its Seltra subdomain will return to the legacy storefront.')) return
    setBusy(true); setError('')
    try {
      await request('/api/publish/unpublish', { method: 'POST', body: JSON.stringify({ appId: coreAppId, idempotencyKey: crypto.randomUUID() }) })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The app could not be unpublished.') }
    finally { setBusy(false) }
  }

  const copyUrl = async () => {
    if (!liveUrl) return
    try { await navigator.clipboard.writeText(liveUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }
    catch { setError('Could not copy the public URL. Copy it from the address above.') }
  }

  const disabledMessage = useMemo(() => status?.enabled === false ? 'Publishing is disabled on this service.' : '', [status?.enabled])
  if (!open) return null

  return (
    <section role="dialog" aria-modal="true" aria-labelledby="publish-panel-title" className="publish-panel-motion w-full max-w-[420px] origin-top-right overflow-hidden rounded-[26px] border border-slate-200 bg-[#fbfcfb] text-slate-900 shadow-[0_24px_70px_rgba(16,24,20,.22)] sm:max-h-[min(82vh,760px)]">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
        <div><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${status?.publicationStatus === 'PUBLISHED' ? 'bg-emerald-500' : 'bg-slate-300'}`} /><h2 id="publish-panel-title" className="text-sm font-semibold">{status?.publicationStatus === 'PUBLISHED' ? 'Published' : 'Publish your app'}</h2></div><p className="mt-1 text-sm text-slate-500">{store.name}</p></div>
        <button type="button" onClick={onClose} className="-mr-2 -mt-2 grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close publish panel"><X className="h-4 w-4" /></button>
      </header>
      <div className="max-h-[68vh] space-y-4 overflow-y-auto p-5 sm:p-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Website address</p><p className="mt-1.5 truncate text-sm font-medium text-slate-800">{liveUrl || `https://${store.slug}.${ROOT_DOMAIN}`}</p>{liveUrl && <div className="mt-3 flex gap-2"><button type="button" onClick={() => void copyUrl()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy URL'}</button><a href={liveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">Open site <ExternalLink className="h-3.5 w-3.5" /></a></div>}</div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">Deployment status</p><p className="mt-1 text-xs text-slate-500">{status?.current ? STAGE_LABELS[status.current.status] || status.current.status : status?.publicationStatus === 'PUBLISHED' ? 'Your latest version is live.' : 'Your app is ready for its first publish.'}</p>{stageMessage && active && <p className="mt-1 text-xs text-slate-500">{stageMessage}</p>}{status?.queuePosition && active && <p className="mt-1 text-xs text-slate-500">Queue position: {status.queuePosition}</p>}</div>{active && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-label="Publish in progress" />}</div>
          {status?.current?.sourceCommitSha && <p className="mt-3 font-mono text-[11px] text-slate-500">Source {status.current.sourceCommitSha.slice(0, 10)}</p>}
          {status?.current?.status === 'FAILED' && <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-800"><p>{status.current.errorMessage || status.current.errorCode || 'Publish failed.'}</p>{status.current.buildLogTail && <button type="button" onClick={() => onFixWithSeltra(status.current!.buildLogTail!)} className="mt-2 font-semibold underline">Fix with Seltra</button>}</div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy || active || isAgentBusy || !coreAppId || Boolean(disabledMessage)} onClick={() => void start()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#082012] hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"><Rocket className="h-4 w-4" />{status?.publicationStatus === 'PUBLISHED' ? 'Publish latest changes' : status?.current?.status === 'FAILED' ? 'Retry publish' : 'Publish'}</button>
            {status?.publicationStatus === 'PUBLISHED' && <button type="button" disabled={busy || active} onClick={() => void unpublish()} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 disabled:opacity-50">Unpublish</button>}
            {isAgentBusy && <span className="self-center text-[11px] text-amber-700">Wait for the current build to finish.</span>}
          </div>
        </div>

        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-800">{error}</p>}
        {disabledMessage && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{disabledMessage}</p>}
        {loading && !status && <p className="text-xs text-slate-500">Loading publish status…</p>}
        {status?.workspaceStatus === 'RESTORING' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Restoring your workspace before publishing…</p>}
        {status?.workspaceStatus === 'CAPACITY' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Workspace capacity is full. This queued publish will retry automatically as capacity becomes available.</p>}

        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><History className="h-4 w-4 text-slate-500" /><p className="text-sm font-medium">Recent deployments</p></div>{history.length ? <ul className="mt-3 space-y-2">{history.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5"><div className="min-w-0"><p className="text-xs font-medium text-slate-800">{STAGE_LABELS[item.status] || item.status}</p><p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{item.sourceCommitSha?.slice(0, 10) || item.id}</p></div>{item.rollbackEligible && item.status !== 'LIVE' && <button type="button" disabled={busy || active} onClick={() => void rollback(item.id)} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] text-slate-700 disabled:opacity-50"><RotateCcw className="h-3 w-3" />Restore</button>}</li>)}</ul> : <p className="mt-3 text-xs text-slate-500">{loading ? 'Loading history…' : 'No deployments yet.'}</p>}</div>
        <p className="text-[10px] text-slate-400">{streamConnected ? 'Live updates connected' : 'Status refreshes automatically'}{sourceSha ? ` · Live source ${sourceSha.slice(0, 10)}` : ''}</p>
      </div>
    </section>
  )
}

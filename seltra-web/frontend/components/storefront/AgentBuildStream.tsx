//seltra-web/frontend/components/storefront/AgentBuildStream.tsx
'use client'
import { Loader2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { StoreData } from './StorefrontPreview'

type BuildEvent =
  | { type: 'step'; step: string; status: 'started' | 'completed' | 'failed'; label?: string }
  | { type: 'log'; message: string }
  | { type: 'plan'; items: Array<{ label: string; detail: string }> }
  | { type: 'file'; name: string; status: 'started' | 'completed' | 'failed' }
  | { type: 'chunk'; file: string; content: string }
  | { type: 'image'; role: 'hero' | 'product'; url: string; label?: string }
  | { type: 'preview'; url: string; store?: StoreData | null }
  | { type: 'heartbeat' }
  | { type: 'done'; store?: StoreData | null }
  | { type: 'error'; message: string }

type CurrentMoment =
  | { kind: 'thinking'; text: string }
  | { kind: 'action'; title: string; subtext: string; imageUrl?: string; resolved: boolean }
  | { kind: 'image'; title: string; imageUrl?: string; galleryUrls?: string[]; caption?: string }
  | { kind: 'error'; text: string }
  | { kind: 'done' }

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'
const STEP_LABELS: Record<string, { active: string; done: string }> = {
  hero: { active: 'Designing your hero section', done: 'Hero section ready' },
  nav: { active: 'Building your navigation', done: 'Navigation ready' },
  manifest: { active: 'Structuring your storefront layout', done: 'Layout structured' },
  critique: { active: 'Reviewing design quality', done: 'Design reviewed' },
  blueprint: { active: 'Mapping your business into a plan', done: 'Plan mapped' },
  dna: { active: 'Reading your brand personality', done: 'Brand DNA extracted' },
  products: { active: 'Building your product catalog', done: 'Catalog ready' },
  payments: { active: 'Setting up checkout', done: 'Checkout ready' },
  compile: { active: 'Compiling your storefront', done: 'Rendering storefront preview' },
  deploy: { active: 'Publishing your store', done: 'Store published' },
}

function eventSourceUrl(buildId: string) {
  return `${API_BASE}/api/v1/seltra/store/build/${encodeURIComponent(buildId)}/events`
}

function formatThoughtLabel(startedAt: number | null) {
  if (!startedAt) return null
  const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
  return `Thought for ${seconds}s`
}

function deriveActionTitle(step: string, label?: string) {
  const key = step.toLowerCase()
  const mapped = STEP_LABELS[key]
  if (mapped) return mapped.active
  return label ?? step
}

function deriveDoneTitle(step: string, label?: string) {
  const key = step.toLowerCase()
  const mapped = STEP_LABELS[key]
  if (mapped) return mapped.done
  return label ?? step
}

function sanitizeBuildLogMessage(raw: string, step: string | null): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'Processing build output…'

  const technicalPatterns = [
    /\b(?:attempt|retry|rejected|unavailable|cooldown|status|Error|error|failed|timeout|403|404|429|500|502|503|504)\b/i,
    /\[CF\]/i,
    /\bqwen[0-9a-z-]+\b/i,
    /\bhero-nav-builder\b/i,
    /\bmodel\b/i,
  ]

  if (technicalPatterns.some((pattern) => pattern.test(trimmed))) {
    if (step) {
      return `Working on ${step}. This may take a moment.`
    }
    return 'Processing build updates. Please hold on while the storefront is generated.'
  }

  return trimmed
}

export function AgentBuildStream({
  storeName,
  buildId,
  onDone,
  onPreview,
  onLaunchStart,
  onError,
}: {
  storeName: string
  buildId?: string | null
  onDone?: (store?: StoreData | null) => void
  onPreview?: (store?: StoreData | null) => void
  onLaunchStart?: () => void
  onError?: (message: string) => void
}) {
  const [priorThought, setPriorThought] = useState<string | null>(null)
  const [current, setCurrent] = useState<CurrentMoment | null>(null)
  const currentRef = useRef<CurrentMoment | null>(null)
  const lastEventAt = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const keepAliveTimeout = useRef<number | null>(null)
  const reconnectTimeout = useRef<number | null>(null)
  const reconnectAttempts = useRef(0)
  const productImageGalleryRef = useRef<string[]>([])

  useEffect(() => {
    currentRef.current = current
  }, [current])

  useEffect(() => {
    if (!buildId) return

    setPriorThought(null)
    setCurrent(null)
    currentRef.current = null
    lastEventAt.current = Date.now()
    finishedRef.current = false
    reconnectAttempts.current = 0

    let source: EventSource | null = null
    const MAX_RECONNECTS = 6
    const RECONNECT_DELAY_MS = 3000

    const clearKeepAlive = () => {
      if (keepAliveTimeout.current) {
        window.clearTimeout(keepAliveTimeout.current)
        keepAliveTimeout.current = null
      }
    }

    const clearReconnect = () => {
      if (reconnectTimeout.current) {
        window.clearTimeout(reconnectTimeout.current)
        reconnectTimeout.current = null
      }
    }

    const scheduleReconnect = () => {
      if (finishedRef.current) return
      if (reconnectAttempts.current >= MAX_RECONNECTS) {
        const disconnected = { kind: 'error' as const, text: 'Build stream disconnected and could not reconnect.' }
        setCurrent(disconnected)
        currentRef.current = disconnected
        onError?.('Build stream disconnected and could not reconnect.')
        return
      }

      reconnectAttempts.current += 1
      const reconnecting = {
        kind: 'action' as const,
        title: 'Reconnecting build stream',
        subtext: `Retrying connection (${reconnectAttempts.current}/${MAX_RECONNECTS})`,
        resolved: false,
      }
      setCurrent(reconnecting)
      currentRef.current = reconnecting

      clearReconnect()
      reconnectTimeout.current = window.setTimeout(() => {
        if (finishedRef.current) return
        source = createSource()
      }, RECONNECT_DELAY_MS)
    }

    const resetTimeout = () => {
      clearKeepAlive()
      keepAliveTimeout.current = window.setTimeout(() => {
        if (finishedRef.current) return
        const disconnected = { kind: 'error' as const, text: 'Build stream timed out' }
        setCurrent(disconnected)
        currentRef.current = disconnected
        source?.close()
        scheduleReconnect()
      }, 45000)
    }

    const handleParseError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      const disconnected = { kind: 'error' as const, text: `Build stream parse error: ${message}` }
      setCurrent(disconnected)
      currentRef.current = disconnected
      onError?.(`Build stream parse error: ${message}`)
    }

    const handle = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as BuildEvent

        if (parsed.type === 'log') {
          const rawMessage = typeof parsed.message === 'string' ? parsed.message.trim() : ''
          if (!rawMessage) return

          const thought = formatThoughtLabel(lastEventAt.current)
          const currentThoughtText = currentRef.current?.kind === 'thinking' ? currentRef.current.text : null
          if (currentThoughtText) {
            setPriorThought((prev) => prev ?? (thought ? `${thought}: ${currentThoughtText}` : null))
          }

          const normalized = rawMessage.toLowerCase()
          if (normalized.includes('rendering and compiling your store') || normalized.includes('saving generated assets and refreshing preview')) {
            onLaunchStart?.()
          }
          const actionTitle = currentRef.current?.kind === 'action' ? currentRef.current.title : null
          const message = sanitizeBuildLogMessage(rawMessage, actionTitle)
          const next = { kind: 'thinking' as const, text: message }
          setCurrent(next)
          currentRef.current = next
          lastEventAt.current = Date.now()
          resetTimeout()
          return
        }

        if (parsed.type === 'step') {
          const label = parsed.label ?? parsed.step
          const previousThoughtText = formatThoughtLabel(lastEventAt.current)
          const currentThoughtText = currentRef.current?.kind === 'thinking' ? currentRef.current.text : null
          if (currentThoughtText) {
            setPriorThought((prev) => prev ?? (previousThoughtText ? `${previousThoughtText}: ${currentThoughtText}` : null))
          }

          if (parsed.status === 'started') {
            const next = {
              kind: 'action' as const,
              title: deriveActionTitle(parsed.step, label),
              subtext: 'Working on the current build step',
              resolved: false,
            }
            setCurrent(next)
            currentRef.current = next
            if (['compile', 'deploy'].includes(parsed.step.toLowerCase())) {
              onLaunchStart?.()
            }
          }

          if (parsed.status === 'completed') {
            setCurrent((prev) => {
              if (prev?.kind !== 'action') return prev
              const next = {
                kind: 'action' as const,
                title: deriveDoneTitle(parsed.step, prev.title),
                subtext: 'Completed',
                imageUrl: prev.imageUrl,
                resolved: true,
              }
              currentRef.current = next
              return next
            })
          }

          lastEventAt.current = Date.now()
          resetTimeout()
          return
        }

        if (parsed.type === 'image') {
          if (parsed.role === 'product') {
            const nextGallery = [...productImageGalleryRef.current, parsed.url]
              .filter((url, index, arr) => arr.indexOf(url) === index)
              .slice(-5)
            productImageGalleryRef.current = nextGallery
            const next = {
              kind: 'image' as const,
              title: 'Product previews',
              galleryUrls: nextGallery,
              caption: `${nextGallery.length} curated product images`,
            }
            setCurrent(next)
            currentRef.current = next
            lastEventAt.current = Date.now()
            resetTimeout()
            return
          }

          const next = {
            kind: 'image' as const,
            title: parsed.label ?? 'Generated image',
            imageUrl: parsed.url,
            caption: 'Hero image generated',
          }
          setCurrent(next)
          currentRef.current = next
          lastEventAt.current = Date.now()
          resetTimeout()
          return
        }

        if (parsed.type === 'preview') {
          const previewStore = parsed.store && typeof parsed.store === 'object' ? (parsed.store as StoreData) : undefined
          const next = {
            kind: 'action' as const,
            title: 'Rendering storefront preview',
            subtext: 'The storefront preview is being assembled',
            imageUrl: parsed.url,
            resolved: true,
          }
          setCurrent(next)
          currentRef.current = next
          onLaunchStart?.()
          onPreview?.(previewStore)
          lastEventAt.current = Date.now()
          resetTimeout()
          return
        }

        if (parsed.type === 'file' || parsed.type === 'chunk') {
          if (parsed.type === 'file' && parsed.status === 'completed') {
            setCurrent((prev) => {
              if (prev?.kind !== 'action') return prev
              const next = { ...prev, resolved: true, subtext: 'Generated successfully' }
              currentRef.current = next
              return next
            })
            lastEventAt.current = Date.now()
            resetTimeout()
            return
          }
          setCurrent((prev) => {
            if (prev?.kind !== 'action') return prev
            const next = { ...prev, subtext: 'Generating assets for review', resolved: false }
            currentRef.current = next
            return next
          })
          lastEventAt.current = Date.now()
          resetTimeout()
          return
        }

        if (parsed.type === 'done') {
          finishedRef.current = true
          clearKeepAlive()
          clearReconnect()
          setCurrent({ kind: 'done' })
          currentRef.current = { kind: 'done' }
          setPriorThought((prev) => prev ?? null)
          source?.close()
          const nextStore = parsed.store && typeof parsed.store === 'object' ? (parsed.store as StoreData) : undefined
          onDone?.(nextStore)
          return
        }

        if (parsed.type === 'error') {
          finishedRef.current = true
          clearKeepAlive()
          clearReconnect()
          setCurrent({ kind: 'error', text: parsed.message })
          currentRef.current = { kind: 'error', text: parsed.message }
          setPriorThought(null)
          source?.close()
          onError?.(parsed.message)
          return
        }

        resetTimeout()
      } catch (err) {
        if (finishedRef.current) return
        handleParseError(err)
      }
    }

    const createSource = () => {
      if (source) {
        source.close()
      }

      const nextSource = new EventSource(eventSourceUrl(buildId))
      nextSource.onmessage = handle
      for (const eventName of ['step', 'log', 'plan', 'file', 'chunk', 'image', 'preview', 'heartbeat', 'done', 'build-error']) {
        nextSource.addEventListener(eventName, handle as EventListener)
      }
      nextSource.onerror = () => {
        if (finishedRef.current) return
        clearKeepAlive()
        const disconnected = { kind: 'error' as const, text: 'Build stream disconnected' }
        setCurrent(disconnected)
        currentRef.current = disconnected
        nextSource.close()
        scheduleReconnect()
      }
      return nextSource
    }

    source = createSource()
    resetTimeout()

    return () => {
      finishedRef.current = true
      clearKeepAlive()
      clearReconnect()
      source?.close()
    }
  }, [buildId, onDone, onPreview, onError])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full flex-col justify-center gap-3">
          {priorThought && (
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {priorThought}
            </div>
          )}

          {current?.kind === 'thinking' && (
            <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/20 p-5">
              <div className="agent-glow-backdrop" />
              <div className="relative z-[1] flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="agent-thinking-text text-base font-medium">{current.text}</span>
              </div>
            </div>
          )}

          {current?.kind === 'action' && (
            <div className="rounded-2xl border border-border/60 bg-card/20 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-base font-semibold text-foreground">{current.title}</div>
                {!current.resolved && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">{current.subtext}</div>
              {current.imageUrl && (
                <div className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-background/40">
                  <img src={current.imageUrl} alt={current.title} className="aspect-[4/3] w-full object-cover" />
                </div>
              )}
            </div>
          )}

          {current?.kind === 'image' && (
            <div className="rounded-2xl border border-border/60 bg-card/20 p-4">
              <div className="text-sm font-medium text-foreground">{current.title}</div>
              {current.galleryUrls && current.galleryUrls.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {current.galleryUrls.map((url, index) => (
                    <div key={`${url}-${index}`} className="overflow-hidden rounded-xl border border-border/50 bg-background/40">
                      <img src={url} alt={`${current.title} ${index + 1}`} className="h-24 w-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : current.imageUrl ? (
                <div className="mt-3 overflow-hidden rounded-xl">
                  <img src={current.imageUrl} alt={current.title} className="w-full object-cover" />
                </div>
              ) : null}
              {current.caption && <p className="mt-2 text-xs text-muted-foreground">{current.caption}</p>}
            </div>
          )}

          {current?.kind === 'error' && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-red-400">Build failed</div>
              <div className="mt-2 text-sm text-red-200">{current.text}</div>
            </div>
          )}

          {current?.kind === 'done' && (
            <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
              <span className="text-primary">✓</span>
              <span>Your store is ready.</span>
            </div>
          )}

          {!current && (
            <div className="rounded-2xl border border-dashed border-border bg-card/20 p-5 text-sm text-muted-foreground">
              Waiting for the build stream to begin…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

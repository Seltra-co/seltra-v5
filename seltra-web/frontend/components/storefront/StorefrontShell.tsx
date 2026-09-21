//seltra-web/frontend/components/storefront/StorefrontShell.tsx
'use client'
import { useState, useRef, useEffect, type ReactNode, memo } from 'react'
import { Monitor, Smartphone, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

const DESIGN_WIDTH = 1280
const BASE = process.env.NEXT_PUBLIC_STOREFRONT_URL?.replace(/\/$/, '') ?? ''
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'seltra.co'
const ROOT_HOST = ROOT_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')
const ROOT_PROTOCOL = ROOT_HOST.includes('localhost') || ROOT_HOST.startsWith('127.') ? 'http' : 'https'

function getPreviewStoreUrl(slug: string) {
  if (BASE) {
    return `${BASE}/store/${slug}`
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    const isLocalHost = hostname === 'localhost' || hostname.startsWith('127.')
    if (isLocalHost) {
      return `/store/${slug}`
    }
  }

  return `https://${slug}.${ROOT_HOST}`
}

const PreviewContent = memo(function PreviewContent({ children }: { children: ReactNode }) {
  return <>{children}</>
})

export function StorefrontShell({
  slug,
  children,
  isStream = false,
}: {
  slug: string
  children: ReactNode
  isStream?: boolean
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // Compute scale whenever outer width changes (desktop only)
  useEffect(() => {
    if (device !== 'desktop' || isStream) return
    const outer = outerRef.current
    if (!outer) return
    const compute = () => {
      const w = outer.getBoundingClientRect().width - 16 // subtract padding
      setScale(Math.min(1, w / DESIGN_WIDTH))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(outer)
    return () => ro.disconnect()
  }, [device, isStream])

  // Keep the wrapper div height = inner content height × scale
  // so the outer scroll container knows the real document height
  useEffect(() => {
    if (device !== 'desktop' || isStream) return
    const inner = innerRef.current
    if (!inner) return
    const sync = () => {
      const wrapper = inner.parentElement
      if (wrapper) wrapper.style.height = `${inner.scrollHeight * scale}px`
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [device, scale, isStream])

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/20">
      {/* ── Toolbar ── */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card/40 px-3 py-2">
        {isStream ? (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-foreground">Building your store…</div>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-primary">{'// your store'}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{slug}.seltra.co</div>
          </div>
        )}
        <div className="flex items-center gap-2">
          {!isStream && (
            <div className="flex rounded-md border border-border bg-background/70 p-0.5">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDevice(d)}
                  className={`flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors ${
                    device === d ? 'bg-primary/15 text-primary' : 'hover:text-foreground'
                  }`}
                >
                  {d === 'desktop' ? <Monitor className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          )}
          {!isStream && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" asChild>
              <Link href={getPreviewStoreUrl(slug)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open Store
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* ── Preview area ── */}
      <div className="relative min-h-0 flex-1 bg-muted/10">

        {isStream ? (
          // ── Agent build stream: fills full height, no scroll needed inside
          // The stream component itself manages its own internal scroll
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <PreviewContent>{children}</PreviewContent>
          </div>

        ) : device === 'mobile' ? (
          // ── Mobile: phone frame centered, content scrolls naturally inside
          // No fixed height cap — the inner div grows with content
          // The outer absolutely-positioned scroller handles page scroll
          <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
            <div className="flex min-h-full items-start justify-center py-6 px-4">
              <div
                className="overflow-hidden rounded-[2.5rem] border-[3px] border-border bg-background shadow-2xl"
                style={{ width: 390 }}
              >
                {/*
                  No height cap here — let content grow naturally.
                  overflow-x hidden prevents horizontal bleed at 390px.
                  The outer div above scrolls vertically.
                */}
                <div style={{ width: 390, overflowX: 'hidden' }}>
                  <PreviewContent>{children}</PreviewContent>
                </div>
              </div>
            </div>
          </div>

        ) : (
          // ── Desktop: scale content to fit panel width
          // outerRef measures available width; innerRef reports true content height
          <div ref={outerRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden p-2">
            {/*
              This wrapper div has its height set imperatively (via the useEffect above)
              to inner.scrollHeight × scale, so the scroll container knows the full height.
            */}
            <div className="relative w-full overflow-hidden rounded-xl border border-border bg-background shadow-xl">
              <div
                ref={innerRef}
                style={{
                  width: DESIGN_WIDTH,
                  transformOrigin: 'top left',
                  transform: `scale(${scale})`,
                  // display block so scrollHeight is accurate
                  display: 'block',
                }}
              >
                <PreviewContent>{children}</PreviewContent>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
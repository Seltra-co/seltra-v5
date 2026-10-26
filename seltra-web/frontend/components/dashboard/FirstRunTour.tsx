'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowRight, Bell, Check, Mic, Paperclip, Settings2, Sparkles, X } from 'lucide-react'

const TOUR_VERSION = 'v2'
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

const steps = [
  { target: 'main-composer', title: 'Your Seltra workspace', text: 'Describe the store or change you have in mind. Seltra Core turns your prompt into a working build and preview.', icon: Sparkles },
  { target: 'attachments', title: 'Add files and designs', text: 'Use the plus button to attach files, add images, or import a Figma design into your build.', icon: Paperclip },
  { target: 'voice', title: 'Speak your idea', text: 'Tap the microphone and speak naturally. Seltra transcribes your words as you go.', icon: Mic },
  { target: 'notifications', title: 'Stay up to date', text: 'The notification bell keeps important store activity and updates close at hand.', icon: Bell },
  { target: 'account-settings', title: 'Your account and settings', text: 'Open your account menu to manage account details, billing, domains, and support.', icon: Settings2 },
]

export function FirstRunTour() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [token, setToken] = useState('')
  const [tipPosition, setTipPosition] = useState<{ left: number; top: number } | null>(null)
  const activeSteps = steps

  useEffect(() => {
    if (pathname !== '/dashboard') return
    const authToken = localStorage.getItem('seltra:token')
    if (!authToken) return
    let cancelled = false
    setToken(authToken)
    void fetch(`${API_BASE}/api/v5/auth/me`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load onboarding status')
        return response.json() as Promise<{ user?: { completedTours?: string[] } }>
      })
      .then((result) => {
        if (!cancelled) setOpen(!result.user?.completedTours?.includes(TOUR_VERSION))
      })
      .catch(() => { if (!cancelled) setOpen(false) })
    return () => { cancelled = true }
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${activeSteps[index].target}"]`))
    const element = candidates.find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0) ?? candidates[0]
    if (!element) { setTipPosition(null); return }
    const previousOutline = element.style.outline
    const previousOffset = element.style.outlineOffset
    element.style.outline = '3px solid #34d399'
    element.style.outlineOffset = '4px'
    const place = () => {
      const rect = element.getBoundingClientRect()
      const width = Math.min(360, window.innerWidth - 24)
      const side = rect.right + width + 18 <= window.innerWidth ? rect.right + 14 : Math.max(12, rect.left - width - 14)
      setTipPosition({ left: side, top: Math.max(16, Math.min(rect.top, window.innerHeight - 230)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      element.style.outline = previousOutline
      element.style.outlineOffset = previousOffset
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [activeSteps, index, open, pathname])

  const finish = useCallback(() => {
    if (token) void fetch(`${API_BASE}/api/v5/auth/preferences/onboarding`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ completedTourVersion: TOUR_VERSION }),
    }).catch(() => undefined)
    setOpen(false)
  }, [token])
  if (!open) return null

  const step = activeSteps[index]
  const StepIcon = step.icon
  const goNext = () => index === activeSteps.length - 1 ? finish() : setIndex((current) => current + 1)

  return <>
    <aside aria-label="Seltra getting started guide" className="fixed left-3 top-[132px] z-[90] w-[min(252px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#191c1a]/95 text-white shadow-[0_22px_70px_-26px_rgba(0,0,0,.8)] backdrop-blur-xl max-lg:left-3 max-lg:top-20">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-sm font-semibold">Get started</h2>
        <span className="text-xs text-white/45">{index} of {activeSteps.length}</span>
      </div>
      <div className="mx-4 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(index / activeSteps.length) * 100}%` }} /></div>
      <ol className="space-y-1 p-2">
        {activeSteps.map((item, itemIndex) => {
          const Icon = item.icon
          const active = itemIndex === index
          const complete = itemIndex < index
          return <li key={item.target}>
            <button type="button" onClick={() => setIndex(itemIndex)} className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors ${active ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]'}`}>
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${active || complete ? 'border-emerald-400 text-emerald-300' : 'border-white/20 text-white/40'}`}>{complete ? <Check size={13} /> : <Icon size={13} />}</span>
              <span className={`text-[12px] leading-5 ${active ? 'font-semibold text-white' : 'text-white/65'}`}>{item.title}</span>
            </button>
          </li>
        })}
      </ol>
      <div className="flex items-center justify-between border-t border-white/[0.08] px-4 py-3">
        <button type="button" onClick={finish} className="text-[11px] text-white/45 hover:text-white">Skip guide</button>
        <button type="button" onClick={goNext} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-neutral-950 transition hover:bg-emerald-100">
          {index === 0 ? 'Got it' : index === activeSteps.length - 1 ? 'Done' : 'Next'} {index === activeSteps.length - 1 ? <Check size={14} /> : <ArrowRight size={14} />}
        </button>
      </div>
    </aside>
    <section role="dialog" aria-modal="false" aria-labelledby="seltra-tour-title" className="fixed z-[91] w-[min(360px,calc(100vw-1.5rem))] rounded-2xl border border-white/10 bg-[#292c2b] p-4 text-white shadow-[0_24px_70px_-24px_rgba(0,0,0,.8)]" style={tipPosition ? { left: tipPosition.left, top: tipPosition.top } : { right: 20, top: 120 }}>
      <div className="flex items-center gap-2"><img src="/assets/brand/mark.png" alt="" className="h-6 w-6 object-contain" /><span className="text-sm font-semibold">Seltra</span><button type="button" onClick={finish} className="ml-auto rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close guide"><X size={15} /></button></div>
      <div className="mt-3 flex items-start gap-2.5"><StepIcon size={18} className="mt-0.5 shrink-0 text-emerald-300" /><div><h3 id="seltra-tour-title" className="text-sm font-semibold">{index === 0 ? 'Your workspace is ready' : step.title}</h3><p className="mt-1.5 text-[13px] leading-5 text-white/70">{index === 0 ? 'Seltra brings your store tools and AI builder together. Here are the tools you can use right away.' : step.text}</p></div></div>
      <div className="mt-4 flex items-center justify-between"><span className="text-[11px] text-white/40">{index + 1} / {activeSteps.length}</span><button type="button" onClick={goNext} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-neutral-950 transition hover:bg-emerald-100">{index === 0 ? 'Got it' : index === activeSteps.length - 1 ? 'Finish' : 'Next'} {index === activeSteps.length - 1 ? <Check size={14} /> : <ArrowRight size={14} />}</button></div>
    </section>
  </>
}

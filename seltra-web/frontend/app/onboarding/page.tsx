'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ChevronRight, DollarSign, Eye, EyeOff,
  FileText, Package, Search, ShieldCheck, Sparkles, Store, Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useStore } from '@/context/StoreContext'
import type { StoreData } from '@/components/storefront/StorefrontPreview'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

type Step = 'welcome' | 'terms' | 'privacy' | 'business' | 'product' | 'revenue' | 'prompt'
const order: Step[] = ['welcome', 'terms', 'privacy', 'business', 'product', 'revenue', 'prompt']

const businesses = [
  'Fashion & Apparel', 'Beauty & Skincare', 'Food & Beverage',
  'Electronics', 'Home & Lifestyle', 'Digital Products', 'Other',
]

const productLabels: Record<string, string> = {
  have: 'existing product',
  exploring: 'exploring products',
  dropship: 'dropshipping',
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null
}

function getUser() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('seltra:user')
    return raw ? JSON.parse(raw) as { email?: string; user_metadata?: Record<string, string | undefined> } : null
  } catch { return null }
}

async function apiFetch<T>(path: string, opts: RequestInit = {}) {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> ?? {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers })
    const json = await res.json().catch(() => ({}))
    if (res.status === 401) {
      ;['seltra:token', 'seltra:user', 'seltra:active_store'].forEach((key) => localStorage.removeItem(key))
      window.dispatchEvent(new Event('seltra:auth-expired'))
    }
    if (!res.ok) return { data: null as T | null, error: json?.message ?? `HTTP ${res.status}` }
    return { data: json as T, error: null as string | null }
  } catch (error) {
    return { data: null as T | null, error: error instanceof Error ? error.message : 'Network error' }
  }
}

function storeNameFromPrompt(prompt: string, business: string) {
  const clean = prompt.trim().replace(/\s+/g, ' ').split(/[.!?]/)[0].slice(0, 48).trim()
  if (clean) return clean
  return business ? `${business} Store` : 'My Seltra Store'
}

export default function OnboardingPage() {
  const router = useRouter()
  const { setActiveStore } = useStore()
  const [step, setStep] = useState<Step>('welcome')
  const [name, setName] = useState('there')
  const [privacy, setPrivacy] = useState<'share' | 'keep'>('keep')
  const [business, setBusiness] = useState('')
  const [product, setProduct] = useState('')
  const [revenue, setRevenue] = useState('')
  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)
  // Ref-based guard so HMR reloads don't reset the in-flight lock
  const creatingRef = useRef(false)

  useEffect(() => {
    const init = async () => {
      if (!getToken()) { router.replace('/auth?next=/onboarding'); return }
      const { data } = await apiFetch<StoreData[]>('/api/v1/seltra/store')
      if (Array.isArray(data) && data.length > 0) {
        setActiveStore(data[0])
        window.location.href = '/dashboard'
        return
      }
      const user = getUser()
      const meta = user?.user_metadata ?? {}
      const userName = meta.full_name || meta.name || user?.email?.split('@')[0]
      if (userName) setName(String(userName).split(' ')[0])
    }
    void init()
    const pending = sessionStorage.getItem('seltra:pending_prompt')
    if (pending) setPrompt(pending)
  }, [router, setActiveStore])

  const idx = order.indexOf(step)
  const progress = ((idx + 1) / order.length) * 100
  const next = () => { const i = order.indexOf(step); if (i < order.length - 1) setStep(order[i + 1]) }
  const back = () => { const i = order.indexOf(step); if (i > 0) setStep(order[i - 1]) }

  const finish = async () => {
    const text = prompt.trim()
    // Double-guard: ref persists across HMR, state drives UI
    if (!text || creatingRef.current) return

    creatingRef.current = true
    setCreating(true)

    const { data, error } = await apiFetch<{ store: StoreData }>('/api/v1/seltra/store', {
      method: 'POST',
      body: JSON.stringify({
        name: storeNameFromPrompt(text, business),
        businessType: business,
        targetAudience: [
          productLabels[product] ?? product,
          revenue ? `monthly revenue: ${revenue}` : '',
          privacy === 'share'
            ? 'conversation sharing: anonymized improvement ok'
            : 'conversation sharing: private',
        ].filter(Boolean).join('; '),
        prompt: text,
      }),
    })

    if (error || !data?.store) {
      toast.error(error || 'Could not create your store')
      creatingRef.current = false
      setCreating(false)
      return
    }

    setActiveStore(data.store)
    // Hard navigate — avoids any race between router, StoreContext, and HMR
    window.location.href = '/dashboard'
  }

  return (
    <div className="auth-aurora relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_30%,hsl(0_0%_0%/0.6))]" />
      <div className="relative w-full max-w-xl">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <img src="https://res.cloudinary.com/dfmsaarli/image/upload/v1782364695/ICON_large_ngiv41.png" alt="Seltra" className="h-9 w-10 rounded-xl" />
          <span className="font-mono text-lg font-semibold text-white">seltra</span>
        </Link>

        <div className="glass rounded-3xl p-7 sm:p-10">
          <div className="mb-7 flex items-center gap-3">
            {step !== 'welcome' && (
              <button onClick={back} className="text-white/60 hover:text-white" aria-label="Go back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-white transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {step === 'welcome' && (
            <div className="text-center">
              <h1 className="mb-2 text-2xl font-semibold text-white sm:text-3xl">Welcome to Seltra, {name}.</h1>
              <p className="mb-8 text-sm text-white/60 sm:text-base">
                Your AI commerce agent. Before we build your first store, let us get to know your business.
              </p>
              <div className="mb-8 space-y-2 text-left">
                {[
                  { i: Sparkles, t: 'Tell us about your business', s: '60 seconds' },
                  { i: Store, t: 'Your agent builds your store', s: 'Live in minutes' },
                  { i: Truck, t: 'We run ops, ads and fulfillment', s: 'On autopilot' },
                ].map((item) => (
                  <div key={item.t} className="glass-soft flex items-center gap-3 rounded-2xl px-4 py-3.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                      <item.i className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">{item.t}</div>
                      <div className="text-xs text-white/45">{item.s}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-white/30" />
                  </div>
                ))}
              </div>
              <Button onClick={next} className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90">Get started</Button>
            </div>
          )}

          {step === 'terms' && (
            <div className="text-center">
              <h1 className="mb-2 text-2xl font-semibold text-white">Terms & Privacy</h1>
              <p className="mb-7 text-sm text-white/55">Before we get started, please review our privacy practices and terms of service.</p>
              <div className="mb-8 space-y-2.5 text-left">
                <Link href="/privacy" target="_blank" className="glass-soft flex items-center gap-3 rounded-2xl border border-transparent px-4 py-3.5 transition hover:border-white/20">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><ShieldCheck className="h-4 w-4 text-primary" /></div>
                  <div className="flex-1 text-sm font-semibold text-white">Privacy Practices</div>
                  <ChevronRight className="h-4 w-4 text-white/40" />
                </Link>
                <Link href="/terms" target="_blank" className="glass-soft flex items-center gap-3 rounded-2xl border border-transparent px-4 py-3.5 transition hover:border-white/20">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><FileText className="h-4 w-4 text-primary" /></div>
                  <div className="flex-1 text-sm font-semibold text-white">Terms of Service</div>
                  <ChevronRight className="h-4 w-4 text-white/40" />
                </Link>
              </div>
              <Button onClick={next} className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90">I Accept</Button>
            </div>
          )}

          {step === 'privacy' && (
            <div>
              <div className="mb-7 text-center">
                <h1 className="mb-2 text-2xl font-semibold text-white">Help us improve Seltra?</h1>
                <p className="text-sm text-white/55">You can change this anytime in settings.</p>
              </div>
              <div className="mb-8 space-y-2.5">
                {[
                  { v: 'share' as const, t: 'Share Conversations', s: 'Help us improve Seltra by sharing anonymized conversations. We only see what was said, never who said it.', i: Eye },
                  { v: 'keep' as const, t: 'Keep Private', s: 'Your conversations stay private, out of analytics, and never used to improve Seltra.', i: EyeOff },
                ].map((option) => (
                  <button key={option.v} onClick={() => setPrivacy(option.v)}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all ${privacy === option.v ? 'border-white/40 bg-white/10' : 'glass-soft hover:border-white/20'}`}>
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/10">
                      <option.i className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="mb-0.5 text-sm font-semibold text-white">{option.t}</div>
                      <div className="text-xs leading-relaxed text-white/55">{option.s}</div>
                    </div>
                    <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${privacy === option.v ? 'border-white bg-white' : 'border-white/30'}`}>
                      {privacy === option.v && <div className="h-2 w-2 rounded-full bg-black" />}
                    </div>
                  </button>
                ))}
              </div>
              <Button onClick={next} className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90">Continue</Button>
            </div>
          )}

          {step === 'business' && (
            <div>
              <h1 className="mb-2 text-2xl font-semibold text-white">What is the nature of your business?</h1>
              <p className="mb-7 text-sm text-white/55">Helps your agent pick the right playbook.</p>
              <div className="mb-8 grid grid-cols-2 gap-2.5">
                {businesses.map((item) => (
                  <button key={item} onClick={() => setBusiness(item)}
                    className={`rounded-2xl border p-3.5 text-left text-sm font-medium transition-all ${business === item ? 'border-white/40 bg-white/10 text-white' : 'glass-soft text-white/80 hover:border-white/20'}`}>
                    {item}
                  </button>
                ))}
              </div>
              <Button onClick={next} disabled={!business} className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90 disabled:opacity-40">Continue</Button>
            </div>
          )}

          {step === 'product' && (
            <div>
              <h1 className="mb-2 text-2xl font-semibold text-white">Do you already have a product to sell?</h1>
              <p className="mb-7 text-sm text-white/55">We will tailor your agent workflow.</p>
              <div className="mb-8 space-y-2.5">
                {[
                  { v: 'have', t: 'Yes, I have a product', s: 'Ready to launch', i: Package },
                  { v: 'exploring', t: 'No, still exploring', s: 'Looking for the right product', i: Search },
                  { v: 'dropship', t: 'I want to dropship', s: 'Source winners and sell', i: Truck },
                ].map((option) => (
                  <button key={option.v} onClick={() => setProduct(option.v)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all ${product === option.v ? 'border-white/40 bg-white/10' : 'glass-soft hover:border-white/20'}`}>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
                      <option.i className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white">{option.t}</div>
                      <div className="text-xs text-white/50">{option.s}</div>
                    </div>
                  </button>
                ))}
              </div>
              <Button onClick={next} disabled={!product} className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90 disabled:opacity-40">Continue</Button>
            </div>
          )}

          {step === 'revenue' && (
            <div>
              <h1 className="mb-2 text-2xl font-semibold text-white">What is your store monthly revenue?</h1>
              <p className="mb-7 text-sm text-white/55">Helps us get to know your business.</p>
              <div className="mb-8 grid grid-cols-2 gap-3">
                {[
                  { v: 'none', t: 'None', s: 'Just starting out' },
                  { v: '<5k', t: 'Under $5K', s: 'Per month' },
                  { v: '5-50k', t: '$5K - $50K', s: 'Per month' },
                  { v: '50k+', t: '$50K+', s: 'Per month' },
                ].map((option) => (
                  <button key={option.v} onClick={() => setRevenue(option.v)}
                    className={`rounded-2xl border p-4 text-left transition-all ${revenue === option.v ? 'border-white/40 bg-white/10' : 'glass-soft hover:border-white/20'}`}>
                    <div className="mb-1 flex items-center gap-2">
                      <DollarSign className="h-3.5 w-3.5 text-primary" />
                      <div className="text-sm font-semibold text-white">{option.t}</div>
                    </div>
                    <div className="text-xs text-white/50">{option.s}</div>
                  </button>
                ))}
              </div>
              <Button onClick={next} disabled={!revenue} className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90 disabled:opacity-40">Continue</Button>
            </div>
          )}

          {step === 'prompt' && (
            <div>
              <h1 className="mb-2 text-2xl font-semibold text-white">What are you building, {name}?</h1>
              <p className="mb-5 text-sm text-white/55">Tell your agent about your store. The more detail, the better.</p>
              <div className="glass-soft mb-5 overflow-hidden rounded-2xl">
                <div className="border-b border-white/5 px-4 py-2 font-mono text-[11px] text-white/40">seltra ~ new store</div>
                <div className="flex gap-2 p-4 font-mono text-sm">
                  <span className="text-primary">$</span>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g. handmade shea butter skincare for young women in Accra and Lagos..."
                    className="min-h-[140px] flex-1 resize-none border-none bg-transparent text-white placeholder:text-white/30 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
              <Button
                onClick={() => void finish()}
                disabled={!prompt.trim() || creating}
                className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90 disabled:opacity-40"
              >
                {creating ? 'Creating store...' : 'Build my store ->'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
//seltra-web/frontend/app/page.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cog,
  CreditCard,
  Github,
  ImageIcon,
  Menu,
  Mic,
  Plus,
  Sparkles,
  Twitter,
  X,
  ArrowUpRight,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MessageSquare } from 'lucide-react'
import { Linkedin } from "lucide-react";
import { SiX } from "@icons-pack/react-simple-icons";
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { TypewriterPlaceholder } from '@/components/marketing/TypewriterPlaceholder'
import { RefreshCw, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null
}

async function listStores() {
  const token = getToken()
  if (!token) return []
  try {
    const res = await fetch(`${API_BASE}/api/v1/seltra/store`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => [])
    return Array.isArray(json) ? json : []
  } catch {
    return []
  }
}

const composerPrompts = [
  'Ask Seltra to launch a premium coffee brand for...',
  'Ask Seltra to open a bakery selling artisan pastries that...',
  'Ask Seltra to start an organic grocery delivery store...',
  'Ask Seltra to launch a luxury streetwear brand for...',
  'Ask Seltra to start a handmade jewelry boutique selling...',
  'Ask Seltra to open a fashion store selling...',
  'Ask Seltra to launch a skincare brand that...',
  'Ask Seltra to create a premium haircare store for...',
  'Ask Seltra to sell natural cosmetics across...',
  'Ask Seltra to build an online gadget store...',
  'Ask Seltra to sell authentic Ghanaian products worldwide...',
  'Ask Seltra to start a fresh farm produce storefront that...',
  'Ask Seltra to launch a digital agency storefront that...',
]

// ─── Merchant logos ────────────────────────────────────────────────────────
// Supabase-style trust strip: grayscale by default, full color/visible on
// hover. Real merchant logos for Kem's Outlet and De-Yogo Bar; the rest are
// styled text wordmarks treated the same way.
type BrandLogo = {
  name: string
  img?: string
  font?: string
}

const logos: BrandLogo[] = [
  { name: 'Glow Circle Beauty', img: '/seltra/Glow_Circle_Beauty.jpg' },
  { name: 'Amy Beats',  img: '/seltra/Amy_Beats.jpg' },
  { name: 'Colossals', font: 'font-sans font-bold uppercase tracking-tight' },
  { name: "Kem's Outlet", img: '/seltra/kems-outlet.jpg' },
  { name: "Jay's Collection", font: 'font-sans font-medium tracking-wide' },
  { name: 'Waffles & Co.', font: 'font-serif font-light tracking-widest uppercase' },
  { name: 'De-Yogo Bar', img: '/seltra/deyogo-bar.jpg' },
  { name: 'Favera', img: '/seltra/favera.jpeg' },
  { name: 'I&R Kicks', img: '/seltra/i&R.jpeg' },
  { name: 'Stacey’s Ts', img: '/seltra/stacey_ts.jpg'},
]

const showcaseStores = [
  {
    name: 'Dwomohs',
    category: 'Footwear - Traditional',
    desc: 'Handcrafted Ghanaian sandals with a heritage-first storefront.',
    image: '/seltra/store-dwomohs.png',
    url: 'https://dwomohs-vogue.seltra.co/',
  },
  {
    name: 'Trendy Wear',
    category: 'Apparel - Fashion',
    desc: 'Streetedge fashion with everyday versatility, live in minutes.',
    image: '/seltra/store-trendywear.png',
    url: 'https://fast-fashion-retail-store.seltra.co/',
  },
  {
    name: 'TechHub',
    category: 'Electronics - Gadgets',
    desc: 'Smartphones, laptops, and accessories, thoughtfully catalogued.',
    image: '/seltra/techgadgets.png',
    url: 'https://cheap-laptops.seltra.co/',
  },
]

const features = [
  {
    icon: Sparkles,
    title: 'AI Store Generation',
    desc: 'Describe your business, get a full storefront with branded products, copy, and images. No templates. No drag-and-drop.',
  },
  {
    icon: CreditCard,
    title: 'Payments, built in',
    desc: 'Cards, mobile money, and bank transfers wired up from day one. Ghana and Nigeria-ready.',
  },
  {
    icon: ImageIcon,
    title: 'Product Image AI',
    desc: 'Upload a photo or describe your product. Seltra generates studio-quality images automatically.',
  },
  {
    icon: Cog,
    title: 'Agent-run operations',
    desc: 'Your store restocks, reprices, and updates itself. You focus on traffic. The agent handles the rest.',
  },
]

const customerQuotes = [
  {
    quote: 'I described the brand and had a live storefront the same afternoon. Payments were already on.',
    name: "Kem's Outlet",
    role: 'Fashion merchant',
    avatar: '/seltra/kems-outlet.jpg',
  },
  {
    quote: 'The catalog and images came together without a designer. I just kept selling.',
    name: 'Glow Circle Beauty',
    role: 'Beauty brand',
    avatar: '/seltra/Glow_Circle_Beauty.jpg',
  },
  {
    quote: 'We went from WhatsApp orders to a real checkout without rebuilding anything ourselves.',
    name: 'De-Yogo Bar',
    role: 'Food & drink',
    avatar: '/seltra/deyogo-bar.jpg',
  },
  {
    quote: 'Seltra keeps the store updated. I focus on customers, not the admin work.',
    name: 'Favera',
    role: 'Retail merchant',
    avatar: '/seltra/favera.jpeg',
  },
]

const seltraStats = [
  { value: '150+', label: 'merchants' },
  { value: '15 minutes', label: 'average time to first store' },
  { value: '100%', label: 'storefronts generated by AI' },
]

// ─── Dashboard proof-of-work showcases ──────────────────────────────────────
type ShowcaseBullet = { lead: string; rest: string }

type ShowcaseUI = {
  eyebrow: string
  title: React.ReactNode
  desc: string
  bullets: ShowcaseBullet[]
  image: string
  alt: string
  url: string
}

const dashboardShowcases: ShowcaseUI[] = [
{
    eyebrow: '// live build',
    title: (
      <>
        It doesn't pick a template. <span className="text-primary">It writes one, live.</span>
      </>
    ),
    desc: 'Type one sentence and the agent starts working in front of you — parsing intent, generating a brand system, writing a catalog, streaming every decision to a visible blueprint as it happens.',
    bullets: [
      { lead: 'No developer required.', rest: 'The agent writes the brand, prices the products, and sets up your store while you watch it happen.' },
      { lead: 'You actually see it working.', rest: "It's not a loading bar. You can read exactly what the agent is doing, step by step, as it does it." },
      { lead: 'A store, priced and ready to sell.', rest: "By the time it's done there's a full catalog with real prices behind it, ready to sell." },
    ],
    image: '/seltra/dashboard-build-stream.png',
    alt: 'Seltra agent live build stream generating a skincare brand storefront',
    url: 'app.seltra.co/agent · building',
  },
  {
    eyebrow: '// generated storefront',
    title: (
      <>
        One sentence in. <span className="text-primary">A live store out.</span>
      </>
    ),
    desc: '"A luxury skincare brand for young women, call it Deluxe" became Deluxe Skin — a fully priced, checkout-ready collection on its own subdomain, in the time it takes to read this sentence.',
    bullets: [
      { lead: 'Priced and photographed.', rest: 'Product names, descriptions, and imagery generated per catalog.' },
      { lead: 'Checkout from minute one.', rest: 'Payments are wired the moment the store goes live, not bolted on after.' },
      { lead: 'Still yours to shape.', rest: 'Keep chatting with the agent to push colors, copy, or the catalog in a new direction.' },
    ],
    image: '/seltra/dashboard-storefront.png',
    alt: 'Deluxe Skin storefront generated by Seltra showing a live product collection',
    url: 'deluxe-skin-care.seltra.co',
  },
{
    eyebrow: '// merchant control',
    title: (
      <>
        It runs the store. <span className="text-primary">You still hold the keys.</span>
      </>
    ),
    desc: "Restocking, repricing, catalog updates — the agent keeps moving without waiting on you. But you're never locked out: everything it touches lives in a real dashboard you can override, or redirect with a single prompt.",
    bullets: [
      { lead: 'Step in anytime.', rest: 'Edit a price, swap an image, or delete a product directly — no need to ask the agent first.' },
      { lead: 'Or let it keep going.', rest: 'Leave it alone and the agent restocks, prices, and updates the catalog on its own.' },
      { lead: 'One source of truth.', rest: 'Whatever you change by hand or by prompt, chat and dashboard stay in sync automatically.' },
    ],
    image: '/seltra/dashboard-products.png',
    alt: 'Seltra merchant dashboard showing the agent-generated product catalog',
    url: 'app.seltra.co/products',
  },
]



// ─── Everything on one platform (image carousel) ───────────────────────────

// ─── One platform, not six tabs ────────────────────────────────────────────
type PlatformCard = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  highlight: string
  desc: string
  prompt: string
}

const platformCards: PlatformCard[] = [
  {
    icon: Sparkles,
    title: 'Describe it,',
    highlight: 'watch it build.',
    desc: "No theme picker, no drag-and-drop. Tell the agent what you're selling and it writes the brand, the copy, and the catalog itself.",
    prompt: 'Launch a luxury skincare brand for young women, call it Deluxe.',
  },
  {
    icon: ImageIcon,
    title: 'Product photos,',
    highlight: 'without a camera.',
    desc: 'Upload one reference or just describe the product. The agent generates studio-quality shots that match your brand.',
    prompt: 'Generate packshots for my new Vitamin C serum.',
  },
  {
    icon: CreditCard,
    title: 'Get paid,',
    highlight: 'however they pay.',
    desc: 'Cards, mobile money, and bank transfer — wired up the moment your store goes live. No separate integration to chase.',
    prompt: 'Turn on MTN Mobile Money for checkout.',
  },
  {
    icon: RefreshCw,
    title: 'Restocks,',
    highlight: 'before you run out.',
    desc: "The agent watches inventory and flags what's running low, so you're not finding out from an angry DM.",
    prompt: 'My Daily Essential moisturizer is almost out — reorder 50 units.',
  },
  {
    icon: Globe,
    title: 'Live on your domain,',
    highlight: 'same day.',
    desc: 'Your store ships on a real subdomain immediately, and moves to your own domain whenever you\'re ready.',
    prompt: 'Point deluxeskincare.com at my store.',
  },
  {
    icon: MessageSquare,
    title: 'Change anything,',
    highlight: 'just by asking.',
    desc: 'Reorder your bestsellers, rewrite your homepage, adjust a price. No developer, no ticket, no waiting.',
    prompt: 'Move the Starter Set to the top and darken the homepage.',
  },
]


// ─── Simple modal that avoids all radix/forwardRef JSX issues ────────────────
function SimpleModal({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────
const featureLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#pipeline', label: 'How it works' },
]

function Header() {
  const [open, setOpen] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => setAuthed(Boolean(getToken())), [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!featuresOpen) return
    const close = () => setFeaturesOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [featuresOpen])

  return (
    <header
      className={cn(
        'fixed left-0 right-0 top-0 z-50 transition-all duration-300',
        scrolled || open ? 'bg-white/85 shadow-[0_1px_0_rgba(15,23,15,0.06)] backdrop-blur-xl' : 'bg-transparent',
      )}
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex h-[4.5rem] items-center justify-between">
          <div className="flex min-w-0 items-center gap-8">
            <Link href="/" className="flex min-w-0 items-center">
              <img src="/seltra/hero/seltra-logo.png" alt="seltra" className="h-[23px] w-[89.5px] shrink-0 object-contain" />
            </Link>

            <nav className="hidden items-center gap-7 text-[15px] text-neutral-600 md:flex">
              <Link href="/#showcase" className="transition-colors hover:text-neutral-900">showcase</Link>
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 transition-colors hover:text-neutral-900"
                  aria-expanded={featuresOpen}
                  aria-haspopup="true"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFeaturesOpen((value) => !value)
                  }}
                >
                  features
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', featuresOpen && 'rotate-180')} />
                </button>
                {featuresOpen && (
                  <div className="absolute left-0 top-full z-20 mt-3 min-w-[11.5rem] overflow-hidden rounded-2xl border border-black/[0.06] bg-white py-1.5 shadow-[0_18px_40px_-24px_rgba(15,23,15,0.35)]">
                    {featureLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="block px-3.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
                        onClick={() => setFeaturesOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href={authed ? '/dashboard' : '/auth?next=/dashboard'}
              className="hidden items-center rounded-[10px] border border-[#148754] bg-white px-5 py-3 text-[14px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 md:inline-flex"
            >
              {authed ? 'Dashboard' : 'Login'}
            </Link>
            <Link
              href="/apply"
              className="inline-flex items-center rounded-[10px] border-2 border-[#16a34a] bg-[#16a34a] px-5 py-3 text-[14px] font-medium text-white transition-colors hover:border-[#15803d] hover:bg-[#15803d]"
            >
              Get started
            </Link>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-800 md:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-black/[0.06] bg-white md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-4 text-[15px]">
            <Link href="/#showcase" className="py-2 text-neutral-600 hover:text-neutral-900" onClick={() => setOpen(false)}>showcase</Link>
            <Link href="/#features" className="py-2 text-neutral-600 hover:text-neutral-900" onClick={() => setOpen(false)}>features</Link>
            <Link
              href={authed ? '/dashboard' : '/auth?next=/dashboard'}
              className="py-2 text-neutral-600 hover:text-neutral-900"
              onClick={() => setOpen(false)}
            >
              {authed ? 'Dashboard' : 'Login'}
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  const [chatInput, setChatInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleRun = async () => {
    setIsLoading(true)
    const prompt = chatInput.trim()
    if (prompt) sessionStorage.setItem('seltra:pending_prompt', prompt)

    if (!getToken()) {
      router.push('/auth?next=/onboarding')
      return
    }

    if (prompt) {
      router.push('/dashboard')
      return
    }

    const existing = await listStores()
    router.push(existing.length > 0 ? '/dashboard' : '/onboarding')
  }

  return (
    <section className="landing-hero-wash relative flex min-h-screen items-center justify-center overflow-hidden px-5 pb-20 pt-24 sm:px-6">
      <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
        <div className="fade-in w-full space-y-5">
          <h1 className="text-balance text-[2.35rem] font-semibold leading-[1.05] tracking-[-0.04em] text-neutral-950 sm:text-5xl md:text-[3.5rem]">
            Build your online store
          </h1>

          <p className="text-balance mx-auto max-w-xl text-[15px] font-normal leading-relaxed text-neutral-500 sm:text-lg">
            Create a storefront by describing what you need.
          </p>

          <div className="mx-auto w-full max-w-[640px] pt-4">
            <div className="group overflow-hidden rounded-[2rem] border border-black/[0.04] bg-white text-left shadow-[0_18px_50px_-28px_rgba(15,23,15,0.28)] transition-shadow focus-within:shadow-[0_22px_56px_-24px_rgba(15,23,15,0.34)]">
              <div className="relative px-5 pb-0 pt-4 sm:px-6 sm:pt-5">
                <TypewriterPlaceholder
                  prompts={composerPrompts}
                  typingSpeed={35}
                  deleteSpeed={18}
                  pauseDuration={1600}
                  active={chatInput.length === 0}
                  resumeDelay={200}
                  className="pointer-events-none absolute inset-x-5 top-4 text-[15px] leading-relaxed text-neutral-400 sm:inset-x-6 sm:top-5 sm:text-base"
                />
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleRun()
                    }
                  }}
                  aria-label="Describe your business and what you want to sell"
                  placeholder=""
                  wrap="off"
                  className={cn(
                    'composer-textarea composer-textarea-light relative z-10 h-[44px] w-full resize-none overflow-x-auto whitespace-pre bg-transparent text-[15px] leading-relaxed text-neutral-900 focus:outline-none sm:h-[48px] sm:text-base',
                    chatInput.length === 0 && 'caret-transparent',
                  )}
                />
              </div>

              <div className="flex items-center justify-between gap-3 px-4 pb-3.5 sm:px-5 sm:pb-4">
                <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white text-neutral-400 transition-colors hover:border-black/15 hover:text-neutral-700 sm:h-9 sm:w-9" title="Attach files">
                  <Plus className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-1.5">
                  <button type="button" className="hidden items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-800 sm:inline-flex">
                    build <ChevronDown className="h-4 w-4" />
                  </button>
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-700 sm:h-9 sm:w-9" title="Voice prompt">
                    <Mic className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRun()}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[#16a34a] text-white transition-colors hover:bg-[#15803d] disabled:pointer-events-none disabled:opacity-100 sm:h-9 sm:w-9"
                    disabled={!chatInput.trim() || isLoading}
                    title="Build store"
                  >
                    {isLoading ? (
                      <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Trust Logos ──────────────────────────────────────────────────────────────
function TrustLogos() {
  const repeated = [...logos, ...logos]

  return (
    <section className="border-y border-border bg-card/30 py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto mb-10 max-w-3xl text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">merchant trust</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Seltra powers merchants everywhere, from first sale to scaling brand
          </h2>
        </div>

        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-card/95 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-card/95 to-transparent" />
          <div className="trust-logo-track flex w-max items-center gap-6">
            {repeated.map((brand, index) => (
              <div
                key={`${brand.name}-${index}`}
                className="logo-fade group flex h-16 w-44 flex-shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background/70 px-5 text-center shadow-sm"
                style={{ animationDelay: `${(index % logos.length) * 0.45}s` }}
              >
                {brand.img ? (
                  <img
                    src={brand.img}
                    alt={brand.name}
                    className="h-9 w-9 rounded-full object-cover grayscale transition-all duration-300 group-hover:grayscale-0"
                  />
                ) : null}
                <span
                  className={`truncate text-muted-foreground transition-colors duration-300 group-hover:text-foreground ${brand.font ?? 'font-sans font-medium'}`}
                >
                  {brand.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes logo-fade {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
        .logo-fade {
          animation: logo-fade 4.5s ease-in-out infinite;
        }
      `}</style>
    </section>
  )
}

// ─── Showcase ─────────────────────────────────────────────────────────────────
function Showcase() {
  const scroller = useRef<HTMLDivElement>(null)
  const hoverSlow = useRef(false)
  const go = useRef<(direction: number) => void>(() => {})
  const stores = [...showcaseStores, ...showcaseStores]

  useEffect(() => {
    const node = scroller.current
    if (!node) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const canHover = window.matchMedia('(hover: hover)').matches

    let mode: 'rest' | 'move' = 'rest'
    let restElapsed = 0
    let moveElapsed = 0
    let moveStart = 0
    let moveTarget = 0
    let running = true
    let last = performance.now()
    let raf = 0

    const REST = 2000
    const MOVE = 1400
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

    const cardStep = () => {
      const card = node.querySelector<HTMLElement>('[data-store-card]')
      const gap = parseFloat(getComputedStyle(node).columnGap || getComputedStyle(node).gap) || 32
      return (card?.offsetWidth ?? 387) + gap
    }

    const loopWidth = () => cardStep() * showcaseStores.length

    const beginMove = (direction: number) => {
      const amount = cardStep()
      const loop = loopWidth()
      let start = node.scrollLeft
      if (direction > 0 && start >= loop - 1) {
        start -= loop
        node.scrollLeft = start
      } else if (direction < 0 && start < 1) {
        start += loop
        node.scrollLeft = start
      }
      moveStart = start
      moveTarget = start + direction * amount
      moveElapsed = 0
      mode = 'move'
    }

    const finishMove = () => {
      const loop = loopWidth()
      let end = moveTarget
      if (end >= loop) end -= loop
      if (end < 0) end += loop
      node.scrollLeft = end
      restElapsed = 0
      mode = 'rest'
    }

    go.current = (direction: number) => {
      beginMove(direction)
    }

    const tick = (now: number) => {
      if (!running) return
      const dt = Math.min(48, now - last)
      last = now
      const speed = hoverSlow.current ? 0.34 : 1

      if (!reduced) {
        if (mode === 'rest') {
          restElapsed += dt * speed
          if (restElapsed >= REST) beginMove(1)
        } else {
          moveElapsed += dt * speed
          const t = Math.min(1, moveElapsed / MOVE)
          node.scrollLeft = moveStart + (moveTarget - moveStart) * ease(t)
          if (t >= 1) finishMove()
        }
      }

      raf = window.requestAnimationFrame(tick)
    }

    const onEnter = () => {
      if (canHover) hoverSlow.current = true
    }
    const onLeave = () => {
      hoverSlow.current = false
    }

    node.addEventListener('mouseenter', onEnter)
    node.addEventListener('mouseleave', onLeave)
    raf = window.requestAnimationFrame(tick)

    return () => {
      running = false
      window.cancelAnimationFrame(raf)
      node.removeEventListener('mouseenter', onEnter)
      node.removeEventListener('mouseleave', onLeave)
      go.current = () => {}
    }
  }, [])

  return (
    <section
      id="showcase"
      className="relative overflow-hidden bg-[#f7fbf7] pb-20 pt-6 sm:pb-24 sm:pt-8 [--gutter:max(1.25rem,calc((100%-72rem)/2+1.25rem))] sm:[--gutter:max(2rem,calc((100%-72rem)/2+2rem))]"
    >
      <div className="relative z-10 px-[var(--gutter)]">
        <h2 className="text-left text-[1.85rem] font-bold tracking-[-0.035em] text-[#15803d] sm:text-[2.5rem]">
          Live stores built with Seltra.
        </h2>
      </div>

      <div
        ref={scroller}
        className="relative z-10 mt-10 flex gap-8 overflow-x-auto pb-2 pl-[var(--gutter)] pr-5 scroll-pl-[var(--gutter)] scrollbar-none sm:mt-12 sm:pr-8"
      >
        {stores.map((store, index) => (
          <a
            key={`${store.name}-${index}`}
            data-store-card
            href={store.url}
            target="_blank"
            rel="noreferrer"
            className="group relative h-[280px] w-[min(86vw,318px)] flex-shrink-0 overflow-hidden rounded-[2rem] bg-white sm:h-[342px] sm:w-[387px]"
          >
            <img
              src={store.image}
              alt={`${store.name} storefront preview`}
              loading="lazy"
              className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/40 opacity-0 backdrop-blur-[2px] transition-opacity duration-300 group-hover:opacity-100">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-medium text-neutral-900 shadow-sm">
                See store
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </a>
        ))}
      </div>

      <div className="relative z-10 mt-8 flex justify-end gap-2.5 px-[var(--gutter)]">
        <button
          type="button"
          onClick={() => go.current(-1)}
          aria-label="Previous store"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#16a34a] bg-white text-[#16a34a] transition-colors hover:bg-[#16a34a] hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => go.current(1)}
          aria-label="Next store"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#16a34a] bg-white text-[#16a34a] transition-colors hover:bg-[#16a34a] hover:text-white"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  )
}

// ─── How It Works ─────────────────────────────────────────────────────────────
const steps = [
  {
    title: 'Describe your business',
    desc: "Type what you're selling, who you're selling to, and where. Seltra handles the rest.",
    preview: 'composer',
  },
  {
    title: 'Seltra builds your stack',
    desc: 'Products, images, storefront, domain, and payments scaffolded in under minutes.',
    preview: 'thinking',
  },
  {
    title: 'Ship and scale',
    desc: 'Your store goes live on your subdomain. Seltra keeps it running and updated.',
    preview: 'browser',
  },
]

const stepComposerPrompts = [
  'Ask Seltra to build an ice cream...',
  'Ask Seltra to launch a bakery selling...',
  'Ask Seltra to open a fashion store for...',
]

function PreviewWell({
  circle,
  width = 'w-[88%]',
  children,
}: {
  circle: string
  width?: string
  children: React.ReactNode
}) {
  return (
    <div className="relative flex h-[158px] items-center justify-center overflow-hidden rounded-[1.75rem]">
      <div className={cn('absolute left-1/2 top-[55%] h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full', circle)} />
      <div className={cn('relative z-10', width)}>{children}</div>
    </div>
  )
}

function StepPreview({ type }: { type: string }) {
  if (type === 'composer') {
    return (
      <PreviewWell circle="bg-[#dcefe4]" width="w-[86%]">
        <div className="flex h-[118px] flex-col justify-between rounded-[1.6rem] bg-white px-4 py-3.5 shadow-[0_10px_28px_-14px_rgba(15,23,15,0.28)]">
          <TypewriterPlaceholder
            prompts={stepComposerPrompts}
            typingSpeed={35}
            deleteSpeed={18}
            pauseDuration={1600}
            resumeDelay={200}
            className="text-left text-[13px] leading-relaxed text-neutral-500"
          />
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full border border-black/[0.1] bg-white text-neutral-500" aria-hidden>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </PreviewWell>
    )
  }

  if (type === 'thinking') {
    return (
      <PreviewWell circle="bg-[#e8ece8]" width="w-[90%]">
        <div className="flex h-[118px] flex-col justify-between text-left">
          <div>
            <p className="text-[13px] leading-relaxed text-neutral-600">
              You are Seltra AI, acting as a world-class designer, growth marketer, brand strategist, photographer, copywriter, and conversion...
            </p>
            <p className="mt-1.5 text-[12px] font-medium text-[#16a34a]">Show more</p>
          </div>
          <div className="relative inline-flex w-fit">
            <span className="agent-glow-backdrop opacity-70" />
            <p className="agent-thinking-text-light relative z-10 rounded-full bg-white px-3 py-1 text-[12px] font-medium shadow-[0_6px_16px_-8px_rgba(15,23,15,0.35)]">Thinking...</p>
          </div>
        </div>
      </PreviewWell>
    )
  }

  return (
    <PreviewWell circle="bg-[#efe4d4]" width="w-[94%]">
      <div className="flex h-[118px] flex-col overflow-hidden rounded-[1.2rem] bg-[#f7f1e8] shadow-[0_10px_28px_-14px_rgba(15,23,15,0.28)]">
        <div className="flex items-center justify-end gap-1.5 bg-neutral-950 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
          <span className="h-2 w-2 rounded-full bg-white" />
          <span className="relative inline-flex items-center rounded-full bg-[#16a34a] px-2.5 py-0.5 text-[10px] font-semibold text-white">
            Open Store
            <svg
              viewBox="0 0 16 20"
              className="pointer-to-store absolute -bottom-3 right-0 h-4 w-3.5 drop-shadow-sm"
              aria-hidden
            >
              <path d="M1 1l13 9.2-6.1 1.4 2.2 6.2-2.6.9-2.2-6.1L1 16.2V1z" fill="white" stroke="#111" strokeWidth="1.1" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <img src="/seltra/store-dwomohs.png" alt="" className="min-h-0 flex-1 object-cover object-top" />
      </div>
    </PreviewWell>
  )
}

function HowItWorks() {
  return (
    <section id="pipeline" className="relative overflow-x-hidden bg-[#f7fbf7] pt-20 sm:pt-24">
      <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="mb-10 text-[1.85rem] font-bold tracking-[-0.035em] text-[#15803d] sm:mb-12 sm:text-[2.5rem]">
          One prompt to live store.
        </h2>

        <div className="grid gap-5 md:grid-cols-3">
          {steps.map((step, index) => (
            <article
              key={step.title}
              className="relative rounded-[2.25rem] border border-[#e6e8e6] bg-white p-4 pb-6 shadow-[0_18px_40px_-22px_rgba(15,23,15,0.22)] sm:p-5"
            >
              <div className="mb-5">
                <StepPreview type={step.preview} />
              </div>
              <div className="flex items-end justify-between gap-4 px-1 pr-10">
                <div>
                  <h3 className="text-[1.15rem] font-bold tracking-tight text-neutral-950">{step.title}</h3>
                  <p className="mt-2 max-w-[17rem] text-[13px] font-medium leading-relaxed text-neutral-700">{step.desc}</p>
                </div>
              </div>
              <span className="absolute bottom-3.5 right-3.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#22c55e] text-[11px] font-semibold text-white">
                0{index + 1}
              </span>
            </article>
          ))}
        </div>
      </div>

      <div className="relative mt-6 h-[160px] sm:mt-8 sm:h-[220px] lg:h-[276px]">
        <img
          src="/seltra/hero/section-diamond.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-0 right-0 h-[160px] w-auto max-w-none select-none object-contain object-right sm:h-[240px] lg:h-[276px]"
        />
      </div>
    </section>
  )
}

function PlatformCarousel() {
  const cards = [...platformCards, ...platformCards]

  return (
    <section className="border-t border-border py-20 sm:py-28">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mb-12 max-w-2xl sm:mb-16">
          <p className="mb-3 font-mono text-xs text-primary">{'// platform'}</p>
          <h2 className="mb-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl md:text-5xl">
            One platform, not six tabs.
          </h2>
          <p className="text-base text-muted-foreground sm:text-lg">
            WhatsApp for orders, Instagram for sales, a notebook for stock, three separate ways to get paid. Seltra replaces the fragments with one agent that already knows your store — and does the work the moment you ask.
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent sm:w-28" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent sm:w-28" />

        <div className="platform-track flex w-max gap-5 px-4 sm:px-6">
          {cards.map((card, i) => (
            <div
              key={`${card.title}-${i}`}
              className="w-[300px] flex-shrink-0 rounded-2xl border border-border bg-card p-6 sm:w-[340px] sm:p-7"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                <card.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mb-2 text-lg font-semibold leading-snug text-foreground">
                {card.title} <span className="text-primary">{card.highlight}</span>
              </h3>
              <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{card.desc}</p>
              <div className="rounded-lg border border-border bg-background/60 px-3.5 py-2.5">
                <p className="font-mono text-xs italic leading-relaxed text-muted-foreground">"{card.prompt}"</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .platform-track {
          animation: platform-scroll 60s linear infinite;
        }
        .platform-track:hover {
          animation-play-state: paused;
        }
        @keyframes platform-scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </section>
  )
}
// ─── Dashboard Proof ───────────────────────────────────────────────────────
// Replaces the old "Investors / tile wall" section. Instead of unverifiable
// numbers, this proves the product actually works with real screens from
// the live agent + dashboard.
function BrowserFrame({ image, alt, url }: { image: string; alt: string; url: string }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-primary/[0.08] blur-3xl sm:-inset-10"
      />
      <div className="rounded-[1.75rem] border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.01] p-2.5 shadow-[0_60px_140px_-60px_rgba(0,0,0,0.9)] sm:p-3">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d0c]">
          <div className="flex items-center gap-3 border-b border-white/10 bg-[#12140f]/80 px-4 py-3">
            <div className="flex flex-shrink-0 gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <div className="mx-auto flex max-w-xs flex-1 items-center justify-center truncate rounded-md border border-white/10 bg-black/30 px-3 py-1 font-mono text-[11px] text-white/45">
              {url}
            </div>
            <div className="w-[52px] flex-shrink-0" />
          </div>
          <img src={image} alt={alt} loading="lazy" className="h-auto w-full" />
        </div>
      </div>
    </div>
  )
}

function DashboardProof() {
  return (
    <section id="proof" className="overflow-hidden border-t border-border py-20 sm:py-28">
      <div className="container mx-auto px-4 sm:px-6">
          <div className="mx-auto mb-16 max-w-3xl text-center sm:mb-24">
                <p className="mb-3 font-mono text-xs text-primary">{'// inside seltra'}</p>
                <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl md:text-5xl lg:whitespace-nowrap">
                  Built by agents. Run by agents.
                </h2>
                <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                  The same agent behind these screens is the one running your store — writing the catalog, keeping it updated, without you touching a dashboard.
                </p>
              </div>

        <div className="space-y-24 sm:space-y-32">
          {dashboardShowcases.map((item, i) => {
            const imageOnRight = i % 2 === 0
            return (
              <div key={item.eyebrow} className="grid items-center gap-10 lg:grid-cols-12 lg:gap-6">
                <div
                  className={`lg:col-span-4 ${imageOnRight ? 'lg:order-1' : 'lg:order-2'}`}
                >
                  <p className="mb-3 font-mono text-xs text-primary">{item.eyebrow}</p>
                  <h3 className="mb-4 text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
                    {item.title}
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed text-muted-foreground sm:text-base">{item.desc}</p>
                  <ul className="space-y-4">
                    {item.bullets.map((b) => (
                      <li key={b.lead} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                        <span>
                          <span className="font-medium text-foreground">{b.lead}</span> {b.rest}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  className={`lg:col-span-8 ${imageOnRight ? 'lg:order-2 lg:-mr-6 xl:-mr-20' : 'lg:order-1 lg:-ml-6 xl:-ml-20'}`}
                >
                  <BrowserFrame image={item.image} alt={item.alt} url={item.url} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function WhySeltra() {
  return (
    <section
      id="why"
      className="bg-[#f7fbf7] py-12 sm:py-16 [--gutter:max(1.25rem,calc((100%-72rem)/2+1.25rem))] sm:[--gutter:max(2rem,calc((100%-72rem)/2+2rem))]"
    >
      <div className="px-[var(--gutter)]">
        <div className="rounded-[2rem] bg-[#111814] px-6 py-10 sm:px-12 sm:py-14 lg:px-16 lg:py-16">
          <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-white sm:text-[1.65rem]">
            Why Seltra exists.
          </h2>
          <p className="mt-6 max-w-3xl text-[1.45rem] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[2rem]">
            Commerce is becoming autonomous and AI-first.
          </p>
          <p className="mt-6 max-w-3xl text-[14px] leading-relaxed text-white/70 sm:text-[15px]">
            Most small and medium businesses still run on a patchwork of DMs, spreadsheets, and disconnected tools — selling through Instagram, taking orders on WhatsApp, tracking inventory in a notebook, with no real storefront and no way to scale past one person doing everything manually. We built Seltra so that gap closes to one sentence.
          </p>
          <div className="mt-10 flex items-center justify-end gap-3">
            <img src="/seltra/william.jpg" className="h-10 w-10 rounded-full object-cover" alt="William" />
            <div className="text-left">
              <div className="text-sm font-medium text-white">William</div>
              <div className="text-[12px] text-white/55">Co-founder, Seltra</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Testimonials() {
  const scroller = useRef<HTMLDivElement>(null)
  const quotes = [...customerQuotes, ...customerQuotes]

  const cardStep = () => {
    const node = scroller.current
    const card = node?.querySelector<HTMLElement>('[data-quote-card]')
    const gap = node ? parseFloat(getComputedStyle(node).columnGap || getComputedStyle(node).gap) || 20 : 20
    return (card?.offsetWidth ?? 420) + gap
  }

  const scrollByCard = (direction: number) => {
    const node = scroller.current
    if (!node) return
    node.scrollBy({ left: direction * cardStep(), behavior: 'smooth' })
  }

  return (
    <section
      id="testimonials"
      className="relative overflow-hidden bg-[#f7fbf7] pb-16 pt-6 sm:pb-24 sm:pt-8 [--gutter:max(1.25rem,calc((100%-72rem)/2+1.25rem))] sm:[--gutter:max(2rem,calc((100%-72rem)/2+2rem))]"
    >
      <img
        src="/seltra/hero/section-diamond.png"
        alt=""
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 h-[160px] w-auto max-w-none select-none object-contain object-right sm:h-[240px] lg:h-[276px]"
      />

      <div className="relative z-10 px-[var(--gutter)]">
        <h2 className="text-[1.65rem] font-semibold tracking-[-0.03em] text-neutral-950 sm:text-[2rem]">
          What customers say about Seltra.
        </h2>
      </div>

      <div
        ref={scroller}
        className="relative z-10 mt-8 flex gap-5 overflow-x-auto pb-2 pl-[var(--gutter)] pr-5 scrollbar-none sm:mt-10 sm:pr-8"
      >
        {quotes.map((item, index) => (
          <article
            key={`${item.name}-${index}`}
            data-quote-card
            className="w-[min(86vw,420px)] flex-shrink-0 rounded-[1.5rem] border border-black/[0.05] bg-white p-6 shadow-[0_18px_40px_-28px_rgba(15,23,15,0.28)] sm:w-[460px] sm:p-7"
          >
            <div className="flex gap-0.5 text-[#16a34a]">
              {Array.from({ length: 5 }).map((_, star) => (
                <Star key={star} className="h-4 w-4 fill-current" />
              ))}
            </div>
            <p className="mt-5 text-[15px] leading-relaxed text-neutral-700">{item.quote}</p>
            <div className="mt-6 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-neutral-950">{item.name}</p>
                <p className="text-[12px] text-neutral-500">{item.role}</p>
              </div>
              <img src={item.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
            </div>
          </article>
        ))}
      </div>

      <div className="relative z-10 mt-8 flex justify-end gap-2.5 px-[var(--gutter)]">
        <button
          type="button"
          onClick={() => scrollByCard(-1)}
          aria-label="Previous review"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#16a34a] bg-white text-[#16a34a] transition-colors hover:bg-[#16a34a] hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => scrollByCard(1)}
          aria-label="Next review"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#16a34a] bg-white text-[#16a34a] transition-colors hover:bg-[#16a34a] hover:text-white"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  )
}

function Stats() {
  return (
    <section
      id="stats"
      className="bg-[#f7fbf7] pb-12 sm:pb-16 [--gutter:max(1.25rem,calc((100%-72rem)/2+1.25rem))] sm:[--gutter:max(2rem,calc((100%-72rem)/2+2rem))]"
    >
      <div className="px-[var(--gutter)]">
        <div className="rounded-[2rem] bg-[#0d0f0e] px-6 py-12 sm:px-12 sm:py-16 lg:px-16">
          <h2 className="text-center text-[1.65rem] font-semibold tracking-[-0.03em] text-white sm:text-[2rem]">
            How far Seltra has come
          </h2>
          <div className="mt-10 grid gap-10 sm:mt-14 sm:grid-cols-3 sm:gap-6">
            {seltraStats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-[2.4rem] font-semibold tracking-[-0.04em] text-white sm:text-[3rem]">{stat.value}</p>
                <p className="mt-2 text-[13px] text-white/55 sm:text-sm">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Features ─────────────────────────────────────────────────────────────────
function Features() {
  return (
    <section
      id="features"
      className="bg-[#f7fbf7] py-8 sm:py-12 [--gutter:max(1.25rem,calc((100%-72rem)/2+1.25rem))] sm:[--gutter:max(2rem,calc((100%-72rem)/2+2rem))]"
    >
      <div className="px-[var(--gutter)]">
        <div className="rounded-[2rem] bg-[#24A46E] px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
          <h2 className="mb-10 max-w-3xl text-[1.65rem] font-semibold tracking-[-0.03em] text-white sm:mb-12 sm:text-[2rem]">
            Specialized agents that run your store.
          </h2>

          <div className="flex flex-col gap-10 sm:gap-12">
            {features.map((feature) => (
              <article key={feature.title}>
                <h3 className="text-[1.05rem] font-semibold tracking-tight text-white sm:text-[1.15rem]">
                  {feature.title}
                </h3>
                <p className="mt-2 max-w-2xl text-[13px] font-medium leading-relaxed text-white/80 sm:text-sm">
                  {feature.desc}
                </p>
                <div className="mt-5 min-h-[168px] rounded-[1.35rem] bg-[#e8ebe8] sm:min-h-[210px]" />
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── CTA ──────────────────────────────────────────────────────────────────────
function CTA() {
  const [chatInput, setChatInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleRun = async () => {
    setIsLoading(true)
    const prompt = chatInput.trim()
    if (prompt) sessionStorage.setItem('seltra:pending_prompt', prompt)

    if (!getToken()) {
      router.push('/auth?next=/onboarding')
      return
    }

    if (prompt) {
      router.push('/dashboard')
      return
    }

    const existing = await listStores()
    router.push(existing.length > 0 ? '/dashboard' : '/onboarding')
  }

  return (
    <section id="cta" className="bg-gradient-to-b from-[#f7fbf7] to-[#e7f6ea] px-5 py-20 sm:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-[2rem] font-semibold tracking-[-0.035em] text-neutral-950 sm:text-[2.75rem]">
          Your store is one prompt away
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-[15px] text-neutral-500 sm:text-base">
          No code. No designers. No manual setup. Just describe what you are building.
        </p>

        <div className="mx-auto mt-8 flex max-w-xl items-center gap-3 rounded-full border border-black/[0.06] bg-white px-3 py-2 shadow-[0_18px_40px_-28px_rgba(15,23,15,0.28)] sm:px-4 sm:py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/[0.08] text-neutral-400">
            <Plus className="h-4 w-4" />
          </span>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleRun()
              }
            }}
            aria-label="Describe the store you want to build"
            placeholder="Describe the store you want to build"
            className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400 sm:text-[15px]"
          />
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={!chatInput.trim() || isLoading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#16a34a] text-white transition-colors hover:bg-[#15803d] disabled:opacity-100"
            title="Build store"
          >
            {isLoading ? (
              <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="bg-[#f7fbf7] px-5 pb-8 sm:px-8">
      <div className="rounded-[2rem] bg-[#111814] px-6 py-12 text-center text-white sm:px-10 sm:py-14">
        <Link href="/" className="inline-flex items-center justify-center">
          <img src="/seltra/hero/seltra-logo.png" alt="seltra" className="h-6 w-auto brightness-0 invert sm:h-7" />
        </Link>
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-5 text-[13px] text-white/70 sm:gap-7">
          <Link href="/privacy" className="transition-colors hover:text-white">privacy</Link>
          <Link href="/terms" className="transition-colors hover:text-white">terms</Link>
          <Link href="/careers" className="transition-colors hover:text-white">careers</Link>
        </nav>
        <div className="mt-5 flex items-center justify-center gap-4 text-white/70">
          <a href="https://x.com/seltra_co" target="_blank" rel="noreferrer" aria-label="X" className="transition-colors hover:text-white">
            <SiX size={15} />
          </a>
          <a href="https://www.linkedin.com/company/seltra-inc/" target="_blank" rel="noreferrer" aria-label="LinkedIn" className="transition-colors hover:text-white">
            <Linkedin className="h-4 w-4" />
          </a>
        </div>
        <p className="mt-8 text-[11px] text-white/40">Copyright 2026 Seltra Inc. All rights reserved.</p>
      </div>
    </footer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <Hero />
      <HowItWorks />
      <Showcase />
      <Features />
      <WhySeltra />
      <Testimonials />
      <Stats />
      <CTA />
      <Footer />
    </div>
  )
}
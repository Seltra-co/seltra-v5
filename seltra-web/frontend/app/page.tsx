//seltra-web/frontend/app/page.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowUp,
  ChevronDown,
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MessageSquare, Wand2, Rocket } from 'lucide-react'
import { Linkedin } from "lucide-react";
import { SiX } from "@icons-pack/react-simple-icons";
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { TypewriterPlaceholder } from '@/components/marketing/TypewriterPlaceholder'
import { RefreshCw, Globe } from 'lucide-react'

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
function Header() {
  const [open, setOpen] = useState(false)
  const [authed, setAuthed] = useState(false)

  useEffect(() => setAuthed(Boolean(getToken())), [])

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          <div className="flex min-w-0 items-center gap-6 lg:gap-10">
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <img src="https://res.cloudinary.com/dfmsaarli/image/upload/v1782364695/ICON_large_ngiv41.png" alt="Seltra" className="h-9 w-9 shrink-0 rounded-md" />
              <span className="font-mono font-semibold tracking-tight text-foreground">seltra</span>
              <span className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">beta</span>
            </Link>

            <nav className="hidden items-center gap-7 font-mono text-xs text-muted-foreground lg:flex">
              <Link href="/#showcase" className="transition-colors hover:text-primary">/showcase</Link>
              <Link href="/careers" className="transition-colors hover:text-primary">/careers</Link>
              <Link href="/apply" className="transition-colors hover:text-primary">/apply</Link>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant={authed ? 'default' : 'ghost'} className="hidden rounded-md font-mono text-xs sm:inline-flex">
              <Link href={authed ? '/dashboard' : '/auth?next=/dashboard'}>Merchant login</Link>
            </Button>
            <Button asChild size="sm" className="rounded-md font-mono text-xs">
              <Link href="/apply">Apply to sell on Seltra</Link>
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background lg:hidden">
          <nav className="container mx-auto flex flex-col gap-3 px-4 py-4 font-mono text-sm">
            <Link href="/#showcase" className="py-2 text-muted-foreground hover:text-primary" onClick={() => setOpen(false)}>/showcase</Link>
            <Link href="/careers" className="py-2 text-muted-foreground hover:text-primary" onClick={() => setOpen(false)}>/careers</Link>
            <Link href="/apply" className="py-2 text-muted-foreground hover:text-primary" onClick={() => setOpen(false)}>/apply</Link>
            <Link
              href={authed ? '/dashboard' : '/auth?next=/dashboard'}
              className="py-2 text-muted-foreground hover:text-primary sm:hidden"
              onClick={() => setOpen(false)}
            >
              {authed ? '/dashboard' : '/merchant-login'}
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
    <section className="relative overflow-hidden pb-10 pt-24 sm:pb-12 sm:pt-28">
      <div className="bg-radial-fade pointer-events-none absolute inset-0" />

      <div className="container relative z-10 mx-auto px-4 sm:px-6">
        <div className="fade-in mx-auto w-full max-w-3xl space-y-3 text-center sm:space-y-4">
          {/* Backed by Moolre */}
          <div className="mb-1 flex justify-center">
            <a
              href="https://startup.moolre.com/?product=storefront#products"
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40"
            >
              <span>Backed by</span>
              <span className="inline-flex items-center gap-1.5 font-sans font-semibold">
                <img
                  src="/seltra/moolre-icon.png"
                  alt="Moolre"
                  className="h-3.5 w-3.5"
                />
                <span style={{ color: '#f7941d' }}>Moolre</span>
              </span>
            </a>
          </div>

          <h1 className="text-balance px-2 text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] text-foreground sm:text-4xl md:text-5xl">
            Describe your store.
            <br />
            <span className="text-primary">Seltra builds and runs it.</span>
          </h1>

          <p className="text-balance mx-auto max-w-xl text-sm font-normal leading-relaxed text-muted-foreground sm:text-base">
            Launch a full storefront today. Our agents handle operations, marketing, payments, and fulfillment.
          </p>

          <div className="mx-auto max-w-[860px] pt-3">
            <div className="group overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#1c1f1d] text-left shadow-[0_24px_70px_-42px_hsl(var(--primary)/0.65)] transition-colors focus-within:border-primary/45 sm:rounded-[1.5rem]">
              <div className="relative px-6 pb-0 pt-5 sm:px-8 sm:pt-5">
                <TypewriterPlaceholder
                  prompts={composerPrompts}
                  typingSpeed={35}
                  deleteSpeed={18}
                  pauseDuration={1600}
                  active={chatInput.length === 0}
                  className="pointer-events-none absolute inset-x-4 top-5 text-[15px] leading-relaxed sm:inset-x-8 sm:top-5 sm:text-lg"
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
                  className="relative z-10 h-[52px] w-full resize-none bg-transparent text-base leading-relaxed text-foreground focus:outline-none overflow-x-auto whitespace-pre sm:h-[60px] sm:text-lg composer-textarea"
                />
              </div>

              <div className="flex items-center justify-between gap-3 px-4 pb-4 sm:px-5 sm:pb-4">
                <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition-colors hover:border-primary/40 hover:text-primary sm:h-9 sm:w-9" title="Attach files">
                  <Plus className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-2">
                  <button type="button" className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-white/55 transition-colors hover:bg-white/[0.04] hover:text-white sm:inline-flex">
                    Build <ChevronDown className="h-4 w-4" />
                  </button>
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white sm:h-9 sm:w-9" title="Voice prompt">
                    <Mic className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRun()}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-primary hover:text-primary-foreground disabled:pointer-events-none disabled:opacity-60 sm:h-9 sm:w-9"
                    disabled={!chatInput.trim() || isLoading}
                    title="Build store"
                  >
                    {isLoading ? (
                      <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button className="rounded-md" asChild>
                <Link href="/apply">Apply to sell on Seltra</Link>
              </Button>
              <Button variant="ghost" className="rounded-md" asChild>
                <Link href="/auth?next=/dashboard">Merchant login</Link>
              </Button>
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
  return (
    <section id="showcase" className="border-t border-border py-20 sm:py-28">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mb-12 max-w-2xl sm:mb-16">
          <p className="mb-3 font-mono text-xs text-primary">{'// showcase'}</p>
          <h2 className="mb-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl md:text-5xl">
            Live stores built with Seltra.
          </h2>
          <p className="text-base text-muted-foreground sm:text-lg">
            Real businesses. Real revenue. All launched from a single prompt.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {showcaseStores.map((store) => (
            <a
              key={store.name}
              href={store.url}
              target="_blank"
              rel="noreferrer"
              className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                <img
                  src={store.image}
                  alt={`${store.name} storefront preview`}
                  loading="lazy"
                  className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-card/80 via-transparent to-transparent" />

                {/* Hover overlay: "See store" */}
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-background/90 px-4 py-2 font-mono text-xs font-medium text-foreground shadow-sm">
                    See store
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-foreground">{store.name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{store.category}</p>
                <p className="mt-3 text-sm text-muted-foreground">{store.desc}</p>
              </div>
            </a>
          ))}
        </div>

        {/* Real numbers only — pre-launch, so no traffic/GMV claims until we have them */}
        <div className="mt-12 grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card/40 sm:mt-16 sm:grid-cols-3">
          {[
            { v: '30+', l: 'Merchants' },
            { v: '15 min', l: 'Avg. time from prompt to live store' },
            { v: '100%', l: 'Storefronts generated with zero manual design' },
          ].map((stat, index, arr) => (
            <div
              key={stat.l}
              className={`border-border p-6 text-center ${index < arr.length - 1 ? 'border-b sm:border-b-0 sm:border-r' : ''}`}
            >
              <div className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl">{stat.v}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{stat.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── How It Works ─────────────────────────────────────────────────────────────
const steps = [
  {
    icon: MessageSquare,
    title: 'Describe your business',
    desc: "Type what you're selling, who you're selling to, and where. The agent handles the rest.",
  },
  {
    icon: Wand2,
    title: 'Agent builds your stack',
    desc: 'Products, images, storefront, domain, and payments scaffolded in under 15 minutes.',
  },
  {
    icon: Rocket,
    title: 'Ship and scale',
    desc: 'Your store goes live on your subdomain. The agent keeps it running, updated, and converting.',
  },
]

function HowItWorks() {
  return (
    <section id="pipeline" className="py-20 sm:py-28 border-t border-border">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mb-12 sm:mb-16">
          <div className="font-mono text-xs text-primary mb-3">// how it works</div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
            One prompt. <span className="text-primary">Live store.</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <div key={i} className="relative rounded-xl border border-border bg-card p-6 sm:p-8">
              <div className="absolute -top-3 left-6 font-mono text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground">
                step_{String(i + 1).padStart(2, '0')}
              </div>
              <div className="h-10 w-10 rounded-md bg-primary/10 border border-primary/30 flex items-center justify-center mb-5 mt-2">
                <s.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-xl mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-5">{s.desc}</p>
            </div>
          ))}
        </div>
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

// ─── Narrative ──────────────────────────────────────────────────────────────
function Narrative() {
  return (
    <section className="border-t border-border py-20 sm:py-28">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 font-mono text-xs text-primary">{'// why seltra exists'}</p>
          <h2 className="mb-6 text-2xl font-semibold leading-tight tracking-[-0.025em] sm:text-4xl md:text-5xl">
            Commerce is becoming
            <br />
            <span className="text-primary">autonomous and AI-first.</span>
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            Most small and medium businesses (SMEs) still run on a patchwork of DMs, spreadsheets, and disconnected tools — selling through Instagram, taking orders on WhatsApp, tracking inventory in a notebook, with no real storefront and no way to scale past one person doing everything manually. Going from "I sell things online" to "I run an online business" has always required a developer, a designer, and weeks of setup.
          </p>
          <p className="mt-6 text-base font-medium leading-relaxed text-foreground sm:text-lg">
            We built Seltra so that gap closes to one sentence.
          </p>

          <div className="mt-10 flex items-center justify-center gap-3">
            <img src="/seltra/william.jpg" className="h-10 w-10 rounded-full object-cover" alt="William" />
            <div className="text-left">
              <div className="text-sm font-medium text-foreground">William</div>
              <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Co-founder, Seltra</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Features ─────────────────────────────────────────────────────────────────
function Features() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mb-12 max-w-3xl sm:mb-16">
          <div className="mb-3 font-mono text-xs text-primary">{'// stack'}</div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Not a builder. <span className="text-primary">Specialized agents that run your store.</span>
          </h2>
        </div>

        <div className="grid overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature.title} className="group bg-background p-6 transition-colors hover:bg-card sm:p-8">
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card transition-colors group-hover:border-primary/50">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.desc}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 text-center font-mono text-[11px] text-muted-foreground">
          SSL/TLS encrypted · PCI-compliant payment processing · Your data stays private and protected
        </p>
      </div>
    </section>
  )
}

// ─── CTA ──────────────────────────────────────────────────────────────────────
function CTA() {
  return (
    <section id="cta" className="border-t border-border py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="relative mx-auto max-w-3xl text-center">
          <div className="bg-radial-fade absolute inset-0 -z-10" />
          <h2 className="text-balance mb-5 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Your store is <span className="text-primary">one prompt</span> away.
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-base text-muted-foreground sm:text-lg">
            No code. No designers. No manual setup. Just describe what you are building.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="rounded-md px-7" asChild>
              <Link href="/apply">Apply to sell on Seltra</Link>
            </Button>
            <Button size="lg" variant="ghost" className="rounded-md px-7" asChild>
              <Link href="/auth?next=/dashboard">Merchant login</Link>
            </Button>
          </div>
          <p className="mt-5 font-mono text-[11px] text-muted-foreground">
            Free to start. No credit card required. Live in minutes.
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-border bg-background py-10">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <Link href="/" className="mb-2 flex items-center gap-2">
              <img src="https://res.cloudinary.com/dfmsaarli/image/upload/v1782364695/ICON_large_ngiv41.png" alt="Seltra" className="h-7 w-7 rounded-md" />
              <span className="font-mono font-semibold">seltra</span>
            </Link>
            <p className="max-w-md text-sm text-muted-foreground">Commerce that runs itself.</p>
          </div>

          <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground sm:gap-6">
            <Link href="/careers" className="transition-colors hover:text-primary">careers</Link>
            <Link href="/terms" className="transition-colors hover:text-primary">terms</Link>
            <Link href="/privacy" className="transition-colors hover:text-primary">privacy</Link>
            <a
              href="https://x.com/seltra_co"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-primary"
              aria-label="X"
            >
              <SiX size={16} />
            </a>
            <a
              href="https://www.linkedin.com/company/seltra-inc/"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-primary"
              aria-label="LinkedIn"
            >
              <Linkedin className="h-4 w-4" />
            </a>
          </div>
        </div>
        <div className="mt-8 flex flex-col justify-between gap-2 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground sm:flex-row">
          <div>Copyright 2026 Seltra Inc. All rights reserved.</div>
          <div>seltra.co / v0.1.0 / all systems <span className="text-primary">online</span></div>
        </div>
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
      <TrustLogos />
      <Showcase />
      <Features />
      <PlatformCarousel />
      <HowItWorks />
      <DashboardProof />
      <Narrative />
      <CTA />
      <Footer />
    </div>
  )
}
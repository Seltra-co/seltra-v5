import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUp, BadgeCheck, CheckCircle2, Mic, Plus, Receipt, TrendingUp } from 'lucide-react'
import { Aurora } from '@/components/marketing/Aurora'
import { PromptCTA } from '@/components/marketing/PromptCTA'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { publicPhoto } from '@/lib/public-asset'
import { pageMeta } from '@/lib/seo'
import { cn } from '@/lib/utils'

export const metadata: Metadata = pageMeta({
  title: 'Features',
  description: 'Payments, orders, insights, invoices, domains and edits by prompt — one platform, not six tabs.',
  path: '/features',
})

type Chip = { icon: ReactNode; label: string; value: string }

type Feature = {
  lead: string
  accent: string
  body: string
  photo?: string
  chip?: Chip
  visual?: 'prompt'
}

const features: Feature[] = [
  {
    lead: 'Collect',
    accent: 'Payments',
    body: 'Accept cards and mobile money from day one, with payouts straight to your account.',
    photo: '/seltra/features/payments',
    chip: { icon: <CheckCircle2 className="h-4 w-4" />, label: 'Payment successful', value: 'GH₵ 1,240.00' },
  },
  {
    lead: 'Products &',
    accent: 'Orders',
    body: 'Get stock updates, automated order tracking and smooth deliveries from one place.',
    photo: '/seltra/features/orders',
    chip: { icon: <BadgeCheck className="h-4 w-4" />, label: 'Order #1048', value: 'Ready to ship' },
  },
  {
    lead: 'Sales &',
    accent: 'Insights',
    body: 'See what is selling, where customers come from and how revenue moves, without building reports.',
    photo: '/seltra/features/insights',
    chip: { icon: <TrendingUp className="h-4 w-4" />, label: 'Revenue this week', value: '+24.8%' },
  },
  {
    lead: 'Invoices &',
    accent: 'Receipts',
    body: 'Every sale produces a clean, branded receipt, and invoices go out automatically.',
    photo: '/seltra/features/invoices',
    chip: { icon: <Receipt className="h-4 w-4" />, label: 'Invoice #INV-2031', value: 'Sent to customer' },
  },
  {
    lead: 'Change',
    accent: 'by Asking',
    body: 'Describe a new banner, sale or layout in plain words and Seltra updates your store.',
    visual: 'prompt',
  },
  {
    lead: 'Domain &',
    accent: 'Security',
    body: 'Your own domain, SSL secured by design.',
    photo: '/seltra/features/domain',
  },
]

function PhotoVisual({ feature }: { feature: Feature }) {
  const src = feature.photo ? publicPhoto(feature.photo) : null
  return (
    <div className="relative">
      <div className="relative aspect-[13/8] overflow-hidden rounded-[1.25rem]">
        {src ? (
          <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="photo-placeholder absolute inset-0">
            <img src="/assets/brand/mark.png" alt="" className="page-mark page-mark-light absolute bottom-0 right-0 w-[42%]" />
          </div>
        )}
      </div>
      {feature.chip && (
        <div className="site-chip absolute -bottom-4 left-4 flex items-center gap-2.5 rounded-xl px-3 py-2 sm:left-6">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#16a34a]/10 text-[#15803d]">{feature.chip.icon}</span>
          <span className="text-left leading-tight">
            <span className="block text-[12px] font-semibold text-neutral-900">{feature.chip.label}</span>
            <span className="block text-[11px] text-neutral-500">{feature.chip.value}</span>
          </span>
        </div>
      )}
    </div>
  )
}

function PromptVisual() {
  return (
    <div className="feature-glow relative flex aspect-[13/8] items-center justify-center overflow-hidden rounded-[1.25rem] px-6">
      <img src="/assets/brand/mark.png" alt="" className="page-mark page-mark-light absolute bottom-0 left-0 w-[28%]" />
      <img src="/assets/brand/mark.png" alt="" className="page-mark page-mark-light absolute right-0 top-0 w-[24%] rotate-180" />
      <div className="relative w-full max-w-[340px] rounded-2xl border border-[#4ade80]/40 bg-[#0b1f16]/80 p-3.5 shadow-[0_0_40px_-8px_rgba(74,222,128,0.55)] backdrop-blur">
        <p className="text-[12px] text-white/55">Ask Seltra to add a Black Friday banner...</p>
        <div className="mt-4 flex items-center gap-2 text-white/50">
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-auto" />
          <Mic className="h-3.5 w-3.5" />
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#22c55e] text-white">
            <ArrowUp className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  )
}

function FeatureCard({ feature, index }: { feature: Feature; index: number }) {
  const reversed = index % 2 === 1
  return (
    <article data-reveal className="site-dark-card rounded-[1.5rem] p-6 pb-10 text-white sm:rounded-[1.75rem] sm:p-8 sm:pb-12 lg:p-11">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div className={cn(reversed && 'lg:order-2 lg:pl-6')}>
          <h2 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.75rem]">
            {feature.lead} <span className="text-[#4ade80]">{feature.accent}</span>
          </h2>
          <p className="mt-2.5 max-w-md text-[14px] leading-relaxed text-white/65 sm:text-[15px]">{feature.body}</p>
        </div>
        <div className={cn('w-full lg:max-w-[540px]', reversed ? 'lg:order-1' : 'lg:justify-self-end')}>
          {feature.visual === 'prompt' ? <PromptVisual /> : <PhotoVisual feature={feature} />}
        </div>
      </div>
    </article>
  )
}

export default function FeaturesPage() {
  return (
    <div className="landing-page min-h-screen">
      <SiteHeader transparentTop />

      <section className="px-3 sm:px-6">
        <div className="landing-hero-wash is-panel relative mx-auto flex min-h-[560px] max-w-[1400px] items-center justify-center overflow-hidden rounded-b-[2rem] px-5 pb-16 pt-32 sm:h-[88svh] sm:max-h-[860px] sm:rounded-b-[2.5rem] sm:pb-20 sm:pt-28">
          <Aurora tone="hero" />
          <div className="relative z-10 mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-[2.1rem] font-semibold leading-[1.1] tracking-[-0.035em] text-neutral-950 sm:text-[2.75rem]">
              <span className="text-[#16a34a]">One platform,</span> not six tabs.
            </h1>
            <p className="text-balance mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-neutral-600 sm:text-base">
              Payments, orders, insights, invoices and your domain all live in one place, and you can change any of it just by asking.
            </p>
            <Link href="/apply" className="btn btn-primary mt-7">
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="relative px-3 pb-8 pt-6 sm:px-6 sm:pt-8">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5 sm:gap-7">
          {features.map((feature, index) => (
            <FeatureCard key={feature.accent} feature={feature} index={index} />
          ))}
        </div>
      </section>

      <PromptCTA />
      <SiteFooter />
    </div>
  )
}

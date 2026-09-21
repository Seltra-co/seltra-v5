//seltra-web/frontend/components/storefront/sections/HeroSection.tsx
'use client'
import { motion } from 'framer-motion'
import { SafeImage } from './SafeImage'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { StoreProduct } from './types'
import { isValidImageUrl } from './utils'

const container = { hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } } }
const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.4, 0, 0.2, 1] } } }
const imgReveal = { hidden: { opacity: 0, scale: 1.04 }, show: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: [0.4, 0, 0.2, 1] } } }

function Eyebrow({ text }: { text: string }) {
  return <motion.div variants={item}><Badge variant="secondary" className="font-mono text-[0.6rem] uppercase tracking-widest px-2.5 py-1" style={{ background:'var(--store-accent-soft)', color:'var(--store-accent)', borderRadius:'var(--store-radius-full)' }}>{text}</Badge></motion.div>
}

function CTA({ label = 'Shop now', onClick }: { label?: string; onClick?: () => void }) {
  return (
    <motion.div variants={item}>
      <Button
        className="store-btn-primary gap-2 px-6 py-2.5 text-sm"
        style={{ background:'var(--store-cta-hero-primary-bg)', color:'var(--store-cta-hero-primary-text)', borderRadius:'var(--store-radius-full)' }}
        onClick={onClick}
      >
        {label} <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </motion.div>
  )
}

function HeroBlob({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <path
        fill="var(--store-accent-secondary, var(--store-accent))"
        opacity="0.16"
        d="M45.3,-58.5C58.6,-49.6,68.9,-34.9,72.4,-18.6C75.9,-2.3,72.6,15.6,64.1,30.6C55.6,45.6,41.9,57.7,26.1,64.2C10.3,70.7,-7.6,71.6,-24.4,66.6C-41.2,61.6,-56.9,50.7,-65.8,35.6C-74.7,20.5,-76.8,1.2,-72.5,-15.9C-68.2,-33,-57.5,-47.9,-43.6,-56.8C-29.7,-65.7,-14.9,-68.6,1.5,-70.6C17.8,-72.6,32,-67.4,45.3,-58.5Z"
        transform="translate(100 100)"
      />
    </svg>
  )
}

type S = { type: string; headline: string; tagline?: string; subtext?: string; eyebrow?: string; ctaLabel?: string; secondaryCtaLabel?: string }
interface Props {
  section: S
  products: StoreProduct[]
  features: string[]
  storeName: string
  heroImageUrl?: string
  heroImageUrls?: string[]
  onShopNow?: () => void
  onOpenCart?: () => void
}

export function HeroSection({
    section,
    heroImageUrl,
    heroImageUrls,
    onShopNow,
    onOpenCart,
}: Props) {
  const galleryUrls = (heroImageUrls?.filter(isValidImageUrl) ?? []).slice(0, 5)
  const imgUrl = isValidImageUrl(heroImageUrl) ? heroImageUrl : galleryUrls[0] ?? null
  const t = section.type
  const heroSurfaceTextColor = imgUrl ? 'rgba(255,255,255,0.92)' : 'var(--store-text)'
  const heroSurfaceSubtextColor = imgUrl ? 'rgba(255,255,255,0.82)' : 'var(--store-text)'

  if (t === 'hero-minimal') return (
    <section className="seltra-hero flex min-h-[380px] sm:min-h-[clamp(40vh,50vh,65vh)] items-center border-b" data-archetype="minimal-typographic" style={{ background:'var(--store-bg)', borderColor:'var(--store-border)' }}>
      <motion.div variants={container} initial="hidden" animate="show" className="seltra-hero-content flex max-w-2xl flex-col gap-3 px-[clamp(1.5rem,5vw,4rem)]">
        {section.eyebrow && <Eyebrow text={section.eyebrow} />}
        <motion.h1 variants={item} className="hero-title store-heading text-[clamp(2.5rem,5vw,4rem)] font-light tracking-tighter">{section.headline}</motion.h1>
        {section.subtext && <motion.p variants={item} className="text-sm leading-relaxed" style={{ color: heroSurfaceSubtextColor }}>{section.subtext}</motion.p>}
        <CTA label={section.ctaLabel} onClick={onShopNow} />
      </motion.div>
    </section>
  )

  if (t === 'hero-split') return (
    <section className="seltra-hero relative grid min-h-[520px] sm:min-h-[clamp(55vh,70vh,85vh)] overflow-hidden border-b md:grid-cols-2" data-archetype="split-image-right" style={{ background:'var(--store-bg)', borderColor:'var(--store-border)' }}>
      <HeroBlob className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 md:h-80 md:w-80" />

      <motion.div variants={container} initial="hidden" animate="show" className="seltra-hero-content relative z-10 flex flex-col justify-center gap-5 px-[clamp(1.5rem,5vw,4rem)] py-16">
        {section.eyebrow && (
          <motion.div variants={item}>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor:'var(--store-border)', background:'var(--store-surface)', color:'var(--store-muted)', borderRadius:'var(--store-radius-full)' }}>
              <span style={{ color:'var(--store-accent)' }}>✦</span>
              {section.eyebrow}
            </span>
          </motion.div>
        )}

        <motion.h1 variants={item} className="hero-title store-heading text-[clamp(2.75rem,5.5vw,4.5rem)] font-black text-balance">
          {section.headline}
        </motion.h1>

        {section.tagline && (
          <motion.p variants={item} className="text-base font-semibold" style={{ color: heroSurfaceTextColor }}>
            {section.tagline}
          </motion.p>
        )}
        {section.subtext && (
          <motion.p variants={item} className="max-w-md text-sm leading-relaxed" style={{ color: heroSurfaceSubtextColor }}>
            {section.subtext}
          </motion.p>
        )}

        <motion.div variants={item} className="flex flex-wrap items-center gap-3 pt-1">
          <Button className="store-btn-primary gap-2 px-6 py-2.5 text-sm" style={{ background:'var(--store-cta-hero-primary-bg)', color:'var(--store-cta-hero-primary-text)', borderRadius:'var(--store-radius-full)' }} onClick={onShopNow}>
            {section.ctaLabel ?? 'Shop now'} <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          {section.secondaryCtaLabel && <Button variant="outline" className="gap-2 px-6 py-2.5 text-sm" style={{ borderColor:'var(--store-border)', color:'var(--store-text)', borderRadius:'var(--store-radius-full)' }} onClick={onOpenCart}>{section.secondaryCtaLabel}</Button>}
        </motion.div>

        <motion.div variants={item} className="flex flex-wrap gap-4 pt-1">
          <span className="store-hero-note" style={{ color: heroSurfaceSubtextColor }}>
            Built to match your brand and products.
          </span>
        </motion.div>
      </motion.div>

      <motion.div variants={imgReveal} initial="hidden" animate="show" className="seltra-hero-media relative min-h-[300px] p-4 md:p-6">
        <div
          className="relative h-full w-full overflow-hidden"
          style={{ borderRadius: 'var(--store-radius-2xl)', boxShadow: 'var(--store-shadow)' }}
        >
          {galleryUrls.length > 1
            ? <div className="grid h-full grid-cols-2 gap-2">
                {galleryUrls.map((url, index) => (
                  <div key={`${url}-${index}`} className={`relative min-h-32 overflow-hidden ${index === 0 ? 'row-span-2' : ''}`}>
                    <SafeImage src={url} alt={`${section.headline} ${index + 1}`} fill className="object-cover" priority={index === 0} />
                  </div>
                ))}
              </div>
            : imgUrl
            ? <SafeImage src={imgUrl} alt={section.headline} fill className="object-cover" priority />
            : <div className="absolute inset-0" style={{ background:'var(--store-surface)' }} />
          }
        </div>
      </motion.div>
    </section>
  )

  if (t === 'hero-fullbleed') return (
    <section className="seltra-hero relative flex min-h-[520px] sm:min-h-[clamp(70vh,85vh,100vh)] items-end justify-center overflow-hidden text-center" data-archetype="fullbleed-bottom-text">
      <div className="absolute inset-0 z-0" style={{ background:'rgba(0,0,0,0.42)' }} />
      {imgUrl && <motion.div variants={imgReveal} initial="hidden" animate="show" className="absolute inset-0 z-[-1]"><SafeImage src={imgUrl} alt="" fill className="object-cover opacity-40" priority aria-hidden /></motion.div>}
      <motion.div variants={container} initial="hidden" animate="show" className="seltra-hero-content relative z-10 flex max-w-5xl flex-col items-center gap-5 px-6 pb-16 pt-24" style={{ color:'#ffffff' }}>
        {section.eyebrow && <motion.div variants={item}><span className="font-mono text-[0.65rem] uppercase tracking-widest opacity-60">{section.eyebrow}</span></motion.div>}
        <motion.h1 variants={item} className="hero-title font-black leading-none tracking-tight" style={{ fontFamily:'var(--store-heading-font), serif', fontSize:'clamp(4rem,14vw,10rem)', textShadow:'0 2px 32px rgba(0,0,0,0.3)' }}>{section.headline}</motion.h1>
        {section.tagline && <motion.p variants={item} className="text-[clamp(0.95rem,2vw,1.1rem)] font-semibold opacity-80">{section.tagline}</motion.p>}
        {section.subtext  && <motion.p variants={item} className="max-w-lg text-sm leading-relaxed opacity-60">{section.subtext}</motion.p>}
          <div className="flex flex-wrap gap-3">
            <Button className="store-btn-primary gap-2 px-6 py-2.5 text-sm" style={{ background:'var(--store-cta-hero-primary-bg)', color:'var(--store-cta-hero-primary-text)', borderRadius:'var(--store-radius-full)' }} onClick={onShopNow}>
              {section.ctaLabel ?? 'Shop now'} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            {section.secondaryCtaLabel && <Button variant="outline" className="gap-2 px-6 py-2.5 text-sm" style={{ borderColor:'var(--store-border)', color:'var(--store-text)', borderRadius:'var(--store-radius-full)' }} onClick={onOpenCart}>{section.secondaryCtaLabel}</Button>}
          </div>
      </motion.div>
    </section>
  )

  if (t === 'hero-editorial') return (
    <section className="seltra-hero relative flex min-h-[480px] sm:min-h-[clamp(60vh,75vh,90vh)] items-center overflow-hidden" data-archetype="editorial-commerce" style={{ background:'var(--store-bg)' }}>
      {imgUrl ? (
        <motion.div variants={imgReveal} initial="hidden" animate="show" className="absolute inset-0 z-0">
          {galleryUrls.length > 1 ? (
            <div className="grid h-full grid-cols-3 gap-1 opacity-80">
              {galleryUrls.map((url, index) => (
                <div key={`${url}-${index}`} className="relative min-h-full overflow-hidden">
                  <SafeImage src={url} alt="" fill className="object-cover object-right" priority={index === 0} aria-hidden />
                </div>
              ))}
            </div>
          ) : (
            <SafeImage src={imgUrl} alt="" fill className="object-cover object-right" priority aria-hidden />
          )}
          <div className="absolute inset-0" style={{ background:'rgba(0,0,0,0.36)' }} />
        </motion.div>
      ) : <div className="store-hero-mesh absolute inset-0 z-0" />}
      <motion.div variants={container} initial="hidden" animate="show" className="seltra-hero-content relative z-10 flex max-w-2xl flex-col gap-5 px-[clamp(1.5rem,5vw,4rem)] py-20" style={{ color: heroSurfaceTextColor }}>
        {section.eyebrow && <Eyebrow text={section.eyebrow} />}
        <motion.h1 variants={item} className="hero-title store-heading text-[clamp(2.75rem,6vw,5rem)] font-black" style={{ fontStyle:'italic' }}>{section.headline}</motion.h1>
        {section.tagline && <motion.p variants={item} className="text-lg font-medium" style={{ color: heroSurfaceTextColor }}>{section.tagline}</motion.p>}
        {section.subtext  && <motion.p variants={item} className="text-sm leading-relaxed" style={{ color: heroSurfaceSubtextColor }}>{section.subtext}</motion.p>}
        <CTA label={section.ctaLabel} onClick={onShopNow} />
      </motion.div>
    </section>
  )

  return (
    <section className="seltra-hero relative overflow-hidden px-0 sm:px-4 sm:pt-6 md:px-6" data-archetype="centered-stacked" style={{ background:'var(--store-bg)' }}>
      <div
        className="store-hero-gradient-card store-hero-mesh seltra-hero-content relative flex min-h-[420px] sm:min-h-[clamp(60vh,75vh,88vh)] items-center justify-center overflow-hidden text-center rounded-none sm:rounded-[var(--store-radius-2xl)]"
        style={{ boxShadow: 'var(--store-shadow)' }}
      >
        {imgUrl && (
          <>
            <motion.div variants={imgReveal} initial="hidden" animate="show" className="absolute inset-0 z-0">
              <SafeImage src={imgUrl} alt="" fill className="object-cover object-center opacity-[0.22]" priority aria-hidden />
            </motion.div>
            <div className="absolute inset-0 z-0" style={{ backgroundColor: 'rgba(0,0,0,0.38)' }} />
          </>
        )}
        <motion.div variants={container} initial="hidden" animate="show" className="relative z-10 flex max-w-3xl flex-col items-center gap-3 px-4 py-8 sm:gap-4 sm:px-8 sm:py-16 md:py-20" style={{ color: heroSurfaceTextColor }}>
          {section.eyebrow && <Eyebrow text={section.eyebrow} />}
          <motion.h1 variants={item} className="hero-title store-heading text-[clamp(2.25rem,8.5vw,6.5rem)] font-black leading-[1.05] sm:leading-none">{section.headline}</motion.h1>
          {section.tagline && <motion.p variants={item} className="text-[clamp(0.875rem,3vw,1.15rem)] font-semibold" style={{ color: heroSurfaceTextColor }}>{section.tagline}</motion.p>}
          {section.subtext  && <motion.p variants={item} className="max-w-prose text-[0.875rem] leading-relaxed sm:text-[0.9375rem]" style={{ color: heroSurfaceSubtextColor }}>{section.subtext}</motion.p>}
          <motion.div variants={item} className="flex flex-wrap items-center justify-center gap-2.5 pt-1 sm:gap-3">
            <Button className="store-btn-primary gap-2 px-5 py-2.5 text-sm sm:px-6" style={{ background:'var(--store-cta-hero-primary-bg)', color:'var(--store-cta-hero-primary-text)', borderRadius:'var(--store-radius-full)' }} onClick={onShopNow}>
              {section.ctaLabel ?? 'Shop now'} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

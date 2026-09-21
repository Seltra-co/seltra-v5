//seltra-web/frontend/components/storefront/sections/FeaturedDrop.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import type { SelectedVariants, StoreProduct } from './types'

interface Props {
  section: { badge: string; headline: string; subtext: string; showCountdown?: boolean }
  products: StoreProduct[]
  onAddToCart: (p: StoreProduct, selectedVariants?: SelectedVariants) => void
  onViewDetail?: (p: StoreProduct) => void
  addToCartLabel?: string
}

export function FeaturedDrop({ section, products, onAddToCart, onViewDetail, addToCartLabel }: Props) {
  const product = products[0]
  const endRef  = useRef(Date.now() + 23*3600000 + 59*60000 + 59000)
  const [time, setTime] = useState({ h:'23', m:'59', s:'59' })

  useEffect(() => {
    if (!section.showCountdown) return
    const iv = setInterval(() => {
      const d = endRef.current - Date.now(); if (d<=0) return clearInterval(iv)
      setTime({ h:String(Math.floor(d/3600000)).padStart(2,'0'), m:String(Math.floor((d%3600000)/60000)).padStart(2,'0'), s:String(Math.floor((d%60000)/1000)).padStart(2,'0') })
    }, 1000)
    return () => clearInterval(iv)
  }, [section.showCountdown])

  if (!product) return null
  const imgUrl  = product.images?.find((i) => i.isPrimary)?.url ?? product.images?.[0]?.url ?? ''
  const hasImg  = imgUrl && !imgUrl.startsWith('data:')

  return (
    <section
      className="flex flex-col gap-6 border-y p-[clamp(1.5rem,4vw,3rem)] sm:flex-row sm:items-center"
      style={{ background:'var(--store-accent-soft)', borderColor:'var(--store-border)', cursor:onViewDetail ? 'pointer' : 'default' }}
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('button')) return
        onViewDetail?.(product)
      }}
    >
      <div className="flex flex-1 flex-col gap-4">
        <Badge style={{ background:'var(--store-accent)', color:'var(--store-accent-text)', width:'fit-content' }}>{section.badge}</Badge>
        <h2 className="store-heading text-[clamp(1.5rem,3vw,2.25rem)] font-bold">{section.headline}</h2>
        <p className="text-sm" style={{ color:'var(--store-muted)' }}>{section.subtext}</p>
        {section.showCountdown && (
          <div className="flex items-center gap-1 font-mono text-xl font-bold" style={{ color:'var(--store-accent)' }}>
            {[time.h,time.m,time.s].map((t, i) => <span key={i} className="flex items-center gap-1"><span className="rounded border px-2 py-0.5 tabular-nums" style={{ borderColor:'var(--store-border)', background:'var(--store-surface)' }}>{t}</span>{i<2&&<span className="opacity-40">:</span>}</span>)}
          </div>
        )}
        <button
          className="store-btn-primary w-fit px-5 py-2.5 text-sm"
          style={{ background:'var(--store-cta-add-to-cart-bg)', color:'var(--store-cta-add-to-cart-text)' }}
          onClick={() => onAddToCart(product)}
        >
          {addToCartLabel ?? 'Shop Drop'} - {product.currency} {Number(product.price).toFixed(2)}
        </button>
      </div>
      {hasImg && <div className="relative h-[200px] w-full overflow-hidden rounded-[var(--store-radius)] sm:w-[200px] sm:flex-shrink-0"><Image src={imgUrl} alt={product.name} fill className="object-cover" /></div>}
    </section>
  )
}

//seltra-web/frontend/components/storefront/sections/ProductCard.tsx
'use client'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { SafeImage } from './SafeImage'
import { ShoppingBag, Heart } from 'lucide-react'
import type { SelectedVariants, StoreProduct } from './types'

export type ProductCardVariant = 'default' | 'editorial' | 'overlay'

function GradientTile({ name, seed }: { name: string; seed: string }) {
  const hash = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0)
  const angle = hash % 360
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: `linear-gradient(${angle}deg, var(--store-accent-soft), var(--store-surface))` }}
    >
      <span
        className="select-none text-[2.25rem] font-bold opacity-[0.12]"
        style={{ fontFamily: 'var(--store-heading-font), serif', color: 'var(--store-accent)' }}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    </div>
  )
}

function trimProductName(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length <= 4) return name
  return words.slice(0, 4).join(' ') + '…'
}

interface Props {
  product: StoreProduct
  showCategory?: boolean
  compact?: boolean
  index?: number
  isBestseller?: boolean
  variant?: ProductCardVariant
  onAddToCart: (p: StoreProduct, selectedVariants?: SelectedVariants) => void
  onViewDetail?: (p: StoreProduct) => void
  addToCartLabel?: string
}

export function ProductCard({
  product, showCategory = true, compact = false,
  index = 0, isBestseller = false, variant = 'default',
  onAddToCart, onViewDetail, addToCartLabel,
}: Props) {
  const imgUrl = product.images?.find((i) => i.isPrimary)?.url ?? product.images?.[0]?.url ?? ''
  const hasImg = Boolean(imgUrl) && !imgUrl.startsWith('data:')
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const price = Number(product.price).toFixed(2)
  const displayName = trimProductName(product.name)

  useEffect(() => {
    setImageLoaded(false)
    setImageError(false)
  }, [imgUrl])

  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    onViewDetail?.(product)
  }

  // ── Overlay: image full-bleed, name/price sit on a gradient over the
  //    image, floating heart icon — the On-running / mobile-app reference.
  if (variant === 'overlay') {
    return (
      <motion.article
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.45, delay: index * 0.06, ease: [0.4, 0, 0.2, 1] }}
        className="group relative overflow-hidden"
        style={{ aspectRatio: '3 / 4', borderRadius: 'var(--store-radius-card)', boxShadow: 'var(--store-shadow)', cursor: onViewDetail ? 'pointer' : 'default' }}
        onClick={handleClick}
      >
        {hasImg && !imageError ? (
          <>
            <SafeImage
              src={imgUrl}
              alt={displayName}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-[1.05]"
              sizes="(max-width:640px) 50vw,(max-width:1024px) 33vw,25vw"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
              </div>
            )}
          </>
        ) : (
          <GradientTile name={product.name} seed={product.id} />
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.05) 45%, transparent 65%)' }} />

        {isBestseller && <span className="store-badge-bestseller">Bestseller</span>}

        <button
          onClick={(e) => { e.stopPropagation(); onAddToCart(product) }}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition-transform hover:scale-110"
          style={{ background: 'rgba(255,255,255,0.85)', color: 'var(--store-text)' }}
          aria-label="Add to cart"
        >
          <Heart className="h-3.5 w-3.5" />
        </button>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
          <div className="min-w-0">
            {showCategory && product.category && (
              <span className="store-eyebrow block text-white/70">{product.category}</span>
            )}
            <h3 className="truncate text-sm font-bold text-white" style={{ fontFamily: 'var(--store-heading-font), serif' }}>{displayName}</h3>
            <span className="text-xs font-semibold text-white/85">{product.currency} {price}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onAddToCart(product) }}
            className="flex-shrink-0 rounded-full px-3 py-1.5 text-[0.68rem] font-bold"
            style={{ background: 'var(--store-cta-add-to-cart-bg)', color: 'var(--store-cta-add-to-cart-text)' }}
          >
            {addToCartLabel ?? '+ Add'}
          </button>
        </div>
      </motion.article>
    )
  }

  // ── Editorial: large image, understated caption below, no card border —
  //    the fashion-magazine reference (image, then a quiet name/price line).
  if (variant === 'editorial') {
    return (
      <motion.article
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.45, delay: index * 0.06, ease: [0.4, 0, 0.2, 1] }}
        className="group flex flex-col gap-3"
        style={{ cursor: onViewDetail ? 'pointer' : 'default' }}
        onClick={handleClick}
      >
        <div className="relative overflow-hidden" style={{ aspectRatio: '4 / 5', borderRadius: 'var(--store-radius-card)', background: 'var(--store-accent-soft)' }}>
          {hasImg && !imageError ? (
            <>
              <SafeImage
                src={imgUrl}
                alt={displayName}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                sizes="(max-width:640px) 50vw,(max-width:1024px) 33vw,25vw"
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
              {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                  <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
                </div>
              )}
            </>
          ) : (
            <GradientTile name={product.name} seed={product.id} />
          )}
          {isBestseller && <span className="store-badge-bestseller">Bestseller</span>}
          <button
            onClick={(e) => { e.stopPropagation(); onAddToCart(product) }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 translate-y-2 items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.72rem] font-bold opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100"
            style={{ background: 'var(--store-cta-add-to-cart-bg)', color: 'var(--store-cta-add-to-cart-text)', whiteSpace: 'nowrap' }}
          >
            {addToCartLabel ?? '+ Add'}
          </button>
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {showCategory && product.category && <span className="store-eyebrow block" style={{ color: 'var(--store-accent)' }}>{product.category}</span>}
            <h3 className="truncate text-sm font-semibold" style={{ fontFamily: 'var(--store-heading-font), serif', color: 'var(--store-text)' }}>{displayName}</h3>
          </div>
          <span className="flex-shrink-0 text-sm font-medium" style={{ color: 'var(--store-muted)' }}>{product.currency} {price}</span>
        </div>
      </motion.article>
    )
  }

  // ── Default: card with border, quick-add on hover, description + price row.
  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.4, 0, 0.2, 1] }}
      className="store-product-card group flex flex-col"
      onClick={handleClick}
      style={{ cursor: onViewDetail ? 'pointer' : 'default' }}
    >
      <div className="relative overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--store-accent-soft)', borderTopLeftRadius: 'var(--store-radius-card)', borderTopRightRadius: 'var(--store-radius-card)' }}>
        {hasImg && !imageError ? (
          <>
            <SafeImage
              src={imgUrl}
              alt={displayName}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              sizes="(max-width:640px) 50vw,(max-width:1024px) 33vw,25vw"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
              </div>
            )}
          </>
        ) : (
          <GradientTile name={product.name} seed={product.id} />
        )}
        {isBestseller && <span className="store-badge-bestseller">Bestseller</span>}
        <button
          onClick={(e) => { e.stopPropagation(); onAddToCart(product) }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 translate-y-2 items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.72rem] font-bold opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100"
            style={{ background: 'var(--store-cta-add-to-cart-bg)', color: 'var(--store-cta-add-to-cart-text)', whiteSpace: 'nowrap' }}
          >
            {addToCartLabel ?? '+ Add'}
          </button>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        {showCategory && product.category && (
          <span className="store-eyebrow" style={{ color: 'var(--store-accent)' }}>{product.category}</span>
        )}
        <h3 className="text-sm font-bold leading-snug" style={{ fontFamily: 'var(--store-heading-font), serif', color: 'var(--store-text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {displayName}
        </h3>
        {!compact && product.description && (
          <p className="text-[0.72rem] leading-relaxed" style={{ color: 'var(--store-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {product.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-sm font-extrabold" style={{ fontFamily: 'var(--store-heading-font), serif', color: 'var(--store-accent)' }}>
            {product.currency} {price}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onAddToCart(product) }}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[0.68rem] font-bold transition-all duration-150"
            style={{ background: 'var(--store-cta-add-to-cart-bg)', color: 'var(--store-cta-add-to-cart-text)', border: 'none' }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
          >
            <ShoppingBag style={{ width: '0.7rem', height: '0.7rem' }} /> {addToCartLabel ?? 'Add'}
          </button>
        </div>
      </div>
    </motion.article>
  )
}

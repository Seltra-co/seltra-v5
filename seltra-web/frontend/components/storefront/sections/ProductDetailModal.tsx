//seltra-web/frontend/components/storefront/sections/ProductDetailModal.tsx
'use client'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ShoppingBag, X } from 'lucide-react'
import { SafeImage } from './SafeImage'
import type { SelectedVariants, StoreProduct } from './types'

interface Props {
  product: StoreProduct | null
  onClose: () => void
  onAddToCart: (p: StoreProduct, selectedVariants?: SelectedVariants) => void
  inCart: boolean
  addToCartLabel?: string
}

export function ProductDetailModal({ product, onClose, onAddToCart, inCart, addToCartLabel }: Props) {
  const [selectedVariants, setSelectedVariants] = useState<SelectedVariants>({})
  const [imageLoaded, setImageLoaded] = useState(false)
  const imgUrl = product?.images?.find((i) => i.isPrimary)?.url ?? product?.images?.[0]?.url ?? ''
  const hasImg = imgUrl && !imgUrl.startsWith('data:')
  const variantGroups = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const variant of product?.variants ?? []) {
      if (!variant.name || !variant.value) continue
      const values = groups.get(variant.name) ?? []
      if (!values.includes(variant.value)) values.push(variant.value)
      groups.set(variant.name, values)
    }
    return Array.from(groups.entries()).map(([name, values]) => ({ name, values }))
  }, [product])
  const hasVariants = variantGroups.length > 0
  const hasCompleteSelection = variantGroups.every((group) => selectedVariants[group.name])

  useEffect(() => {
    setSelectedVariants({})
    setImageLoaded(false)
  }, [product?.id])

  return (
    <AnimatePresence>
      {product && (
        <>
          <motion.div
            key="pdm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="store-cart-overlay"
            onClick={onClose}
          />

          <motion.div
            key="pdm-modal"
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="relative w-full max-w-2xl max-h-[calc(100vh-3rem)] overflow-hidden rounded-2xl border shadow-2xl"
              style={{ background:'var(--store-surface)', borderColor:'var(--store-border)' }}
            >
              <div className="max-h-[calc(100vh-3rem)] overflow-y-auto">
                <button
                  onClick={onClose}
                  className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border opacity-60 transition-opacity hover:opacity-100"
                  style={{ borderColor:'var(--store-border)', background:'var(--store-surface)', color:'var(--store-text)' }}
                  aria-label="Close product details"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="grid md:grid-cols-2">
                  <div className="relative aspect-square overflow-hidden" style={{ background:'var(--store-accent-soft)' }}>
                    {hasImg ? (
                      <>
                        <SafeImage
                          src={imgUrl}
                          alt={product.name}
                          fill
                          className={`object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                          priority
                          onLoad={() => setImageLoaded(true)}
                        />
                        {!imageLoaded && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-12 w-12 animate-pulse rounded-full bg-white/20" />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-5xl font-bold opacity-15" style={{ fontFamily:'var(--store-heading-font), serif', color:'var(--store-accent)' }}>
                          {product.name.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-4 p-6 md:p-8">
                    {product.category && (
                      <span className="store-eyebrow" style={{ color:'var(--store-accent)' }}>{product.category}</span>
                    )}
                    <h2
                      className="store-heading text-2xl font-black leading-tight text-balance"
                      style={{ fontFamily:'var(--store-heading-font), serif' }}
                    >
                      {product.name}
                    </h2>
                    {product.description && (
                      <p className="text-sm leading-relaxed" style={{ color:'var(--store-muted)' }}>
                        {product.description}
                      </p>
                    )}

                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-2xl font-extrabold"
                        style={{ fontFamily:'var(--store-heading-font), serif', color:'var(--store-accent)' }}
                      >
                        {product.currency} {Number(product.price).toFixed(2)}
                      </span>
                    </div>

                    {hasVariants && (
                      <div className="grid gap-3">
                        {variantGroups.map((group) => (
                          <div key={group.name} className="grid gap-2">
                            <div className="store-eyebrow" style={{ color:'var(--store-muted)' }}>{group.name}</div>
                            <div className="flex flex-wrap gap-2">
                              {group.values.map((value) => {
                                const selected = selectedVariants[group.name] === value
                                return (
                                  <button
                                    key={`${group.name}-${value}`}
                                    type="button"
                                    onClick={() => setSelectedVariants((prev) => ({ ...prev, [group.name]: value }))}
                                    className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                                    style={{
                                      borderColor: selected ? 'var(--store-accent)' : 'var(--store-border)',
                                      background: selected ? 'var(--store-accent-soft)' : 'transparent',
                                      color: selected ? 'var(--store-accent)' : 'var(--store-text)',
                                    }}
                                    aria-pressed={selected}
                                  >
                                    {value}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => {
                        if (!hasVariants || hasCompleteSelection) {
                          onAddToCart(product, hasVariants ? selectedVariants : undefined)
                          onClose()
                        }
                      }}
                      disabled={hasVariants && !hasCompleteSelection}
                      className="store-btn-primary mt-auto flex w-full items-center justify-center gap-2 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45"
                      style={{ background:'var(--store-cta-add-to-cart-bg)', color:'var(--store-cta-add-to-cart-text)', borderRadius:'var(--store-radius)' }}
                    >
                      {inCart
                        ? <><Check className="h-4 w-4" /> Added to cart</>
                        : <><ShoppingBag className="h-4 w-4" /> {addToCartLabel ?? 'Add to cart'}</>
                      }
                    </button>

                    <p className="text-center text-[0.68rem]" style={{ color:'var(--store-muted)' }}>
                      Secure checkout | Fast delivery
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

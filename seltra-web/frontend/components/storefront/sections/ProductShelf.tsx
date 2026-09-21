//seltra-web/frontend/components/storefront/sections/ProductShelf.tsx
'use client'
import { ProductCard } from './ProductCard'
import type { SelectedVariants, StoreProduct } from './types'

interface Props {
  section: { headline: string; subtext?: string; limit?: number }
  products: StoreProduct[]
  onAddToCart: (p: StoreProduct, selectedVariants?: SelectedVariants) => void
  storeName: string
  onViewDetail?: (p: StoreProduct) => void
  addToCartLabel?: string
}

export function ProductShelf({ section, products, onAddToCart, onViewDetail, addToCartLabel }: Props) {
  return (
    <section className="storefront-section overflow-hidden">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="store-heading text-[clamp(1.25rem,2.5vw,1.75rem)] font-bold">{section.headline}</h2>
          {section.subtext && <p className="mt-1 text-sm" style={{ color:'var(--store-muted)' }}>{section.subtext}</p>}
        </div>
        <span className="store-eyebrow opacity-40">Scroll →</span>
      </div>
      <div className="store-shelf-track">
        {products.slice(0, section.limit ?? 6).map((p, i) => (
          <div key={p.id} className="w-[clamp(150px,24vw,200px)] flex-shrink-0"><ProductCard product={p} showCategory={false} index={i} onAddToCart={onAddToCart} onViewDetail={onViewDetail} addToCartLabel={addToCartLabel} compact /></div>
        ))}
      </div>
    </section>
  )
}

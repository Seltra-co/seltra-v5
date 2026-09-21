//seltra-web/frontend/components/storefront/sections/ProductGrid.tsx
'use client'
import { useMemo } from 'react'
import { ProductCard, type ProductCardVariant } from './ProductCard'
import type { SelectedVariants, StoreProduct } from './types'

interface Props {
  section: { columns: 2 | 3 | 4; style: string; limit?: number; showCategory?: boolean; sectionLabel?: string }
  products: StoreProduct[]
  categories: string[]
  activeCategory: string
  onCategoryChange: (category: string) => void
  onAddToCart: (p: StoreProduct, selectedVariants?: SelectedVariants) => void
  onViewDetail?: (p: StoreProduct) => void
  addToCartLabel?: string
}

// P0 — multiple product card treatments, chosen from the manifest's grid
// style so it stays deterministic (no extra LLM call), not hand-picked per file.
const VARIANT_BY_STYLE: Record<string, ProductCardVariant> = {
  uniform: 'default',
  'featured-first': 'default',
  dense: 'overlay',
  magazine: 'editorial',
}

export function ProductGrid({ section, products, categories, activeCategory, onCategoryChange, onAddToCart, onViewDetail, addToCartLabel }: Props) {
  const uniqueCategories = useMemo(() => {
    return [...new Set(categories)]
  }, [categories])
  const filtered = activeCategory === 'All' ? products : products.filter((p) => p.category === activeCategory)
  const limited  = filtered.slice(0, section.limit ?? 9)
  const colClass = section.columns === 4 ? 'grid-cols-2 md:grid-cols-4' : section.columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-3'
  const variant = VARIANT_BY_STYLE[section.style] ?? 'default'

  return (
    <section className="storefront-section">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <span className="store-eyebrow" style={{ color:'var(--store-accent)' }}>
              {section.sectionLabel ?? 'Products'}
            </span>
            <h2 className="store-heading mt-2 text-[clamp(2rem,4vw,3.25rem)] font-black text-balance">
              {section.sectionLabel ?? 'The collection'}
            </h2>
          </div>
          <span className="store-eyebrow">{limited.length} items</span>
        </div>

        {uniqueCategories.length > 1 && (
          <div className="mb-7 flex flex-wrap gap-2">
            {['All', ...uniqueCategories].map((category) => {
              const active = activeCategory === category
              return (
                <button
                  key={category}
                  onClick={() => onCategoryChange(category)}
                  className="rounded-full border px-4 py-2 text-xs font-semibold transition-colors"
                  style={{
                    background: active ? 'var(--store-accent)' : 'var(--store-bg)',
                    borderColor: active ? 'var(--store-accent)' : 'var(--store-border)',
                    color: active ? 'var(--store-accent-text)' : 'var(--store-muted)',
                    borderRadius:'var(--store-radius-full)',
                  }}
                >
                  {category}
                </button>
              )
            })}
          </div>
        )}

        <div className={`grid gap-5 ${colClass}`}>
          {limited.map((p, i) => (
            <ProductCard
              key={p.id}
              product={p}
              showCategory={section.showCategory ?? true}
              index={i}
              isBestseller={i === 0}
              variant={variant}
              onAddToCart={onAddToCart}
              onViewDetail={onViewDetail}
              addToCartLabel={addToCartLabel}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

//seltra-web/frontend/components/storefront/sections/CategoryStrip.tsx
'use client'
import { useMemo } from 'react'
interface Props {
  categories: string[]
  headline?: string
  activeCategory: string
  onCategoryChange: (category: string) => void
}
export function CategoryStrip({ categories, headline, activeCategory, onCategoryChange }: Props) {
  if (!categories?.length) return null
  const displayCategories = useMemo(() => ['All', ...categories], [categories])
  return (
    <section className="storefront-section-tight overflow-x-auto border-b" style={{ borderColor:'var(--store-border)' }}>
      {headline && <span className="store-eyebrow mb-2 block">{headline}</span>}
      <div className="flex gap-2">
        {displayCategories.map((cat) => {
          const active = activeCategory === cat
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onCategoryChange(cat)}
              className="whitespace-nowrap rounded-full border px-3.5 py-1 text-[0.72rem] font-medium transition-all"
              style={{
                borderColor: active ? 'var(--store-accent)' : 'var(--store-border)',
                color: active ? 'var(--store-accent)' : 'var(--store-muted)',
                background: active ? 'var(--store-accent-soft)' : 'transparent',
              }}
            >
              {cat}
            </button>
          )
        })}
      </div>
    </section>
  )
}

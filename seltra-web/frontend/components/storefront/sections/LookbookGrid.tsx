//seltra-web/frontend/components/storefront/sections/LookbookGrid.tsx
'use client'
import { motion } from 'framer-motion'
import { SafeImage } from './SafeImage'
import type { SelectedVariants, StoreProduct } from './types'
import { isValidImageUrl } from './utils'

interface Props { headline?: string; images?: Array<{ url: string; caption?: string }>; variant?: 'masonry'|'editorial'|'uniform'; products: StoreProduct[]; onAddToCart: (p: StoreProduct, selectedVariants?: SelectedVariants) => void }

export function LookbookGrid({ headline, images, variant='editorial', products }: Props) {
  const productImgs = products.flatMap((p) => (p.images??[]).map((img) => ({ url:img.url, caption:p.name }))).filter((i) => isValidImageUrl(i.url)).slice(0,6)
  const validImages = images?.filter((i) => isValidImageUrl(i.url)) ?? []
  const display = validImages.length ? validImages : productImgs
  if (!display.length) return null
  const gridClass = variant==='masonry' ? 'columns-2 md:columns-3 gap-2' : 'grid gap-2 grid-cols-2 md:grid-cols-3'
  return (
    <section className="storefront-section border-t" style={{ borderColor:'var(--store-border)' }}>
      {headline && <h2 className="store-heading mb-6 text-[clamp(1.5rem,3vw,2rem)] font-bold">{headline}</h2>}
      <div className={gridClass}>
        {display.map((img, i) => (
          <motion.div key={i} initial={{ opacity:0 }} whileInView={{ opacity:1 }} viewport={{ once:true }} transition={{ duration:0.5, delay:i*0.05 }} className={`relative overflow-hidden rounded-[var(--store-radius)] ${variant==='masonry'?'mb-2 break-inside-avoid':'aspect-square'}`}>
            <SafeImage src={img.url} alt={img.caption??''} fill className="object-cover" sizes="33vw" />
          </motion.div>
        ))}
      </div>
    </section>
  )
}

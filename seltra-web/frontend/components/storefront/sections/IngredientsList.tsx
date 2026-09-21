//seltra-web/frontend/components/storefront/sections/IngredientsList.tsx
'use client'
import { motion } from 'framer-motion'

const DEFAULT = [{ name:'Shea Butter',benefit:'Deep moisturisation and skin repair' },{ name:'Vitamin C',benefit:'Brightening and antioxidant protection' },{ name:'Aloe Vera',benefit:'Soothing, cooling, and hydrating' },{ name:'Hyaluronic Acid',benefit:'Plumps and retains moisture' }]

export function IngredientsList({ headline='What goes in', items }: { headline?: string; items?: Array<{ name: string; benefit: string }> }) {
  const list = items?.length ? items : DEFAULT
  return (
    <section className="storefront-section border-t" style={{ borderColor:'var(--store-border)' }}>
      <h2 className="store-heading mb-6 text-[clamp(1.5rem,3vw,2rem)] font-bold">{headline}</h2>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {list.map((item, i) => (
          <motion.div key={i} initial={{ opacity:0, y:12 }} whileInView={{ opacity:1, y:0 }} viewport={{ once:true }} transition={{ duration:0.4, delay:i*0.06 }} className="rounded-[var(--store-radius)] border p-4" style={{ borderColor:'var(--store-border)', background:'var(--store-surface)' }}>
            <div className="mb-2 text-xl" style={{ color:'var(--store-accent)' }}>◈</div>
            <div className="mb-1 text-sm font-bold" style={{ color:'var(--store-text)' }}>{item.name}</div>
            <div className="text-[0.73rem] leading-relaxed" style={{ color:'var(--store-muted)' }}>{item.benefit}</div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

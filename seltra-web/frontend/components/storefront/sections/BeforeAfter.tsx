//seltra-web/frontend/components/storefront/sections/BeforeAfter.tsx
'use client'
export function BeforeAfter({ headline, beforeLabel='Before', afterLabel='After' }: { headline?: string; beforeLabel?: string; afterLabel?: string }) {
  return (
    <section className="storefront-section border-t" style={{ borderColor:'var(--store-border)' }}>
      {headline && <h2 className="store-heading mb-6 text-[clamp(1.5rem,3vw,2rem)] font-bold">{headline}</h2>}
      <div className="grid gap-4 sm:grid-cols-2">
        {[{ label:beforeLabel, dim:true },{ label:afterLabel, dim:false }].map(({ label, dim }) => (
          <div key={label} className="flex aspect-[4/3] items-end rounded-[var(--store-radius)] p-4" style={{ background:dim?'var(--store-border)':'var(--store-accent-soft)' }}>
            <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background:dim?'var(--store-muted)':'var(--store-accent)', color:dim?'var(--store-bg)':'var(--store-accent-text)' }}>{label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

//seltra-web/frontend/components/storefront/sections/FounderStory.tsx
'use client'
export function FounderStory({ founderName, story, storeName, variant='portrait-left' }: { founderName?: string; story?: string; storeName: string; variant?: string }) {
  return (
    <section className="storefront-section border-t" style={{ borderColor:'var(--store-border)' }}>
      <div className={`flex flex-col gap-8 ${variant!=='minimal'?'sm:flex-row':''} ${variant==='portrait-right'?'sm:flex-row-reverse':''}`}>
        {variant!=='minimal' && <div className="aspect-square w-full rounded-[var(--store-radius)] sm:w-64 sm:flex-shrink-0" style={{ background:'var(--store-accent-soft)' }} />}
        <div className="flex flex-col justify-center gap-3">
          <span className="store-eyebrow">The founder</span>
          <h2 className="store-heading text-[clamp(1.5rem,3vw,2.25rem)] font-bold">{founderName ?? `The story behind ${storeName}`}</h2>
          <p className="max-w-prose text-[0.9375rem] leading-[1.85]" style={{ color:'var(--store-muted)' }}>{story ?? `${storeName} was built with care, craft, and a genuine belief that quality matters. Every product reflects that commitment.`}</p>
        </div>
      </div>
    </section>
  )
}

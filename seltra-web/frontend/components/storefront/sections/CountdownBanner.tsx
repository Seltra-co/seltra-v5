//seltra-web/frontend/components/storefront/sections/CountdownBanner.tsx
'use client'
export function CountdownBanner({ message='Limited time offer — shop now before it ends.' }: { message?: string }) {
  return <div className="overflow-hidden py-2 text-center text-[0.72rem] font-semibold" style={{ background:`color-mix(in srgb, var(--store-accent) 15%, var(--store-bg))`, color:'var(--store-accent)', borderBottom:'1px solid var(--store-border)' }}>{message}</div>
}

//seltra-web/frontend/components/storefront/sections/AnnouncementBar.tsx
'use client'
export function AnnouncementBar({ message }: { message: string }) {
  return (
    <div className="overflow-hidden py-2 text-[0.7rem] font-semibold tracking-wide" style={{ background:'var(--store-accent)', color:'var(--store-accent-text)' }}>
      <div className="store-announce-track">
        {[...Array(4)].map((_, i) => <span key={i} className="flex items-center gap-4"><span className="inline-block h-1 w-1 rounded-full bg-current opacity-50" />{message}</span>)}
      </div>
    </div>
  )
}

import { cn } from '@/lib/utils'

export function SlashDivider({ count = 24, className }: { count?: number; className?: string }) {
  return (
    <p
      aria-hidden
      className={cn('select-none overflow-hidden whitespace-nowrap font-mono text-[12px] leading-none tracking-[-0.02em] text-[#22c55e]/80', className)}
    >
      {'/'.repeat(count)}
    </p>
  )
}

import { cn } from '@/lib/utils'

export function BackgroundMark({
  tone = 'dark',
  className,
}: {
  tone?: 'dark' | 'light'
  className?: string
}) {
  return (
    <img
      src="/assets/brand/mark.png"
      alt=""
      aria-hidden
      className={cn('page-mark absolute', tone === 'light' ? 'page-mark-light' : 'page-mark-dark', className)}
    />
  )
}

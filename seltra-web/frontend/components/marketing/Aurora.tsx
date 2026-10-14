import { cn } from '@/lib/utils'

export function Aurora({ tone = 'light' }: { tone?: 'hero' | 'light' | 'dark' | 'cta' }) {
  return (
    <div className={cn('landing-aurora', `landing-aurora-${tone}`)} aria-hidden>
      <span className="aurora-orb orb-a" />
      <span className="aurora-orb orb-b" />
      <span className="aurora-orb orb-c" />
      {tone === 'hero' || tone === 'cta' ? <span className="aurora-orb orb-d" /> : null}
      <span className="landing-grain" />
    </div>
  )
}

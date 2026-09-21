//seltra-web/frontend/components/storefront/sections/TrustBar.tsx
'use client'
import {
  Leaf, Droplets, Sparkles, Heart,
  Flame, Clock, Star, ShoppingBag,
  Shield, Truck, RefreshCw, MapPin,
  Gem, Award, Wrench, Zap,
  Package, CheckCircle, Lock, Headphones,
} from 'lucide-react'

const INDUSTRY_ICONS: Record<string, Array<React.ElementType>> = {
  beauty:      [Leaf, Droplets, Sparkles, Heart],
  skincare:    [Droplets, Leaf, Sparkles, Shield],
  food:        [Flame, Clock, Leaf, Star],
  restaurant:  [Flame, Clock, Star, MapPin],
  jewelry:     [Gem, Award, Shield, Sparkles],
  streetwear:  [Zap, Package, Shield, Truck],
  fashion:     [Sparkles, Heart, RefreshCw, Truck],
  wellness:    [Leaf, Heart, Sparkles, Shield],
  electronics: [Zap, Shield, Truck, Wrench],
  artisan:     [Heart, Leaf, Award, Sparkles],
  logistics:   [Truck, MapPin, Clock, Shield],
  general:     [Lock, Truck, RefreshCw, Headphones],
}

function detectIconSet(items: string[]): Array<React.ElementType> {
  const corpus = items.join(' ').toLowerCase()
  if (/organic|natural|ingredient|botanical|serum|skin|glow/.test(corpus)) return INDUSTRY_ICONS.skincare
  if (/fresh|delivery|same.day|kitchen|food|meal|bake/.test(corpus)) return INDUSTRY_ICONS.food
  if (/gold|gem|diamond|hallmark|jewel/.test(corpus)) return INDUSTRY_ICONS.jewelry
  if (/drop|hype|limited|sneaker|urban/.test(corpus)) return INDUSTRY_ICONS.streetwear
  if (/handmade|craft|artisan|small.batch/.test(corpus)) return INDUSTRY_ICONS.artisan
  if (/warranty|repair|device|tech/.test(corpus)) return INDUSTRY_ICONS.electronics
  if (/tracking|courier|freight|fleet|shipment|dispatch|coverage/.test(corpus)) return INDUSTRY_ICONS.logistics
  return INDUSTRY_ICONS.general
}

export function TrustBar({ items, industry }: { items: string[]; industry?: string }) {
  const safe = items?.length ? items : ['Secure checkout', 'Fast delivery', 'Easy returns', 'Local support']

  const iconKey = industry && INDUSTRY_ICONS[industry] ? industry : null
  const icons = iconKey ? INDUSTRY_ICONS[iconKey] : detectIconSet(safe)

  return (
    <section
      className="storefront-section-tight border-y"
      style={{ borderColor: 'var(--store-border)', background: 'var(--store-surface)' }}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4 sm:gap-x-10">
        {safe.map((item, i) => {
          const Icon = icons[i % icons.length]
          return (
            <div key={item} className="flex flex-col items-center gap-2 text-center">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: 'var(--store-accent-soft)' }}
              >
                <Icon
                  className="h-4.5 w-4.5"
                  style={{ color: 'var(--store-accent)', width: '1.125rem', height: '1.125rem' }}
                  strokeWidth={1.5}
                />
              </div>
              <span
                className="text-[0.72rem] font-semibold leading-tight"
                style={{ color: 'var(--store-text)' }}
              >
                {item}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
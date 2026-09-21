//seltra-web/frontend/components/storefront/StorefrontPreview.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { StorefrontCanvas } from './StorefrontCanvas'
import { useStore } from '@/context/StoreContext'
import type { StoreManifest } from './sections/types'

export type StoreData = {
  id?: string; name: string; slug: string; businessType?: string; targetAudience?: string
  country?: string | null
  preferences?: { region?: string; language?: string; dismissedAnnouncements?: string[] } | null
  payoutMethod?: string | null; payoutProvider?: string | null; payoutProviderCode?: string | null
  payoutAccount?: string | null; payoutAccountName?: string | null; payoutValidatedAt?: string | null
  heroTitle?: string; heroSubtitle?: string
  canonical?: { brandName?: string; businessName?: string; storeFeatures?: string[]; productCategories?: string[]; layoutVariant?: string; recommendedTechStack?: { paymentGateways?: string[] }; heroImageUrl?: string; storyImageUrl?: string; logoUrl?: string; heroSpec?: { imageTreatment?: string } }
  shippingZones?: Array<{ name: string; metadata?: { content?: string } | null }>
  storeDNA?: { brandPersonality?: string; industry?: string }
  products?: Array<{ id: string; name: string; description?: string | null; price: string | number; currency?: string; category?: string | null; images?: Array<{ url: string; isPrimary?: boolean }>; variants?: Array<{ name: string; value: string }> }>
  manifest?: StoreManifest | null
  heroSource?: string | null
  navSource?: string | null
  storefrontCode?: string | null; storefrontVersion?: number
  fulfillmentMode?: 'delivery' | 'pickup' | 'both' | null
  contactPhone?: string | null
  pickupAddress?: string | null
  pickupInstructions?: string | null
  deliveryDays?: string | null
  deliveryEstimate?: string | null
  deliveryFeeNote?: string | null
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

function fallback(slug: string): StoreData {
  const name = slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return {
    id: `fallback-${slug}`, name, slug, businessType: 'AI-built storefront',
    targetAudience: 'modern shoppers', heroTitle: name, heroSubtitle: 'A polished storefront.',
    canonical: { storeFeatures: ['Fast checkout','Curated catalog','Local delivery','AI merchandising'], productCategories: ['Starter','Signature','Gift'], recommendedTechStack: { paymentGateways: ['Moolre'] } },
    products: [
      { id: `${slug}-1`, name: 'Signature Starter Set', description: 'A ready-to-launch bundle.', price: 49, currency: 'GHS', category: 'Signature' },
      { id: `${slug}-2`, name: 'Daily Essential', description: 'Your hero product.', price: 28, currency: 'GHS', category: 'Starter' },
      { id: `${slug}-3`, name: 'Gift Box', description: 'A premium giftable option.', price: 72, currency: 'GHS', category: 'Gift' },
    ],
    fulfillmentMode: 'delivery',
  }
}

export default function StorefrontPreview({
  storeSlug,
  suppressFallback = false,
  rev = 0,
}: {
  storeSlug: string
  suppressFallback?: boolean
  rev?: number
}) {
  const { activeStore } = useStore()

  const [store, setStore] = useState<StoreData | null>(null)
  const [loading, setLoading] = useState(true)

  const pollCount   = useRef(0)
  const pollTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchedSlug = useRef<string | null>(null)
  const lastRev     = useRef(0)

  useEffect(() => {
    if (suppressFallback && !activeStore) {
      fetchedSlug.current = null
      lastRev.current = rev
      pollCount.current = 0
      if (pollTimer.current) clearTimeout(pollTimer.current)
      setStore(null)
      setLoading(false)
      return
    }

    // Skip re-fetch if nothing meaningful changed
    const slugUnchanged = fetchedSlug.current === storeSlug
    const revUnchanged  = rev === lastRev.current
    if (slugUnchanged && store !== null && revUnchanged) return

    // Record what we're fetching so next render can skip if nothing changed
    fetchedSlug.current = storeSlug
    lastRev.current     = rev

    let cancelled = false
    pollCount.current = 0

    const load = async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/seltra/store/${encodeURIComponent(storeSlug)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        )
        if (!cancelled && res.ok) {
          const d = await res.json()
          setStore(d)
          setLoading(false)
          // Keep polling until the manifest and generated micro-sources are visible.
          if ((!d.manifest || !d.heroSource || !d.navSource) && pollCount.current < 20) {
            pollCount.current++
            if (pollTimer.current) clearTimeout(pollTimer.current)
            pollTimer.current = setTimeout(() => { if (!cancelled) void load() }, 3000)
          }
        } else if (!cancelled) {
          if (!suppressFallback) {
            const as = activeStore as StoreData | null
            setStore(as?.slug === storeSlug ? as : fallback(storeSlug))
          }
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          if (!suppressFallback) setStore(fallback(storeSlug))
          setLoading(false)
        }
      }
    }

    // Only show the spinner on first load, not on rev-bump refreshes
    if (!store) setLoading(true)
    void load()

    return () => {
      cancelled = true
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [storeSlug, rev, suppressFallback, activeStore]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !store) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
          <div className="font-mono text-xs text-muted-foreground">building storefront...</div>
        </div>
      </div>
    )
  }

  if (!store || (suppressFallback && !activeStore)) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center text-sm text-muted-foreground">
          <div className="mb-2 font-mono text-xs text-primary">{'// ready'}</div>
          Describe your store to get started.
        </div>
      </div>
    )
  }

  const themeKey =
    store.storeDNA?.brandPersonality === 'luxury' ? 'luxury' :
    store.canonical?.layoutVariant === 'bold' ? 'bold-dark' :
    store.canonical?.layoutVariant === 'editorial' ? 'editorial' : 'minimal-light'

  return <StorefrontCanvas store={store} storeSlug={storeSlug} themeKey={themeKey} />
}

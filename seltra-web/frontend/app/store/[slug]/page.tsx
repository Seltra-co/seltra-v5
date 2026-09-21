//seltra-web/frontend/app/store/[slug]/page.tsx
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { StorefrontCanvas } from '@/components/storefront/StorefrontCanvas'

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001'

async function getStore(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/seltra/store/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } })
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

type StoreRouteProps = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: StoreRouteProps): Promise<Metadata> {
  const { slug } = await params
  const store = await getStore(slug)
  if (!store) return {}

  const displayName = store.brandName?.trim() || store.name
  const description = store.targetAudience
    ? `${displayName} — ${store.businessType ?? 'shop online'} for ${store.targetAudience}.`
    : `Shop ${displayName} online.`

  const heroImage = store.canonical?.heroImageUrl
    ?? store.products?.find((product: { images?: Array<{ isPrimary?: boolean; url?: string }> }) => product.images?.some((image: { isPrimary?: boolean; url?: string }) => image.isPrimary))?.images?.find((image: { isPrimary?: boolean; url?: string }) => image.isPrimary)?.url
    ?? store.products?.[0]?.images?.[0]?.url

  return {
    title: displayName,
    description,
    openGraph: {
      title: displayName,
      description,
      url: `https://${store.slug}.seltra.co`,
      siteName: displayName,
      images: heroImage ? [{ url: heroImage, width: 1200, height: 630 }] : undefined,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: displayName,
      description,
      images: heroImage ? [heroImage] : undefined,
    },
    alternates: {
      canonical: `https://${store.slug}.seltra.co`,
    },
  }
}

function Skeleton() {
  return (
    <div className="min-h-screen animate-pulse" style={{ background: '#fafafa' }}>
      <div className="h-14 border-b border-gray-100 bg-white" />
      <div className="flex h-[60vh] items-center justify-center bg-gray-50">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-gray-400" />
      </div>
    </div>
  )
}

function fallback(slug: string) {
  const name = slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return {
    id: `fallback-${slug}`, name, slug,
    businessType: 'AI-built storefront', targetAudience: 'modern shoppers',
    heroTitle: name, heroSubtitle: 'A polished storefront.',
    canonical: { storeFeatures: ['Fast checkout','Curated catalog','Local delivery','AI merchandising'], productCategories: ['Starter','Signature','Gift'], recommendedTechStack: { paymentGateways: ['Moolre'] } },
    products: [
      { id:`${slug}-1`, name:'Signature Starter Set', description:'A ready-to-launch bundle.',  price: 49, currency:'GHS', category:'Signature' },
      { id:`${slug}-2`, name:'Daily Essential',        description:'Your hero product.',         price: 28, currency:'GHS', category:'Starter'   },
      { id:`${slug}-3`, name:'Gift Box',               description:'A premium giftable option.', price: 72, currency:'GHS', category:'Gift'      },
    ],
  }
}

export default async function StorefrontPage({ params }: StoreRouteProps) {
  const { slug } = await params
  const store = (await getStore(slug)) ?? fallback(slug)
  const dna  = (store as { storeDNA?: { brandPersonality?: string } }).storeDNA
  const cv   = (store as { canonical?: { layoutVariant?: string } }).canonical
  const themeKey =
    dna?.brandPersonality === 'luxury'    ? 'luxury'
    : cv?.layoutVariant   === 'bold'      ? 'bold-dark'
    : cv?.layoutVariant   === 'editorial' ? 'editorial'
    : 'minimal-light'

  return (
    <Suspense fallback={<Skeleton />}>
      <StorefrontCanvas store={store} storeSlug={slug} minHeightClass="min-h-screen" themeKey={themeKey} />
    </Suspense>
  )
}

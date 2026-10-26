/** Typed public commerce client for generated Seltra storefronts. */
const apiBase = (import.meta.env.VITE_SELTRA_API_URL || 'https://api.seltra.co/api/v1').replace(/\/$/, '')
const storeSlug = import.meta.env.VITE_SELTRA_STORE_SLUG

export interface SeltraStore {
  id: string
  name: string
  slug: string
  businessType: string | null
  country: string | null
  currency: string
  fulfillment: {
    mode: string | null
    contactPhone: string | null
    pickupAddress: string | null
    pickupInstructions: string | null
    deliveryDays: string | null
    deliveryEstimate: string | null
    deliveryFeeNote: string | null
    tiers: unknown
  }
}

export interface SeltraProduct {
  id: string
  name: string
  description: string | null
  price: string
  currency: string
  category: string | null
  sku: string | null
  tags: unknown
  images: Array<{ id: string; url: string; isPrimary: boolean }>
  variants: Array<{ id: string; name: string; value: string }>
}

export interface SeltraCategory { id: string; name: string; productCount: number }
export interface SeltraShipping {
  fulfillmentMode: string | null
  zones: Array<{ id: string; name: string; deliveryTime: string | null; fee: string | null; metadata: unknown }>
  deliveryTiers: unknown
  deliveryDays: string | null
  deliveryEstimate: string | null
}
export interface CheckoutInput {
  customerEmail: string
  customerName?: string
  customerPhone?: string
  items: Array<{ productId: string; quantity: number }>
  callbackUrl?: string
}
export interface CheckoutResult {
  success: boolean
  message?: string
  reference?: string
  authorizationUrl?: string
  accessCode?: string
  totalAmount: number
  currency: string
  items: Array<{ productId: string; name: string; unitPrice: string; quantity: number }>
}
export interface SeltraOrder {
  id: string
  status: string
  totalAmount: string
  currency: string
  items: unknown[]
  createdAt: string
  updatedAt: string
  trackingNumber: string | null
}

function slugOrThrow() {
  if (!storeSlug) throw new Error('VITE_SELTRA_STORE_SLUG is required for Seltra commerce')
  return encodeURIComponent(storeSlug)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message
    throw new Error(message || `Seltra API returned ${response.status}`)
  }
  return response.json() as Promise<T>
}

const root = () => `/storefront/${slugOrThrow()}`

export const seltraCommerce = {
  getStore: () => request<SeltraStore>(`${root()}/store`),
  getProducts: (category?: string) => request<SeltraProduct[]>(`${root()}/products${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  getCategories: () => request<SeltraCategory[]>(`${root()}/categories`),
  getShipping: () => request<SeltraShipping>(`${root()}/shipping`),
  checkout: (input: CheckoutInput) => request<CheckoutResult>(`${root()}/checkout`, { method: 'POST', body: JSON.stringify(input) }),
  confirmCheckout: (reference: string) => request<{ success: boolean; orderId?: string; message?: string; reference: string }>(`${root()}/orders/confirm`, { method: 'POST', body: JSON.stringify({ reference }) }),
  getOrder: (orderId: string, customerEmail: string) => request<SeltraOrder>(`${root()}/orders/${encodeURIComponent(orderId)}?email=${encodeURIComponent(customerEmail)}`),
}

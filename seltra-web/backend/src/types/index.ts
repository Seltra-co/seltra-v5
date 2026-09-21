//seltra-web/backend/src/types/index.ts
export interface CanonicalStore {
  storeId: string
  prompt: string
  brandName: string
  brandVoice: string
  businessName: string
  businessType: string
  targetAudience: string
  storeSlug: string
  platform: 'Seltra'
  estimatedLaunchTime: string
  productCategories: string[]
  storeFeatures: string[]
  recommendedTechStack: {
    paymentGateways: string[]
    shippingIntegration: string
    frontend: string
    backend: string
    database: string
    analytics: string
  }
  additionalRecommendations: {
    marketing: string[]
    customerService: string[]
    logistics: string[]
    growthStrategy: string[]
  }
}

export interface GeneratedProduct {
  name: string
  description: string
  price: number
  currency: string
  category: string
  sku: string
  tags: string[]
  variants: Array<{ name: string; value: string }>
  images: Array<{ url: string; isPrimary: boolean }>
}

export interface BuildStoreRequest {
  prompt: string
}

export interface BuildStoreResponse {
  success: boolean
  tenantId?: string
  storeUrl?: string
  blueprint?: CanonicalStore
  products?: GeneratedProduct[]
  error?: string
}

export interface SSEEvent {
  step: string
  status: 'started' | 'completed' | 'error'
  message: string
  data?: unknown
}
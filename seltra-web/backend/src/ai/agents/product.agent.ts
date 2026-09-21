//ai/agents/product.agent.ts
import { chat } from '../client'
import type { CanonicalStore, GeneratedProduct } from '../../types'
import { sourceImage } from './image-sourcing.agent'
import { planLimits } from '../../common/plan-limits'
import type { StoreDNA } from '../../types/store-dna'
import { cleanJSON, repairTruncatedJSON } from '../utils/json-repair.util'

const BATCH_SIZE = 15

function buildProductSystemPrompt(count: number): string {
  return `You are Seltra's Product Generator AI. Creator: Seltra Inc.
Given a store blueprint, generate a realistic product catalog.

Rules:
1. Generate exactly ${count} products.
2. Return ONLY a valid JSON array. No markdown, no explanation, no code blocks.
3. Use GHS (Ghanaian Cedi) as the currency.
4. Prices must be realistic for the Ghanaian/African market.
5. Each product must follow this exact structure:

[
  {
    "name": "string",
    "description": "string (2-3 sentences of compelling product copy)",
    "price": number,
    "currency": "GHS",
    "category": "string (must match one of the store's productCategories)",
    "sku": "string (e.g. SKU-001)",
    "tags": ["string", "string"],
    "variants": [
      { "name": "Size", "value": "Small" },
      { "name": "Size", "value": "Medium" },
      { "name": "Size", "value": "Large" }
    ]
  }
]`
}

const BASE_NAMES = [
  'Starter Set', 'Daily Essential', 'Signature Bundle', 'Premium Kit',
  'Travel Pack', 'Gift Box', 'Limited Drop', 'Refill Pack',
  'Discovery Kit', 'Luxury Edition', 'Mini Collection', 'Value Pack',
  'Seasonal Special', 'Core Essential', 'Pro Bundle', 'Sample Set',
  'Bestseller Box', 'New Arrival', 'Classic Set', 'Exclusive Drop',
]

function fallbackProducts(blueprint: CanonicalStore, count: number, startIndex = 0): GeneratedProduct[] {
  const categories = blueprint.productCategories.length > 0 ? blueprint.productCategories : ['Featured']
  const brand = blueprint.brandName || blueprint.businessName.split(' ').slice(0, 2).join(' ')

  return Array.from({ length: count }, (_, i) => {
    const index = startIndex + i
    const category = categories[index % categories.length]
    const cycle = Math.floor(index / BASE_NAMES.length)
    const baseName = BASE_NAMES[index % BASE_NAMES.length]
    const name = cycle > 0 ? `${baseName} ${cycle + 1}` : baseName
    return {
      name: `${brand} ${name}`,
      description: `A customer-ready ${category.toLowerCase()} product for ${blueprint.targetAudience}. Designed as part of the first Seltra-generated catalog.`,
      price: 45 + (index % 20) * 8,
      currency: 'GHS',
      category,
      sku: `SKU-${String(index + 1).padStart(3, '0')}`,
      tags: ['generated', category],
      variants: [
        { name: 'Option', value: 'Standard' },
        { name: 'Option', value: 'Premium' },
      ],
    } as GeneratedProduct
  })
}

async function attachProductImages(
  products: GeneratedProduct[],
  dna?: StoreDNA,
  onImage?: (url: string, index: number) => void,
) {
  console.log(`[ProductAgent] Resolving product images for ${products.length} products...`)

  const imageUrls: string[] = []
  const batchSize = 3
  const maxStreamed = 5
  let streamed = 0

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize)
    const urls = await Promise.all(
      batch.map((product) => sourceImage(product.name, product.category, dna)),
    )
    imageUrls.push(...urls)

    for (const url of urls) {
      if (!url) continue
      if (streamed < maxStreamed) {
        onImage?.(url, streamed)
        streamed += 1
      }
    }

    if (i + batchSize < products.length) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  const productsWithImages = products.map((product, i) => ({
    ...product,
    price: typeof product.price === 'string' ? parseFloat(product.price) : product.price,
    images: [{ url: imageUrls[i], isPrimary: true }],
  }))

  const generated = productsWithImages.filter((p) => !!p.images?.[0]?.url).length
  console.log(`[ProductAgent] Done - ${generated}/${products.length} product images`)

  return {
    products: productsWithImages,
    imageStats: { total: products.length, generated, failed: products.length - generated },
  }
}

// Generates one LLM batch of `count` products (count <= BATCH_SIZE), with its
// own truncation-repair path. Returns deterministic fallback products for
// just this batch on unrecoverable failure, so a bad batch never nukes the
// whole catalog.
async function generateBatch(
  blueprint: CanonicalStore,
  count: number,
  startIndex: number,
  retry = false,
): Promise<{ products: GeneratedProduct[]; provider: string }> {
  let llmResult
  try {
    llmResult = await chat([
      {
        role: 'user',
        content:
          `${buildProductSystemPrompt(count)}\n\n` +
          `Store: ${blueprint.businessName}\n` +
          `Type: ${blueprint.businessType}\n` +
          `Target Audience: ${blueprint.targetAudience}\n` +
          `Categories: ${blueprint.productCategories.join(', ')}\n\n` +
          `Generate ${count} realistic products for this store. This is batch starting at item ${startIndex + 1} — do not repeat names from earlier batches.`,
      },
    ], { maxTokens: Math.min(12000, 1200 + count * 560), temperature: 0.2 })
  } catch (error) {
    console.warn(`[ProductAgent] Batch at index ${startIndex} LLM call failed, using deterministic fallback for this batch:`, error)
    return { products: fallbackProducts(blueprint, count, startIndex), provider: 'fallback' }
  }

  const cleaned = cleanJSON(llmResult.content)
  let rawProducts: GeneratedProduct[]
  try {
    rawProducts = JSON.parse(cleaned)
  } catch {
    try {
      rawProducts = JSON.parse(repairTruncatedJSON(cleaned))
      console.warn(`[ProductAgent] Batch at index ${startIndex} JSON repaired after truncation — recovered ${Array.isArray(rawProducts) ? rawProducts.length : 0} products`)
    } catch {
      console.warn(`[ProductAgent] Batch at index ${startIndex} JSON unrecoverable — raw snippet:`, cleaned.slice(0, 300))
      return { products: fallbackProducts(blueprint, count, startIndex), provider: 'fallback' }
    }
  }

  if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
    return { products: fallbackProducts(blueprint, count, startIndex), provider: 'fallback' }
  }

  if (rawProducts.length < count && !retry) {
    console.warn(`[ProductAgent] Batch at index ${startIndex} returned ${rawProducts.length}/${count}; retrying the full batch`)
    return generateBatch(blueprint, count, startIndex, true)
  }

  return { products: rawProducts.slice(0, count), provider: llmResult.provider }
}

export async function generateProducts(
  blueprint: CanonicalStore,
  maxProducts: number = planLimits(undefined).maxProductsPerStore,
  dna?: StoreDNA,
  onImage?: (url: string, index: number) => void,
): Promise<{
  success: boolean
  products: GeneratedProduct[]
  provider: string
  imageStats: { total: number; generated: number; failed: number }
  error: string | null
}> {
  const count = Math.max(1, maxProducts)

  if (process.env.SELTRA_LLM_PRODUCTS !== 'true') {
    const { products, imageStats } = await attachProductImages(fallbackProducts(blueprint, count), dna, onImage)
    return { success: true, products, provider: 'deterministic', imageStats, error: null }
  }

  const batchCount = Math.ceil(count / BATCH_SIZE)
  const allProducts: GeneratedProduct[] = []
  const providersUsed = new Set<string>()

  for (let b = 0; b < batchCount; b++) {
    const startIndex = b * BATCH_SIZE
    const thisBatchSize = Math.min(BATCH_SIZE, count - startIndex)
    const { products, provider } = await generateBatch(blueprint, thisBatchSize, startIndex)
    allProducts.push(...products)
    providersUsed.add(provider)
    console.log(`[ProductAgent] Batch ${b + 1}/${batchCount} done — ${products.length} products via ${provider}`)
  }

  const capped = allProducts.slice(0, count)
  if (capped.length < count) {
    const missing = count - capped.length
    console.warn(`[ProductAgent] Product generation ended at ${capped.length}/${count}; filling ${missing} missing products deterministically`)
    capped.push(...fallbackProducts(blueprint, missing, capped.length))
  }
  const { products: productsWithImages, imageStats } = await attachProductImages(capped, dna, onImage)

  return {
    success: true,
    products: productsWithImages,
    provider: [...providersUsed].join(','),
    imageStats,
    error: null,
  }
}
//backend/src/ai/agents/merchants-context.ts
// Merchant context — persisted per tenant, read by the agent before every reply.
// Tracks preferences, vocabulary, recent intents, and store fingerprint.
// Zero LLM tokens to build — rule-based extraction only.

import { prisma } from '../../db'

export interface MerchantContext {
  // Store identity
  tenantId: string
  storeName: string
  industry: string
  brandPersonality: string

  // Merchant preferences inferred from conversation
  tonePreference: 'formal' | 'casual' | 'playful' | 'minimal' // detected from their messages
  priceRange: { min: number; max: number }
  preferredCurrency: string

  // Running summary of intents
  recentIntents: string[] // last 6 unique intents e.g. ['update_price', 'change_hero_color']
  keyPhrases: string[]    // brand/product words they use repeatedly

  // What the agent has done
  lastAction?: string
  lastActionAt?: string

  updatedAt: string
}

function detectTone(messages: string[]): MerchantContext['tonePreference'] {
  const corpus = messages.join(' ').toLowerCase()
  if (/please|kindly|would you|could you/.test(corpus)) return 'formal'
  if (/lol|haha|cool|nice|great|awesome/.test(corpus)) return 'casual'
  if (/fun|bright|pop|bold|vibrant|colorful/.test(corpus)) return 'playful'
  return 'minimal'
}

function extractKeyPhrases(messages: string[]): string[] {
  const corpus = messages.join(' ')
  // Extract capitalised words (likely brand/product names)
  const caps = corpus.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? []
  // Extract quoted phrases
  const quoted = corpus.match(/["']([^"']{2,30})["']/g)?.map(q => q.replace(/["']/g, '')) ?? []
  const all = [...new Set([...caps, ...quoted])]
  return all.filter(w => !['The', 'I', 'My', 'We', 'Our', 'Can', 'Please', 'Make', 'Add', 'Update', 'Change'].includes(w)).slice(0, 12)
}

function extractIntents(message: string): string[] {
  const lower = message.toLowerCase()
  const intents: string[] = []
  if (/price|cost|ghs|cedis|\d+/.test(lower)) intents.push('update_price')
  if (/color|colour|background|dark|light|theme/.test(lower)) intents.push('update_theme')
  if (/hero|headline|banner|tagline/.test(lower)) intents.push('update_hero')
  if (/add product|new product|create product/.test(lower)) intents.push('add_product')
  if (/delete|remove|get rid/.test(lower)) intents.push('delete_item')
  if (/description|copy|text|words/.test(lower)) intents.push('update_copy')
  if (/image|photo|picture/.test(lower)) intents.push('update_image')
  if (/layout|section|redesign|rearrange/.test(lower)) intents.push('update_layout')
  return intents
}

export async function loadMerchantContext(tenantId: string): Promise<MerchantContext | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { merchantContext: true },
  })
  if (!tenant?.merchantContext) return null
  return tenant.merchantContext as unknown as MerchantContext
}

export async function updateMerchantContext(
  tenantId: string,
  storeName: string,
  industry: string,
  brandPersonality: string,
  newMessage: string,
  lastAction?: string,
) {
  const existing = await loadMerchantContext(tenantId)
  const messages = existing?.keyPhrases ?? []

  const newIntents = extractIntents(newMessage)
  const recentIntents = [...new Set([...newIntents, ...(existing?.recentIntents ?? [])])].slice(0, 6)
  const keyPhrases = extractKeyPhrases([newMessage, ...messages])
  const tonePreference = detectTone([newMessage])

  // Read current products for price range
  const products = await prisma.product.findMany({
    where: { tenantId },
    select: { price: true, currency: true },
  })
  const prices = products.map(p => Number(p.price)).filter(p => p > 0)
  const priceRange = prices.length
    ? { min: Math.min(...prices), max: Math.max(...prices) }
    : existing?.priceRange ?? { min: 0, max: 999 }

  const context: MerchantContext = {
    tenantId,
    storeName,
    industry,
    brandPersonality,
    tonePreference: existing?.tonePreference ?? tonePreference,
    priceRange,
    preferredCurrency: products[0]?.currency ?? existing?.preferredCurrency ?? 'GHS',
    recentIntents,
    keyPhrases,
    lastAction: lastAction ?? existing?.lastAction,
    lastActionAt: lastAction ? new Date().toISOString() : existing?.lastActionAt,
    updatedAt: new Date().toISOString(),
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { merchantContext: context as object },
  })

  return context
}
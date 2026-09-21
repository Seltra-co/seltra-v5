//seltra-web/backend/src/ai/agents/blueprint.agent.ts
import { chat } from '../client'
import type { CanonicalStore } from '../../types'
import { cleanJSON, repairTruncatedJSON } from '../utils/json-repair.util'

const SYSTEM_PROMPT = `You are Seltra's Store Builder AI. Creator: Seltra Inc.
Given a user description of a business, design a comprehensive store blueprint.

Rules:
1. Always set platform to "Seltra". Never suggest Shopify, WooCommerce, or any other platform.
2. Return ONLY valid JSON. No markdown, no explanation, no code blocks.
3. Use Moolre as the default payment gateway for African stores.
4. Fill missing information with smart context-aware defaults.
5. Keep all string values short. productCategories: max 4 items. storeFeatures: max 4 items. recommendations: max 4 items.
6. brandName: a SHORT 1–3 word display name for the storefront (e.g. "Glow & Co", "Aura", "Velvet Skin", "Mama's Kitchen"). 
   This is NOT the same as businessName. It should feel like a real brand, not a description.
   If the user's prompt already contains a clear short brand name, use it exactly. Otherwise invent one that fits.
7. businessName: the full descriptive name from the prompt (used for SEO/meta only).
8. brandVoice: a SHORT 3-6 word tone descriptor for how this brand should sound in copy (e.g. "warm, confident, no-fuss", "playful and vibrant", "refined and understated"). Infer this from the business type, audience, and any tone cues in the prompt.
9. The JSON must follow this exact structure:

{
  "platform": "Seltra",
  "brandName": "string (1-3 words, display name)",
  "brandVoice": "string (3-6 words, tone descriptor)",
  "businessName": "string",
  "businessType": "string",
  "targetAudience": "string",
  "productCategories": ["string"],
  "storeFeatures": ["string"],
  "recommendedTechStack": {
    "paymentGateways": ["string"],
    "shippingIntegration": "string",
    "frontend": "Next.js with TailwindCSS",
    "backend": "Node.js with NestJS",
    "database": "PostgreSQL",
    "analytics": "string"
  },
  "recommendations": ["string"],
  "storeSlug": "url-friendly-lowercase-hyphenated-business-name",
  "estimatedLaunchTime": "15 minutes"
}`

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function inferBrandName(prompt: string): string {
  const trim = prompt.trim()

  const quoted = trim.match(/['"]([A-Z][^'"]{1,24})['"]/)
  if (quoted) return quoted[1].trim()

  const possessive = trim.match(/\b([A-Z][a-z]{1,14})'s\s+[A-Z][a-z]+/)
  if (possessive) return `${possessive[1]}'s`

  const titleCase = trim.match(/^([A-Z][a-z]{1,12}\s[A-Z][a-z]{1,12})/)
  if (titleCase) return titleCase[1].trim()

  const starters = /^(I|A|An|The|Build|Create|Launch|Start|Open|Help|Make|My|Our|We)/
  const singleWord = trim.match(/^([A-Z][a-z]{2,14})/)
  if (singleWord && !starters.test(trim)) return singleWord[1]

  const words = trim
    .replace(/[^a-zA-Z ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !/^(and|for|the|with|that|this|from|into|shop|store|brand|about)$/i.test(w))
  if (words.length >= 2) return `${words[0]} ${words[1]}`
  if (words.length === 1) return words[0]
  return 'My Store'
}

function inferBrandVoice(prompt: string): string {
  const lower = prompt.toLowerCase()
  if (/luxury|premium|refined|elegant|high.end/.test(lower)) return 'refined and understated'
  if (/street|hype|drop|bold|urban|sneaker/.test(lower)) return 'bold and no-fuss'
  if (/fun|playful|colorful|vibrant|kids|children/.test(lower)) return 'playful and vibrant'
  if (/organic|natural|wellness|calm|mindful/.test(lower)) return 'calm and reassuring'
  if (/professional|corporate|logistics|b2b|enterprise/.test(lower)) return 'clear, direct, dependable'
  return 'warm, confident, and clear'
}

function fallbackBlueprint(userPrompt: string): CanonicalStore {
  const firstLine =
    userPrompt
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || 'My Seltra Store'

  const businessName =
    firstLine
      .replace(/^(build|launch|start|open|create)\s+(a|an|the)?\s*/i, '')
      .replace(/\s+/g, ' ')
      .slice(0, 56)
      .trim() || 'My Seltra Store'

  const brandName = inferBrandName(userPrompt)
  const brandVoice = inferBrandVoice(userPrompt)
  const storeSlug = generateSlug(businessName) || `seltra-store-${Date.now()}`

  return {
    storeId: `store-${storeSlug}`,
    prompt: userPrompt,
    platform: 'Seltra',
    brandName,
    brandVoice,
    businessName,
    businessType: 'Online retail',
    targetAudience: 'customers looking for a focused, polished shopping experience',
    productCategories: ['Featured', 'Essentials', 'Bundles'],
    storeFeatures: ['Fast checkout', 'AI merchandising', 'Mobile storefront', 'Local delivery'],
    recommendedTechStack: {
      paymentGateways: ['Moolre'],
      shippingIntegration: 'Local courier',
      frontend: 'Next.js with TailwindCSS',
      backend: 'Node.js with NestJS',
      database: 'PostgreSQL',
      analytics: 'Seltra analytics',
    },
    additionalRecommendations: {
      marketing: ['Launch with email capture and social proof'],
      customerService: ['Add WhatsApp support'],
      logistics: ['Offer same-city delivery where possible'],
      growthStrategy: ['Start with 8 hero products and optimize from order data'],
    },
    storeSlug,
    estimatedLaunchTime: '15 minutes',
  }
}

function enforceDefaults(parsed: Record<string, unknown>, userPrompt: string): CanonicalStore {
  parsed.platform = 'Seltra'

  if (!parsed.brandName || String(parsed.brandName).split(' ').length > 4) {
    parsed.brandName = inferBrandName(
      (parsed.businessName as string | undefined) ?? userPrompt,
    )
  }

  if (!parsed.brandVoice || String(parsed.brandVoice).split(' ').length > 8) {
    parsed.brandVoice = inferBrandVoice(userPrompt)
  }

  const stack = (parsed.recommendedTechStack ?? {}) as Record<string, unknown>
  stack.frontend = 'Next.js with TailwindCSS'
  stack.backend = 'Node.js with NestJS'
  stack.database = 'PostgreSQL'
  parsed.recommendedTechStack = stack

  parsed.estimatedLaunchTime = parsed.estimatedLaunchTime ?? '15 minutes'

  if (!parsed.storeSlug && parsed.businessName) {
    parsed.storeSlug = generateSlug(parsed.businessName as string)
  }

  if (Array.isArray(parsed.recommendations) && !parsed.additionalRecommendations) {
    const recs = parsed.recommendations as string[]
    parsed.additionalRecommendations = {
      marketing: recs.slice(0, 1),
      customerService: recs.slice(1, 2),
      logistics: recs.slice(2, 3),
      growthStrategy: recs.slice(3, 4),
    }
  }

  if (!Array.isArray(parsed.productCategories) || parsed.productCategories.length === 0) {
    parsed.productCategories = ['Featured', 'Essentials', 'Bundles']
  }
  if (!Array.isArray(parsed.storeFeatures) || parsed.storeFeatures.length === 0) {
    parsed.storeFeatures = ['Fast checkout', 'Mobile storefront', 'Local delivery']
  }
  if (!parsed.businessName) {
    parsed.businessName = fallbackBlueprint(userPrompt).businessName
  }
  if (!parsed.storeSlug) {
    parsed.storeSlug = generateSlug(parsed.businessName as string)
  }

  return parsed as unknown as CanonicalStore
}

export async function generateBlueprint(userPrompt: string): Promise<{
  success: boolean
  prompt: string
  data: CanonicalStore | null
  provider: string
  error: string | null
}> {
  let result
  try {
    result = await chat(
      [
        {
          role: 'user',
          content: `${SYSTEM_PROMPT}\n\nUser prompt:\n${userPrompt}`,
        },
      ],
      { maxTokens: 500 },
    )
  } catch (error) {
    console.warn('[Blueprint] Chat call failed, using fallback:', error)
    return {
      success: true,
      prompt: userPrompt,
      data: fallbackBlueprint(userPrompt),
      provider: 'fallback',
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const cleaned = cleanJSON(result.content)

  try {
    const parsed = JSON.parse(cleaned)
    return {
      success: true,
      prompt: userPrompt,
      data: enforceDefaults(parsed, userPrompt),
      provider: result.provider,
      error: null,
    }
  } catch {
    // fall through
  }

  try {
    const repaired = repairTruncatedJSON(cleaned)
    const parsed = JSON.parse(repaired)
    console.warn('[Blueprint] JSON repaired successfully after truncation')
    return {
      success: true,
      prompt: userPrompt,
      data: enforceDefaults(parsed, userPrompt),
      provider: result.provider,
      error: null,
    }
  } catch {
    // fall through
  }

  console.warn(
    '[Blueprint] JSON unrecoverable after repair attempt, using deterministic fallback. Raw snippet:',
    cleaned.slice(0, 120),
  )
  return {
    success: true,
    prompt: userPrompt,
    data: fallbackBlueprint(userPrompt),
    provider: result.provider,
    error: null,
  }
}
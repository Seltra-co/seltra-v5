//backend/src/agent/agent.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { chat } from '../ai'
import { prisma } from '../db'
import { StoreService } from '../store/store.service'
import { StoreImageService } from '../store/store-image.service'
import { loadMerchantContext, updateMerchantContext } from '../ai/agents/merchants-context'
import { parseImageChangeIntent } from '../ai/agents/image-intent.agent'
import { ContextEngine } from '../ai/context-engine.service'
import { AgentEventsService } from './agent-events.service'
import { MoolreService } from '../payment/moolre.service'
import { planLimits } from '../common/plan-limits'
import { applyManifestPatch, getContrastRatio, type ManifestPatch } from '../ai/agents/manifest.agent'
import { COLOR_LEXICON_HINT, findNamedColor, resolveNamedColor } from '../ai/agents/color-lexicon'
import { VALID_FONTS } from '../ai/agents/critic.agent'
import { patchHeroSourceText } from '../ai/agents/hero-source-patcher'
import { getRecentAgentTurns } from '../ai/agent-memory'
import { deleteProductKnowledgeChunks, retrieveKnowledgeChunks, storeKnowledgeChunk } from '../ai/retrieval/store-knowledge.service'

export type ActionError = { action: string; message: string }
type PendingAgentAction = { kind: string; payload: unknown; expiresAt: Date }
type PendingActionDelegate = {
  findUnique(args: unknown): Promise<PendingAgentAction | null>
  upsert(args: unknown): Promise<PendingAgentAction>
  delete(args: unknown): Promise<unknown>
}
const pendingActionDb = (prisma as unknown as { agentPendingAction: PendingActionDelegate }).agentPendingAction
type UndoScope = 'hero_image' | 'product_image' | 'theme' | 'nav' | 'hero_text' | 'button' | 'logo'
type ProductSnapshot = Prisma.ProductGetPayload<{ include: { images: true; variants: true } }>
type PatchSnapshot = {
  canonical?: Prisma.JsonValue
  manifest?: Prisma.JsonValue
  heroSource?: string | null
  heroGeneratedAt?: Date | null
  products?: ProductSnapshot[]
  shippingZone?: { name: string; metadata: Prisma.JsonValue | null } | null
}

export type AgentAction =
  | { action: 'ADD_PRODUCT'; payload: { id?: string; name: string; price: number | string; currency: string; description?: string; category?: string } }
  | { action: 'UPDATE_PRODUCT'; payload: { id: string; name?: string; price?: number | string; description?: string; category?: string } }
  | { action: 'DELETE_PRODUCT'; payload: { id: string; name?: string } }
  | { action: 'UPDATE_THEME'; payload: { primaryColor?: string; font?: string } }
  | { action: 'SET_HERO_IMAGE'; payload: { url: string } }
  | { action: 'GENERATE_HERO_IMAGE'; payload: { prompt?: string } }
  | { action: 'SET_LOGO'; payload: { url: string } }
  | { action: 'GENERATE_LOGO'; payload: { prompt?: string } }
  | { action: 'SET_PRODUCT_IMAGE'; payload: { productId?: string; productName?: string; url: string } }
  | { action: 'GENERATE_PRODUCT_IMAGE'; payload: { productId?: string; productName?: string; prompt?: string } }
  | { action: 'SET_STORY_IMAGE'; payload: { url: string } }
  | { action: 'GENERATE_STORY_IMAGE'; payload: { prompt?: string } }
  | { action: 'SET_POLICY'; payload: { type: 'shipping' | 'returns'; content: string } }
  | { action: 'REFETCH_STOREFRONT'; payload: { storeId: string } }
  | { action: 'PATCH_STOREFRONT'; payload: { instruction: string } }
  | { action: 'PATCH_MANIFEST'; payload: ManifestPatch }
  | { action: 'PATCH_NAV'; payload: { items?: string[]; addItem?: string; removeItem?: string; reorder?: string[] } }
  | { action: 'PATCH_CTA'; payload: { scope: 'hero_primary'|'hero_secondary'|'add_to_cart'|'checkout'|'newsletter'|'global'; color?: string; textColor?: string; label?: string } }
  | { action: 'REGENERATE_STOREFRONT'; payload: { reason?: string } }
  | { action: 'UPDATE_STORE_META'; payload: { name?: string; businessType?: string; targetAudience?: string } }
  | { action: 'UPDATE_PRODUCTS'; payload: { operation: 'increase_prices_percent' | 'premium_names' | 'create_bundles' | 'dark_image_direction'; percent?: number; count?: number; theme?: string } }
  | { action: 'CREATE_INVOICE'; payload: { customerName: string; customerEmail: string; items: Array<{ description: string; quantity: number; unitPrice: number | string }> } }
  | { action: 'SEND_SMS'; payload: { to: string; message: string } }
  | { action: 'SET_TESTIMONIALS'; payload: { testimonials: Array<{ text: string; author: string }> } }
  | { action: 'SET_FAQ'; payload: { items: Array<{ question: string; answer: string }> } }
  | { action: 'SET_ABOUT'; payload: { headline?: string; body: string } }
  | { action: 'SET_HERO_TEXT'; payload: { eyebrow?: string; headline?: string; tagline?: string; subtext?: string; ctaLabel?: string; secondaryCtaLabel?: string } }
  | { action: 'UNDO_LAST_CHANGE'; payload: { scope?: UndoScope } }

export const SELTRA_SYSTEM_PROMPT = `You are the Seltra commerce agent, created by Seltra Inc. You help merchants build and manage their African e-commerce stores.

You can update products, prices, descriptions, the storefront UI, and store metadata.

Keep replies conversational and under 3 sentences unless the merchant asks for detail.
When you make a change, confirm what you did concisely.

Emit structured JSON actions after your reply, separated by ---ACTIONS---:
[
  { "action": "ADD_PRODUCT", "payload": { "name": string, "price": number, "currency": "GHS"|"NGN", "description": string, "category": string } },
  { "action": "UPDATE_PRODUCT", "payload": { "id": string, "name"?: string, "price"?: number, "description"?: string, "category"?: string } },
  { "action": "DELETE_PRODUCT", "payload": { "id": string, "name"?: string } },
  { "action": "UPDATE_STORE_META", "payload": { "name"?: string, "businessType"?: string, "targetAudience"?: string } },
  { "action": "UPDATE_PRODUCTS", "payload": { "operation": "increase_prices_percent"|"premium_names"|"create_bundles"|"dark_image_direction", "percent"?: number, "count"?: number, "theme"?: string } },
  { "action": "CREATE_INVOICE", "payload": { "customerName": string, "customerEmail": string, "items": [{ "description": string, "quantity": number, "unitPrice": number }] } },
  { "action": "SEND_SMS", "payload": { "to": string, "message": string } },
  { "action": "UPDATE_THEME", "payload": { "primaryColor"?: string, "font"?: string } },
  { "action": "SET_POLICY", "payload": { "type": "shipping"|"returns", "content": string } },
  { "action": "PATCH_MANIFEST", "payload": { "updatePalette"?: { "bg"?: string, "surface"?: string, "text"?: string, "accent"?: string, "muted"?: string, "accentText"?: string, "accentSoft"?: string }, "updateTypography"?: { "headingFont"?: string, "bodyFont"?: string }, "updateSectionFields"?: { "type": string, "fields": {} }, "removeSection"?: { "type"?: string, "index"?: number }, "upsertSection"?: { "index"?: number, "section": {} }, "reorderSections"?: string[] } },
  { "action": "PATCH_STOREFRONT", "payload": { "instruction": string } },
  { "action": "PATCH_NAV", "payload": { "items"?: string[], "addItem"?: string, "removeItem"?: string, "reorder"?: string[] } },
  { "action": "PATCH_CTA", "payload": { "scope": "hero_primary"|"hero_secondary"|"add_to_cart"|"checkout"|"newsletter"|"global", "color"?: string, "textColor"?: string, "label"?: string } },
  { "action": "REGENERATE_STOREFRONT", "payload": { "reason": string } },
  { "action": "SET_HERO_IMAGE", "payload": { "url": string } },
  { "action": "GENERATE_HERO_IMAGE", "payload": { "prompt"?: string } },
  { "action": "SET_LOGO", "payload": { "url": string } },
  { "action": "GENERATE_LOGO", "payload": { "prompt"?: string } },
  { "action": "SET_PRODUCT_IMAGE", "payload": { "productId"?: string, "productName"?: string, "url": string } },
  { "action": "GENERATE_PRODUCT_IMAGE", "payload": { "productId"?: string, "productName"?: string, "prompt"?: string } },
  { "action": "SET_STORY_IMAGE", "payload": { "url": string } },
  { "action": "GENERATE_STORY_IMAGE", "payload": { "prompt"?: string } },
  { "action": "SET_TESTIMONIALS", "payload": { "testimonials": [{ "text": string, "author": string }] } },
  { "action": "SET_FAQ", "payload": { "items": [{ "question": string, "answer": string }] } },
  { "action": "SET_ABOUT", "payload": { "headline"?: string, "body": string } },
  { "action": "SET_HERO_TEXT", "payload": { "eyebrow"?: string, "headline"?: string, "tagline"?: string, "subtext"?: string, "ctaLabel"?: string, "secondaryCtaLabel"?: string } },
  { "action": "UNDO_LAST_CHANGE", "payload": { "scope"?: "hero_image"|"product_image"|"theme"|"nav"|"hero_text"|"button"|"logo" } },
]

Rules:
- For product price updates, emit UPDATE_PRODUCT with the product id and new price.
- For all-product price, naming, bundle, and image styling requests, emit UPDATE_PRODUCTS.
- For UI/visual changes (colors, fonts, sections), emit PATCH_MANIFEST with precise field updates. Never use PATCH_STOREFRONT for color, font, palette, typography, or section visibility changes.
- Color resolver hints: ${COLOR_LEXICON_HINT}. Resolve common typos, e.g. "move" means mauve, and state the assumption in your reply.
- Valid fonts are: ${VALID_FONTS.join(', ')}. Use exact names from this list; "poppins and inter" means headingFont Poppins and bodyFont Inter.
- For complete look overhauls, emit REGENERATE_STOREFRONT only when the merchant asks for a genuine full redesign. Store context includes current palette, typography, section order, and overrides; preserve anything not requested.
- For requests to add, remove, rename, or reorder navigation/menu items, emit PATCH_NAV. Never fabricate item names the merchant did not mention.
- For a request to change the color or text of a specific button, emit PATCH_CTA with the matching scope. Use scope "global" only for all buttons or an unspecified button request.
- SET_HERO_TEXT payload must only include keys the merchant is changing right now. Omit untouched fields; including a guessed field overwrites it.
- If a merchant delegates a hero-copy decision to you (for example, "use your own words", "you decide", or "surprise me") after you asked for hero text, immediately emit SET_HERO_TEXT with one specific on-brand replacement. Do not ask again or give a generic response about communication style.
- If no action is needed, omit ---ACTIONS--- entirely.
- Never invent an image URL. If the merchant gives you an actual URL to a hero or product image, emit SET_HERO_IMAGE or SET_PRODUCT_IMAGE with that exact url. If they ask you to "generate" or "create" a new hero/product image and give no URL, emit GENERATE_HERO_IMAGE or GENERATE_PRODUCT_IMAGE instead — never fabricate a placeholder or example.com URL.
- If the merchant asks for an image for the "our story"/"about us" section and gives no URL, emit GENERATE_STORY_IMAGE. If they give a URL or attach a photo, emit SET_STORY_IMAGE.
- Default currency is GHS. Always reply in the same language the merchant uses.
- If the merchant refers to their "logo", "brand mark", or "store icon" with an attached image or a real URL, emit SET_LOGO with that exact URL. If they describe a logo they want generated with no attachment or URL, emit GENERATE_LOGO. Never route a logo request to SET_HERO_IMAGE or SET_PRODUCT_IMAGE.
- If the merchant gives you testimonial or review content to use, emit SET_TESTIMONIALS with that exact content — never invent reviews on their behalf.
- If the merchant gives you FAQ questions/answers, emit SET_FAQ with that exact content.
- If the merchant gives you "about us" or "our story" content, emit SET_ABOUT with that exact content.
- **CRITICAL: Any merchant message that supplies a concrete new answer for shipping time, returns policy, or delivery timing must emit SET_POLICY, even when phrased as a question or statement.** Examples: "How long does delivery take? About 4-5 hours" → SET_POLICY; "We take 2-3 days to deliver" → SET_POLICY; "Returns accepted within 30 days" → SET_POLICY. Extract the concrete policy (shipping/returns type and the merchant's stated timeframe/terms) into the content field. Do not just reply conversationally — execute SET_POLICY.

Examples of PATCH_MANIFEST usage:
- "move the FAQ above the newsletter" -> { "action": "PATCH_MANIFEST", "payload": { "reorderSections": ["hero", "trust-bar", "product-grid", "faq", "newsletter"] } }. Include EVERY current section type in the desired order, not just the two being swapped.
- "hide the trust bar" -> { "action": "PATCH_MANIFEST", "payload": { "removeSection": { "type": "trust-bar" } } }
- "show 4 products per row instead of 3" -> { "action": "PATCH_MANIFEST", "payload": { "updateSectionFields": { "type": "product-grid", "fields": { "columns": 4 } } } }
- "add a browse-by-category bar back" -> { "action": "PATCH_MANIFEST", "payload": { "upsertSection": { "index": 1, "section": { "type": "category-strip", "headline": "Browse by category" } } } }
`

function makeConversationId(conversationId?: string) {
  return conversationId || 'agent-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

export function parseActions(content: string): { reply: string; actions: AgentAction[]; rawActions: string | null; parsedSuccessfully: boolean } {
  const delimiter = '---ACTIONS---'
  const delimiterIndex = content.indexOf(delimiter)
  if (delimiterIndex < 0) return { reply: content.trim(), actions: [], rawActions: null, parsedSuccessfully: false }
  const reply = content.slice(0, delimiterIndex)
  const rawActions = content.slice(delimiterIndex + delimiter.length).trim()
  try {
    const parsed = JSON.parse(rawActions)
    return { reply: reply.trim(), actions: Array.isArray(parsed) ? parsed : [], rawActions, parsedSuccessfully: Array.isArray(parsed) }
  } catch {
    return { reply: reply.trim(), actions: [], rawActions, parsedSuccessfully: false }
  }
}

function buildContextBlock(context: Awaited<ReturnType<typeof loadMerchantContext>>) {
  if (!context) return ''
  const lines = [
    'Merchant context:',
    '- Store: ' + context.storeName + ' (' + context.industry + ', ' + context.brandPersonality + ' brand)',
    '- Price range: ' + context.preferredCurrency + ' ' + context.priceRange.min + '–' + context.priceRange.max,
    '- Recent intents: ' + (context.recentIntents.join(', ') || 'none yet'),
    '- Key terms merchant uses: ' + (context.keyPhrases.slice(0, 6).join(', ') || 'none detected'),
    '- Tone preference: ' + context.tonePreference,
  ]
  if (context.lastAction) {
    lines.push('- Last action: ' + context.lastAction + ' at ' + context.lastActionAt)
  }
  return lines.join('\n')
}

function jsonForPrisma(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function ensureHeroClassNames(source: string): string {
  let patched = source
  const h1Count = (source.match(/React\.createElement\(\s*['"]h1['"]/g) ?? []).length
  if (h1Count === 1 && !source.includes('seltra-hero-headline')) {
    patched = patched.replace(
      /React\.createElement\(\s*['"]h1['"]\s*,\s*\{/,
      "React.createElement('h1', { className: 'seltra-hero-headline',",
    )
  }
  const pCount = (source.match(/React\.createElement\(\s*['"]p['"]/g) ?? []).length
  if (pCount === 2 && !source.includes('seltra-hero-tagline')) {
    let seen = 0
    patched = patched.replace(/React\.createElement\(\s*['"]p['"]\s*,\s*\{/g, (match) => {
      seen += 1
      return seen === 2 ? "React.createElement('p', { className: 'seltra-hero-tagline'," : match
    })
  }
  if (pCount >= 1 && !source.includes('seltra-hero-brand-label')) {
    patched = patched.replace(
      /React\.createElement\(\s*['"]p['"]\s*,\s*\{/,
      "React.createElement('p', { className: 'seltra-hero-brand-label',",
    )
  }
  return patched
}

function heroImageSlotWarning(source?: string | null) {
  return source && !/props\.heroImageUrl/.test(source)
    ? "I've saved the new hero image, but this store's hero template doesn't have an image slot yet. Ask me to regenerate the hero and I'll include it."
    : null
}

function productKnowledgeContent(product: { name: string; description?: string | null; price: unknown; currency?: string | null; category?: string | null }) {
  return `Product: ${product.name}. ${product.description ?? ''}. Price: ${product.currency ?? 'GHS'} ${String(product.price)}. Category: ${product.category ?? 'Uncategorized'}.`
}

function patchKnowledgeKind(patch: ManifestPatch): 'theme' | 'section' {
  return patch.updatePalette || patch.updateTypography ? 'theme' : 'section'
}

function patchKnowledgeSourceId(patch: ManifestPatch) {
  if (patch.updatePalette) return 'palette'
  if (patch.updateTypography) return 'typography'
  if (patch.updateSectionFields?.type) return patch.updateSectionFields.type
  if (patch.removeSection?.type) return patch.removeSection.type
  if (patch.upsertSection?.section?.type) return patch.upsertSection.section.type
  if (patch.reorderSections) return 'section-order'
  return 'manifest'
}

function normalizeLookup(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function priceValuesMentioned(message: string) {
  const values = new Set<string>()
  for (const match of message.matchAll(/\b(?:ghs|gh₵|₵|cedis?|ngn|₦)?\s*(\d+(?:\.\d{1,2})?)\b/gi)) {
    values.add(String(Number(match[1])))
  }
  return values
}

function messageIncludesPriceValue(message: string, price: unknown) {
  const numeric = Number(price)
  return Number.isFinite(numeric) && priceValuesMentioned(message).has(String(numeric))
}

function looksLikeImageRequest(message: string) {
  const lower = message.toLowerCase()
  if (/\b(logo|brand mark|brandmark|store icon|store badge|company logo)\b/.test(lower)) return true
  if (/\b(our story|about us|about section|story section|brand story|founder story)\b/.test(lower) && /\b(image|photo|picture|generate|create|use|set|swap|replace)\b/.test(lower)) return true
  const heroImageIntent = /\bhero\s+(image|photo|picture|banner)\b/.test(lower) ||
    /\b(image|photo|picture|banner)\b.{0,40}\bhero\b/.test(lower)
  return heroImageIntent ||
    /\bbanner\b|\bmain image\b|\bmain photo\b|\bcover\b/.test(lower) ||
    /\b(image|photo|picture)\b.*\b(change|update|generate|regenerate|new|swap|replace|use)\b/.test(lower) ||
    /\b(change|update|generate|regenerate|swap|replace)\b.*\b(image|photo|picture)\b/.test(lower) ||
    /https?:\/\/\S+\.(png|jpe?g|webp|gif|avif)/i.test(message)
}

function imageRequestHasUsableTarget(intent: ReturnType<typeof parseImageChangeIntent>) {
  return intent.target === 'hero' || intent.target === 'logo' || intent.target === 'story' || Boolean(intent.productMatch)
}

function resolveFontName(input?: string): string | null {
  if (!input) return null
  const normalized = input.toLowerCase().replace(/[^a-z0-9]/g, '')
  return VALID_FONTS.find((font) => font.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized) ?? null
}

function paletteForNamedColor(name: string, accent: string): ManifestPatch['updatePalette'] {
  if (name === 'gold' || name === 'yellow') {
    return {
      bg: '#fffaf0',
      surface: '#ffffff',
      border: '#ead7a4',
      text: '#1f1603',
      muted: '#80662f',
      accent,
      accentText: '#ffffff',
      accentSoft: '#f8e7b8',
    }
  }

  if (name === 'black') {
    return { bg: '#050505', surface: '#111111', text: '#f8fafc', muted: '#a1a1aa', accent, accentText: '#ffffff', accentSoft: '#1f1f1f' }
  }

  if (name === 'white' || name === 'cream' || name === 'ivory' || name === 'beige') {
    return { bg: accent, surface: '#ffffff', text: '#17181a', muted: '#6b6d72', accent: '#b8860b', accentText: '#ffffff', accentSoft: '#f7ecd9' }
  }

  return { accent }
}

function inferManifestPatch(message: string): ManifestPatch | null {
  const lower = message.toLowerCase()
  const patch: ManifestPatch = {}
  const color = findNamedColor(message)
  if (color && /\b(color|colour|theme|accent|orange|red|green|blue|mauve|move|purple|pink|gold|black|white|navy)\b/i.test(message)) {
    if (/dark mode|dark theme/.test(lower)) {
      patch.updatePalette = { bg: '#050505', surface: '#111111', text: '#f8fafc', muted: '#a1a1aa', accent: color.hex }
    } else {
      patch.updatePalette = paletteForNamedColor(color.name, color.hex)
    }
  }

  if (/\bfont|typography|typeface\b/.test(lower)) {
    const mentionedFonts = VALID_FONTS
      .map((font) => {
        const match = new RegExp(`\\b${font.replace(/\s+/g, '\\s+')}\\b`, 'i').exec(message)
        return match ? { font, index: match.index } : null
      })
      .filter((match): match is { font: string; index: number } => Boolean(match))
      .sort((a, b) => a.index - b.index)
      .map((match) => match.font)
    const fuzzyFonts = message.split(/\band\b|,|\/|\+/i).map(resolveFontName).filter((font): font is string => Boolean(font))
    const fonts = mentionedFonts.length ? mentionedFonts : [...new Set(fuzzyFonts)]
    if (fonts.length > 0) {
      patch.updateTypography = { headingFont: fonts[0], bodyFont: fonts[1] ?? fonts[0] }
    }
  }

  if (/\bhide\b/.test(lower) && /\bnewsletter\b/.test(lower)) patch.removeSection = { type: 'newsletter' }
  if (/\bfaq\b/.test(lower) && /\b(add|show|include)\b/.test(lower)) patch.upsertSection = { section: { type: 'faq', headline: 'Questions customers ask', items: [] } as NonNullable<ManifestPatch['upsertSection']>['section'] }
  if (/\bcountdown\b/.test(lower) && /\b(add|show|include)\b/.test(lower)) patch.upsertSection = { index: 0, section: { type: 'announcement-bar', message: 'Limited offer' } as NonNullable<ManifestPatch['upsertSection']>['section'] }
  if (/\bbestseller|best seller|featured first\b/.test(lower)) patch.updateSectionFields = { type: 'product-grid', fields: { style: 'featured-first' } }

  return Object.keys(patch).length ? patch : null
}

function inferUndoScope(message: string): UndoScope | undefined {
  const lower = message.toLowerCase()
  if (/\blogo\b|\bbrand mark\b|\bstore icon\b|\bstore badge\b/.test(lower)) return 'logo'
  if (/\b(hero|banner)\b.*\b(image|photo|picture)\b|\b(image|photo|picture)\b.*\b(hero|banner)\b|\b(hero|banner)\b/.test(lower)) return 'hero_image'
  if (/\bproduct\b.*\b(image|photo|picture)\b|\b(image|photo|picture)\b.*\bproduct\b/.test(lower)) return 'product_image'
  if (/\bnav|navigation|menu|tab\b/.test(lower)) return 'nav'
  if (/\bbutton|cta|buy|cart|checkout|subscribe\b/.test(lower)) return 'button'
  if (/\bhero text|headline|subtitle|tagline|title\b/.test(lower)) return 'hero_text'
  if (/\btheme|color|colour|font|palette|typography|redesign|look\b/.test(lower)) return 'theme'
  return undefined
}

function inferProductPriceAction(message: string, products: Array<{ id: string; name: string }>): AgentAction | null {
  const lower = message.toLowerCase()
  if (!/\b(price|cost|cedis?|ghs|gh₵|₵|ngn|₦|should be)\b/.test(lower)) return null
  if (/\b(cheaper|expensive|discount|sale|reduce|lower|increase|raise|bump)\b/.test(lower) && !/\b\d+(?:\.\d{1,2})?\b/.test(lower)) return null

  const priceMatch = message.match(/\b(?:to|at|for|be|is|should be|make(?: it| the price)?|price)\s*(?:ghs|gh₵|₵|cedis?|ngn|₦)?\s*(\d+(?:\.\d{1,2})?)\b/i)
    ?? message.match(/\b(?:ghs|gh₵|₵|cedis?|ngn|₦)\s*(\d+(?:\.\d{1,2})?)\b/i)
  if (!priceMatch) return null

  const price = Number(priceMatch[1])
  if (!Number.isFinite(price)) return null

  const beforePrice = normalizeLookup(message.slice(0, priceMatch.index ?? message.length))
  const product = products.find((candidate) => {
    const words = normalizeLookup(candidate.name).split(/\s+/).filter((word) => word.length > 2)
    return words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(beforePrice))
  })

  if (!product && products.length !== 1) return null

  return { action: 'UPDATE_PRODUCT', payload: { id: product?.id ?? products[0].id, price } }
}

function inferHeroTextAction(message: string): AgentAction | null {
  const match = message.match(/\b(?:hero\s+)?(eyebrow|title|headline|heading|tagline|description|subtext)\b\s+(?:to|as)\s+["']([^"']+)["']/i)
    ?? message.match(/\b(secondary\s+hero\s+button|hero\s+button|primary\s+hero\s+button|button)\s+(?:text\s+)?(?:to|as)\s+["']([^"']+)["']/i)
  if (!match) return null
  const field = match[1].toLowerCase()
  const key = field.includes('eyebrow') ? 'eyebrow' : field.includes('tagline') ? 'tagline' : field.includes('description') || field.includes('subtext') ? 'subtext' : field.includes('secondary') ? 'secondaryCtaLabel' : field.includes('button') ? 'ctaLabel' : 'headline'
  return { action: 'SET_HERO_TEXT', payload: { [key]: match[2].trim() } }
}

type HeroTextField = 'headline' | 'tagline' | 'eyebrow' | 'subtext' | 'ctaLabel' | 'secondaryCtaLabel'

function heroTextClarificationField(message: string): HeroTextField | null {
  if (!/\b(change|update|set|replace)\b/i.test(message)) return null
  const match = message.match(/\b(?:my\s+)?(?:hero\s+)?(title|headline|heading|tagline|eyebrow|description|subtext|(?:primary|secondary)\s+hero\s+button|button)\b/i)
  if (!match || /\b(?:to|as)\s+["'][^"']+["']/i.test(message)) return null
  const field = match[1].toLowerCase()
  return field.includes('tagline') ? 'tagline' : field.includes('eyebrow') ? 'eyebrow' : field.includes('description') || field.includes('subtext') ? 'subtext' : field.includes('secondary') ? 'secondaryCtaLabel' : field.includes('button') ? 'ctaLabel' : 'headline'
}

function heroTextClarification(message: string): { field: HeroTextField; reply: string } | null {
  const field = heroTextClarificationField(message)
  if (!field) return null
  const label = field === 'tagline' ? 'tagline' : field === 'eyebrow' ? 'eyebrow' : field === 'subtext' ? 'description' : field === 'secondaryCtaLabel' ? 'secondary button text' : field === 'ctaLabel' ? 'button text' : 'headline'
  return { field, reply: `What would you like the hero ${label} to say?` }
}

function isHeroStatusQuestion(message: string): boolean {
  return /\bwhat does my hero say\b|\bwhat(?:'s| is) my hero (?:title|headline|tagline|copy)\b|\bshow me my hero (?:text|copy)\b/i.test(message)
}

function heroStatusReply(canonical: Record<string, unknown>): string {
  const override = (canonical.heroOverride as Record<string, unknown> | undefined) ?? {}
  const spec = (canonical.heroSpec as Record<string, unknown> | undefined) ?? {}
  const value = (key: string, fallbackKey: string) => String(override[key] ?? spec[fallbackKey] ?? '').trim()
  const headline = value('headline', 'headline') || 'not set'
  const tagline = value('tagline', 'tagline') || 'not set'
  const eyebrow = value('eyebrow', 'eyebrow')
  const subtext = value('subtext', 'subtext')
  const primary = value('ctaLabel', 'ctaLabel') || 'Shop now'
  const secondary = value('secondaryCtaLabel', 'secondaryCtaLabel')
  return [
    eyebrow ? `Eyebrow: "${eyebrow}"` : null,
    `Headline: "${headline}"`,
    `Tagline: "${tagline}"`,
    subtext ? `Description: "${subtext}"` : null,
    `Primary button: "${primary}"`,
    secondary ? `Secondary button: "${secondary}"` : null,
  ].filter(Boolean).join('\n')
}

function undoActionLabel(action?: string) {
  const labels: Record<string, string> = {
    SET_HERO_IMAGE: 'hero image change',
    GENERATE_HERO_IMAGE: 'hero image change',
    SET_LOGO: 'logo change',
    GENERATE_LOGO: 'logo change',
    SET_PRODUCT_IMAGE: 'product image change',
    GENERATE_PRODUCT_IMAGE: 'product image change',
    SET_STORY_IMAGE: 'story image change',
    GENERATE_STORY_IMAGE: 'story image change',
    ADD_PRODUCT: 'product addition',
    UPDATE_PRODUCT: 'product update',
    DELETE_PRODUCT: 'product deletion',
    UPDATE_THEME: 'theme change',
    PATCH_STOREFRONT: 'storefront change',
    PATCH_MANIFEST: 'storefront design change',
    UPDATE_PRODUCTS: 'bulk product update',
    SET_POLICY: 'policy update',
    SET_TESTIMONIALS: 'testimonials update',
    SET_FAQ: 'FAQ update',
    SET_ABOUT: 'about section update',
    SET_HERO_TEXT: 'hero text change',
    PATCH_NAV: 'nav change',
    PATCH_CTA: 'button change',
    REGENERATE_STOREFRONT: 'redesign',
  }
  return labels[action ?? ''] ?? 'change'
}

function conciseSuccessReplyForActions(actions: AgentAction[]): string | null {
  const meaningfulActions = actions.filter((action) => action.action !== 'REFETCH_STOREFRONT')
  if (meaningfulActions.length === 0) return null
  if (meaningfulActions.some((action) => action.action === 'SET_HERO_IMAGE')) return 'I have updated the hero image.'
  if (meaningfulActions.some((action) => action.action === 'SET_LOGO')) return 'I have updated the logo.'
  if (meaningfulActions.some((action) => action.action === 'SET_PRODUCT_IMAGE')) return 'I have updated the product image.'
  if (meaningfulActions.some((action) => action.action === 'SET_STORY_IMAGE' || action.action === 'GENERATE_STORY_IMAGE')) return 'I have updated the story image.'
  const heroText = meaningfulActions.find((action): action is Extract<AgentAction, { action: 'SET_HERO_TEXT' }> => action.action === 'SET_HERO_TEXT')
  if (heroText) {
    const labels = Object.keys(heroText.payload).map((field) => field === 'headline' ? 'title' : field === 'subtext' ? 'description' : field === 'ctaLabel' ? 'primary button' : field === 'secondaryCtaLabel' ? 'secondary button' : field)
    return `I have updated the hero ${labels.join(' and ')}.`
  }
  return null
}

function patchActionMatchesScope(action: string | undefined, scope?: UndoScope) {
  if (!scope) return true
  if (scope === 'hero_image') return action === 'SET_HERO_IMAGE' || action === 'GENERATE_HERO_IMAGE'
  if (scope === 'logo') return action === 'SET_LOGO' || action === 'GENERATE_LOGO'
  if (scope === 'product_image') return action === 'SET_PRODUCT_IMAGE' || action === 'GENERATE_PRODUCT_IMAGE'
  if (scope === 'theme') return ['UPDATE_THEME', 'PATCH_MANIFEST', 'PATCH_STOREFRONT', 'REGENERATE_STOREFRONT'].includes(action ?? '')
  if (scope === 'nav') return action === 'PATCH_NAV'
  if (scope === 'hero_text') return action === 'SET_HERO_TEXT'
  if (scope === 'button') return action === 'PATCH_CTA'
  return true
}

// Image requests get their own dedicated parse via image-intent.agent — this
// replaces the old bare "[image: url]" regex, which had no way to express
// "generate one" vs "here's a url" vs "which image do you mean".
function inferredImageAction(message: string, products: Array<{ id: string; name: string }>): AgentAction | null {
  const intent = parseImageChangeIntent(message, products)
  if (intent.target === 'unclear') return null

  if (intent.target === 'hero') {
    return intent.requestedUrl
      ? { action: 'SET_HERO_IMAGE', payload: { url: intent.requestedUrl } }
      : { action: 'GENERATE_HERO_IMAGE', payload: { prompt: intent.stylePrompt } }
  }

  if (intent.target === 'logo') {
    return intent.requestedUrl
      ? { action: 'SET_LOGO', payload: { url: intent.requestedUrl } }
      : { action: 'GENERATE_LOGO', payload: { prompt: intent.stylePrompt } }
  }

  if (intent.target === 'story') {
    return intent.requestedUrl
      ? { action: 'SET_STORY_IMAGE', payload: { url: intent.requestedUrl } }
      : { action: 'GENERATE_STORY_IMAGE', payload: { prompt: intent.stylePrompt } }
  }

  // target === 'product'
  const productId = intent.productMatch?.id
  const productName = intent.productMatch?.name
  return intent.requestedUrl
    ? { action: 'SET_PRODUCT_IMAGE', payload: { productId, productName, url: intent.requestedUrl } }
    : { action: 'GENERATE_PRODUCT_IMAGE', payload: { productId, productName, prompt: intent.stylePrompt } }
}

export function inferPolicyAction(message: string): AgentAction | null {
  const lower = message.toLowerCase()
  const isShipping = /\b(?:shipping|delivery|dispatch|courier|arrive|ship)\b/.test(lower)
  const isReturns = /\b(?:returns?|refunds?|exchanges?)\b/.test(lower)

  const hasConcreteAnswer = /(\d+(?:\s*(?:-|to|–)\s*\d+|\s*\.\d+)?)\s*(?:hours?|days?|weeks?|minutes?)/i.test(message)
  if (!hasConcreteAnswer) return null

  const isQuestionAnsweringPolicy = /(how long does|what.*(delivery|shipping).*take|the answer should be|should be|takes? about|takes? around|within)/i.test(message)
  if (!isQuestionAnsweringPolicy && !isShipping && !isReturns) return null

  const matched = message.match(/(?:the answer should be|should be|is|take[s]?|takes?|arrive[s]?|within|in)\s*(?:about\s+)?((?:\d+(?:\s*(?:-|to|–)\s*\d+|\.\d+)?)\s*(?:hours?|days?|weeks?|minutes?))/i)?.[1]
  const content = (matched || message.match(/((?:\d+(?:\s*(?:-|to|–)\s*\d+|\.\d+)?)\s*(?:hours?|days?|weeks?|minutes?))/i)?.[1] || 'policy update').trim()

  if (!content) return null

  const type = isReturns ? 'returns' : 'shipping'
  return { action: 'SET_POLICY', payload: { type, content } }
}

export function inferredActionsFromMessage(message: string, products: Array<{ id: string; name: string }>): AgentAction[] {
  const lower = message.toLowerCase()
  const actions: AgentAction[] = []
  const percent = lower.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]

  // UNDO INTENT — MUST run first and short-circuit
  // Matches: bare "undo", "reverse", "revert" or with trailing context like "undo that color change"
  // Does NOT match: "reverse the product order", "reverse my items" (explicit order/product/sequence noun)
  // FIX E: Bare "reverse" alone must route to UNDO_LAST_CHANGE, never to REORDER_PRODUCTS
  const isUndoIntent = /^\s*(undo|reverse|revert)(\s+(that|the|my|last|previous))?(\s+(change|patch|update|edit))?\.?\s*$/i.test(lower)
    || (/^\s*(undo|reverse|revert)\b.{0,50}$/.test(lower) && !/(product|order|sequence|items?|arrangement)/i.test(lower))
  
  if (isUndoIntent) {
    actions.push({ action: 'UNDO_LAST_CHANGE', payload: { scope: inferUndoScope(message) } })
    return actions
  }

  const imageRequest = looksLikeImageRequest(message)

  const policyAction = inferPolicyAction(message)
  if (policyAction) {
    actions.push(policyAction)
    return actions
  }

  if (imageRequest) {
    const imageAction = inferredImageAction(message, products)
    if (imageAction) actions.push(imageAction)
  }

  const heroTextAction = inferHeroTextAction(message)
  if (heroTextAction) actions.push(heroTextAction)

  const productPriceAction = inferProductPriceAction(message, products)
  if (productPriceAction) actions.push(productPriceAction)

  if (/increase|raise|bump/.test(lower) && /price|prices/.test(lower) && /all|every/.test(lower)) {
    if (percent) actions.push({ action: 'UPDATE_PRODUCTS', payload: { operation: 'increase_prices_percent', percent: Number(percent) } })
  }
  if (/rename|name/.test(lower) && /product|products/.test(lower) && /premium|luxury|signature/.test(lower)) {
    actions.push({ action: 'UPDATE_PRODUCTS', payload: { operation: 'premium_names' } })
  }
  if (/bundle|bundles|gift set|gift sets/.test(lower) && /create|make|add|mother|mothers|mother's/.test(lower)) {
    const count = Number(lower.match(/(?:create|make|add)\s+(\d+)/)?.[1] ?? 3)
    actions.push({ action: 'UPDATE_PRODUCTS', payload: { operation: 'create_bundles', count: Math.min(Math.max(count, 1), 8), theme: lower.includes('mother') ? "Mother's Day" : 'Commerce' } })
  }
  if (/image|images|photo|photos|asset|assets/.test(lower) && /dark|black|moody|background/.test(lower)) {
    actions.push({ action: 'UPDATE_PRODUCTS', payload: { operation: 'dark_image_direction', theme: 'dark studio background' } })
  }
  const navAdd = message.match(/\badd\s+(?:a\s+)?(.+?)\s+(?:tab|nav|navigation|menu item)\b/i)?.[1]
  const navRemove = message.match(/\b(?:remove|delete|hide)\s+(?:the\s+)?(.+?)\s+(?:tab|nav|navigation|menu item|from the menu|from nav)\b/i)?.[1]
  if (/\bnav|navigation|menu|tab\b/.test(lower)) {
    if (navAdd) actions.push({ action: 'PATCH_NAV', payload: { addItem: navAdd.trim() } })
    else if (navRemove) actions.push({ action: 'PATCH_NAV', payload: { removeItem: navRemove.trim() } })
  }

  if (/\bbutton|cta|buy button|add to cart|checkout|subscribe\b/.test(lower) && /\b(color|colour|text|label|make|change)\b/.test(lower)) {
    const color = findNamedColor(message)?.hex
    const label = message.match(/(?:text|label)\s+(?:to|as)\s+["']([^"']+)["']/i)?.[1]
    const scope = /\badd to cart|cart button\b/.test(lower) ? 'add_to_cart'
      : /\bcheckout\b/.test(lower) ? 'checkout'
      : /\bnewsletter|subscribe\b/.test(lower) ? 'newsletter'
      : /\bhero\b/.test(lower) ? 'hero_primary'
      : /\ball\b/.test(lower) ? 'global'
      : 'global'
    if (color || label) actions.push({ action: 'PATCH_CTA', payload: { scope, ...(color ? { color } : {}), ...(label ? { label } : {}) } })
  }

  const manifestPatch = !imageRequest ? inferManifestPatch(message) : null
  if (manifestPatch) {
    actions.push({ action: 'PATCH_MANIFEST', payload: manifestPatch })
  } else if (/layout|storefront|hide|show/.test(lower) && !imageRequest) {
    actions.push({ action: 'PATCH_STOREFRONT', payload: { instruction: message } })
  }
  return actions
}

const IMAGE_ACTION_TYPES = new Set<AgentAction['action']>([
  'SET_HERO_IMAGE', 'GENERATE_HERO_IMAGE', 'SET_LOGO', 'GENERATE_LOGO',
  'SET_STORY_IMAGE', 'GENERATE_STORY_IMAGE', 'SET_PRODUCT_IMAGE', 'GENERATE_PRODUCT_IMAGE',
])

export function mergeActions(modelActions: AgentAction[], inferred: AgentAction[], deterministicImageIntent = false) {
  // A direct upload with a confident target is a single-purpose turn. Its
  // deterministic image action is authoritative; no model or incidental
  // inference action may mutate a second field on the same upload.
  if (deterministicImageIntent) {
    const seen = new Set<string>()
    return inferred.filter((action) => IMAGE_ACTION_TYPES.has(action.action)).filter((action) => {
      const key = action.action + ':' + JSON.stringify(action.payload)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const filteredModelActions = modelActions
  const seen = new Set<string>()
  const merged = [...filteredModelActions, ...inferred].filter((action) => {
    const key = action.action + ':' + JSON.stringify(action.payload)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const inferredHeroText = inferred.find((action) => action.action === 'SET_HERO_TEXT')
  if (inferredHeroText) {
    return [...merged.filter((action) => action.action !== 'SET_HERO_TEXT'), inferredHeroText]
  }

  // FIX G: explicit ambiguity fence for undo-vs-order conflicts and other conflicting inference.
  const hasUndoInferred = inferred.some(a => a.action === 'UNDO_LAST_CHANGE')
  const hasReorderModel = modelActions.some(a => a.action === 'UPDATE_PRODUCTS' && (a.payload as any).operation === 'reorder_products')
  const hasNonUndoModelAction = modelActions.some(a => a.action !== 'UNDO_LAST_CHANGE')

  if (hasUndoInferred && (hasReorderModel || hasNonUndoModelAction)) {
    // If a bare undo phrase is inferred, prefer the undo action over unrelated model guesses.
    return inferred.filter(a => a.action === 'UNDO_LAST_CHANGE')
  }

  const hasNonImageVisualAction = merged.some((action) =>
    ['PATCH_CTA', 'PATCH_MANIFEST', 'PATCH_NAV', 'SET_HERO_TEXT'].includes(action.action),
  )
  const inferredImageActions = new Set(inferred.filter((action) =>
    ['SET_HERO_IMAGE', 'GENERATE_HERO_IMAGE'].includes(action.action),
  ))
  if (hasNonImageVisualAction && inferredImageActions.size > 0) {
    return merged.filter((action) => !inferredImageActions.has(action))
  }

  return merged
}

@Injectable()
export class AgentService {
  constructor(
    private readonly storeService: StoreService,
    private readonly storeImageService: StoreImageService,
    private readonly contextEngine: ContextEngine,
    private readonly agentEvents: AgentEventsService,
    private readonly moolre: MoolreService,
  ) {}

  private readonly CREDIT_LIMIT = Number(process.env.SELTRA_AI_CREDIT_LIMIT || 40)
  private readonly CREDIT_WINDOW_MS = Number(process.env.SELTRA_AI_CREDIT_WINDOW_HOURS || 5) * 60 * 60 * 1000

  private async consumeCredit(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiCreditsUsed: true, aiCreditsWindowStart: true },
    })
    if (!tenant) return { allowed: false, used: 0, limit: this.CREDIT_LIMIT, resetsAt: new Date() }

    const expired = Date.now() - tenant.aiCreditsWindowStart.getTime() > this.CREDIT_WINDOW_MS
    const currentUsed = expired ? 0 : tenant.aiCreditsUsed
    const currentWindowStart = expired ? new Date() : tenant.aiCreditsWindowStart
    const resetsAt = new Date(currentWindowStart.getTime() + this.CREDIT_WINDOW_MS)

    if (currentUsed >= this.CREDIT_LIMIT) {
      if (expired) await prisma.tenant.update({ where: { id: tenantId }, data: { aiCreditsWindowStart: currentWindowStart, aiCreditsUsed: 0 } })
      return { allowed: false, used: currentUsed, limit: this.CREDIT_LIMIT, resetsAt }
    }

    const nextUsed = currentUsed + 1
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { aiCreditsUsed: nextUsed, aiCreditsWindowStart: currentWindowStart },
    })
    return { allowed: true, used: nextUsed, limit: this.CREDIT_LIMIT, resetsAt }
  }

  async buildStore(prompt: string) {
    const { tenant, blueprint, provider, layoutVariant } = await this.storeService.createFromPrompt(prompt)
    return {
      success: true, provider,
      tenantId: tenant.id,
      storeUrl: blueprint.storeSlug + '.seltra.co',
      layoutVariant, blueprint,
      products: tenant.products,
      categoriesCreated: tenant.categories.length,
      message: 'Store "' + blueprint.businessName + '" is live at ' + blueprint.storeSlug + '.seltra.co',
    }
  }

 async sendMessage(storeId: string, message: string, conversationId?: string, options?: { hasAttachments?: boolean }) {
    const nextConversationId = makeConversationId(conversationId)
    const store = await this.storeService.findByIdOrSlug(storeId)
    const productList = (store.products ?? []).map((p) => ({ id: p.id, name: p.name }))
    let pendingHeroField: HeroTextField | null = null
    let forcedActions: AgentAction[] | null = null
    const pending = await pendingActionDb.findUnique({ where: { tenantId: store.id } })
    if (pending && pending.expiresAt.getTime() <= Date.now()) {
      await pendingActionDb.delete({ where: { tenantId: store.id } }).catch(() => null)
    } else if (pending?.kind === 'hero_text') {
      const field = (pending.payload as { field?: unknown })?.field
      if (typeof field === 'string' && ['headline', 'tagline', 'eyebrow', 'subtext', 'ctaLabel', 'secondaryCtaLabel'].includes(field)) {
        pendingHeroField = field as HeroTextField
        await pendingActionDb.delete({ where: { tenantId: store.id } }).catch(() => null)
        const delegated = /\b(you decide|your (own )?words|whatever you think|surprise me|i don'?t know|not sure)\b/i.test(message)
        if (!delegated && message.trim()) {
          forcedActions = [{ action: 'SET_HERO_TEXT', payload: { [pendingHeroField]: message.trim() } }]
        }
      }
    }
    if (isHeroStatusQuestion(message)) {
      const fresh = await prisma.tenant.findUnique({ where: { id: store.id }, select: { canonical: true } })
      return { reply: heroStatusReply((fresh?.canonical as Record<string, unknown> | null) ?? {}), conversationId: nextConversationId, actions: [], credits: undefined }
    }
    const heroClarification = heroTextClarification(message)
    if (!forcedActions && heroClarification && !inferHeroTextAction(message)) {
      await pendingActionDb.upsert({
        where: { tenantId: store.id },
        create: { tenantId: store.id, kind: 'hero_text', payload: { field: heroClarification.field }, expiresAt: new Date(Date.now() + 5 * 60_000) },
        update: { kind: 'hero_text', payload: { field: heroClarification.field }, expiresAt: new Date(Date.now() + 5 * 60_000) },
      })
      return { reply: heroClarification.reply, conversationId: nextConversationId, actions: [], credits: undefined }
    }
    if (!forcedActions && looksLikeImageRequest(message) && !options?.hasAttachments) {
      const intent = parseImageChangeIntent(message, productList)
      const hasUrl = Boolean(intent.requestedUrl)
      const hasDescription = Boolean(intent.stylePrompt && intent.stylePrompt.split(/\s+/).length >= 3)
      if (intent.target === 'unclear' && !hasUrl) {
        return {
          reply: "Which image should I change — the store's hero banner, or a specific product photo? If it's a product, which one?",
          conversationId: nextConversationId,
          actions: [],
          credits: undefined,
        }
      }
      if (!hasUrl && !hasDescription && imageRequestHasUsableTarget(intent)) {
        const target = intent.target === 'hero'
          ? 'hero banner'
          : intent.target === 'story'
            ? 'story section image'
            : intent.target === 'logo'
              ? 'logo'
              : `${intent.productMatch?.name ?? 'product'} photo`
        return {
          reply: `What would you like the new ${target} to look like? Describe it and I'll generate one — or attach a photo and I'll use that.`,
          conversationId: nextConversationId,
          actions: [],
          credits: undefined,
        }
      }
    }
    const credit = await this.consumeCredit(store.id)
    if (!credit.allowed) {
      return {
        reply: 'You\'ve used all ' + credit.limit + ' AI credits for this window. They reset at ' + credit.resetsAt.toLocaleTimeString() + '. Dashboard operations (orders, products, payments) still work normally.',
        conversationId: nextConversationId,
        actions: [],
        credits: { used: credit.used, limit: credit.limit, resetsAt: credit.resetsAt },
      }
    }
    const canonical = (store.canonical || {}) as Record<string, unknown>
    const tech = canonical.recommendedTechStack as { paymentGateways?: string[] } | undefined
    const manifest = (store as { manifest?: { palette?: unknown; typography?: unknown; sections?: Array<{ type?: string }> } | null }).manifest
    const currentNavItems = ((canonical.navOverride as { items?: string[] } | undefined)?.items ?? canonical.productCategories ?? []) as string[]

    //Load merchant context
    const context = await loadMerchantContext(store.id)
    const [promptContext, recentTurns, knowledgeChunks] = await Promise.all([
      this.contextEngine.build(store.id, message),
      getRecentAgentTurns(store.id, 6),
      retrieveKnowledgeChunks(store.id, message, 6),
    ])
    const recentConversation = recentTurns.length
      ? ['Recent conversation (this store, across all chat sessions):', ...recentTurns.map((turn) => `${turn.role}: ${turn.content}${turn.action ? ` [action: ${turn.action}]` : ''}`)].join('\n')
      : ''
    const knowledgeBlock = knowledgeChunks.length
      ? ['Relevant store facts (retrieved):', ...knowledgeChunks.map((chunk) => `- [${chunk.kind}] ${chunk.content}`)].join('\n')
      : ''
    const imageIntent = parseImageChangeIntent(message, productList)
    const deterministicImageIntent = Boolean(options?.hasAttachments && imageIntent.target !== 'unclear')
    const pendingDelegationBlock = pendingHeroField && !forcedActions
      ? `Pending hero-text clarification: the merchant delegated the ${pendingHeroField} decision to you. Emit SET_HERO_TEXT for that field now.`
      : ''

    let result: Awaited<ReturnType<typeof chat>> | null = null
    if (!forcedActions) try {
      result = await chat([
        { role: 'system', content: SELTRA_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            buildContextBlock(context),
            promptContext,
            'Store context:',
            JSON.stringify({
              id: store.id,
              name: store.name,
              businessType: store.businessType,
              targetAudience: store.targetAudience,
              layoutVariant: canonical.layoutVariant,
              productCategories: canonical.productCategories,
              currentNavItems,
              palette: manifest?.palette,
              typography: manifest?.typography,
              sectionOrder: manifest?.sections?.map((section) => section.type).filter(Boolean),
              overrides: {
                heroOverride: canonical.heroOverride,
                navOverride: canonical.navOverride,
                ctaOverrides: canonical.ctaOverrides,
              },
              paymentGateways: tech?.paymentGateways,
              hasStorefrontCode: Boolean((store as { storefrontCode?: string; manifest?: unknown }).storefrontCode || (store as { manifest?: unknown }).manifest),
              products: store.products?.map((p) => ({
                id: p.id,
                name: p.name,
                price: p.price.toString(),
                currency: p.currency,
                category: p.category,
              })),
            }),
            recentConversation,
            knowledgeBlock,
            'IMPORTANT: Everything above (store context, recent conversation, retrieved facts) is background only. Your job this turn is to respond to and act on the merchant message below — do not summarize prior turns unless the merchant explicitly asks what has changed.',
            pendingDelegationBlock,
            'Merchant message: ' + message,
          ].filter(Boolean).join('\n\n'),
        },
      ], { maxTokens: 500 })
    } catch {
      return {
        reply: 'I saved the conversation for ' + store.name + '. The AI provider is offline but will reconnect shortly.',
        conversationId: nextConversationId,
        actions: [],
        credits: { used: credit.used, limit: credit.limit, resetsAt: credit.resetsAt },
      }
    }

    const parsed = result ? parseActions(result.content) : { reply: '', actions: [], rawActions: null, parsedSuccessfully: false }
    const actions = forcedActions ?? mergeActions(parsed.actions, inferredActionsFromMessage(message, productList), deterministicImageIntent)
    const { persisted: persistedActions, errors, undoMessage } = await this.executeActions(store, actions, message)
    const errorMessages = errors.map((error) => error.message)
    const imageTargetFailed = errors.some((error) =>
      ['SET_PRODUCT_IMAGE', 'GENERATE_PRODUCT_IMAGE', 'SET_HERO_IMAGE', 'GENERATE_HERO_IMAGE', 'SET_LOGO', 'GENERATE_LOGO', 'SET_STORY_IMAGE', 'GENERATE_STORY_IMAGE'].includes(error.action) &&
      /couldn'?t find|which image|product matching/i.test(error.message)
    )
    const heroSlotWarning = errors.find((error) => /doesn't have an image slot/i.test(error.message))?.message

    // Update merchant context in background
    const industry = (store as { storeDNA?: { industry?: string } }).storeDNA?.industry ?? 'general'
    const brandPersonality = (store as { storeDNA?: { brandPersonality?: string } }).storeDNA?.brandPersonality ?? 'minimal'
    const lastAction = persistedActions[0]?.action ?? undefined
    updateMerchantContext(store.id, store.name, industry, brandPersonality, message, lastAction).catch(() => null)

    // Golden Rule: never concatenate success + error text in the same reply
    // If actions persisted, use the LLM's reply (which describes the successful changes)
    // Only show errors if: (1) nothing persisted, or (2) no LLM reply was provided
    let replyText: string
    const hasSuccesses = persistedActions.some((action) => action.action !== 'REFETCH_STOREFRONT')
    const hasLlmReply = parsed.reply && parsed.reply.trim().length > 0
    const hasUndoAction = persistedActions.some(a => a.action === 'UNDO_LAST_CHANGE')
    const conciseImageReply = conciseSuccessReplyForActions(persistedActions)

    // FIX E: For undo actions, use the log-generated message, never LLM prose
    if (hasUndoAction && undoMessage) {
      replyText = undoMessage
    } else if (heroSlotWarning) {
      replyText = heroSlotWarning
    } else if (imageTargetFailed) {
      replyText = "Which image should I change — the store's hero banner, or a specific product photo? If it's a product, which one?"
    } else if (hasSuccesses) {
      // Fix D: success replies stay clean; errors are scoped to failed actions and do not get pasted into successful prose.
      replyText = conciseImageReply ?? (hasLlmReply ? parsed.reply : result?.content ?? 'Your change has been applied.')
    } else if (errorMessages.length > 0) {
      // No successes — show only the real failure messages.
      replyText = errorMessages.join('\n\n')
    } else {
      // No actions attempted and no errors — show LLM response
      replyText = parsed.reply || result?.content || 'I could not apply that change.'
    }

    void this.agentEvents.emit({
      tenantId: store.id,
      agent: 'CommerceAgent',
      type: 'reply',
      action: persistedActions.map((action) => action.action).join(',') || undefined,
      payload: {
        message,
        actions: persistedActions,
        replyText,
        rawActionsBlock: parsed.rawActions,
        actionParseFailed: parsed.rawActions !== null && !parsed.parsedSuccessfully,
      } as object,
    }).catch(() => null)

    return {
      reply: replyText,
      conversationId: nextConversationId,
      actions: persistedActions,
      credits: { used: credit.used, limit: credit.limit, resetsAt: credit.resetsAt },
    }
  }

  // Peek at credit usage without consuming one — used by the dashboard to
  // display current usage on load, independent of sending a chat message.
  async getCreditStatus(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiCreditsUsed: true, aiCreditsWindowStart: true },
    })
    if (!tenant) return { used: 0, limit: this.CREDIT_LIMIT, resetsAt: new Date(Date.now() + this.CREDIT_WINDOW_MS) }

    const expired = Date.now() - tenant.aiCreditsWindowStart.getTime() > this.CREDIT_WINDOW_MS
    const used = expired ? 0 : tenant.aiCreditsUsed
    const windowStart = expired ? new Date() : tenant.aiCreditsWindowStart
    return {
      used,
      limit: this.CREDIT_LIMIT,
      resetsAt: new Date(windowStart.getTime() + this.CREDIT_WINDOW_MS),
    }
  }

  private async resolveProductId(store: { id: string; products?: Array<{ id: string; name: string }> }, productId?: string, productName?: string) {
    if (productId) return productId
    if (productName) {
      const match = await this.storeImageService.findProductByName(store.id, productName)
      if (match) return match.id
    }
    return null
  }

  private async tenantSnapshot(tenantId: string, keys: Array<'canonical' | 'manifest' | 'heroSource'>): Promise<PatchSnapshot> {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { canonical: true, manifest: true, heroSource: true, heroGeneratedAt: true } })
    return {
      ...(keys.includes('canonical') ? { canonical: tenant?.canonical as Prisma.JsonValue } : {}),
      ...(keys.includes('manifest') ? { manifest: tenant?.manifest as Prisma.JsonValue } : {}),
      ...(keys.includes('heroSource') ? { heroSource: tenant?.heroSource, heroGeneratedAt: tenant?.heroGeneratedAt } : {}),
    }
  }

  private productSelect() {
    return { images: true, variants: true } as const
  }

  private async productSnapshots(ids: string[]): Promise<ProductSnapshot[]> {
    if (ids.length === 0) return []
    return prisma.product.findMany({ where: { id: { in: ids } }, include: this.productSelect() })
  }

  private async logPatch(tenantId: string, action: AgentAction, before: PatchSnapshot, after: PatchSnapshot, source = 'chat') {
    await prisma.manifestPatchLog.create({
      data: {
        tenantId,
        patch: { action: action.action, payload: action.payload } as Prisma.InputJsonValue,
        before: jsonForPrisma(before),
        after: jsonForPrisma(after),
        source,
      },
    }).catch(() => null)
  }

  private async indexKnowledgeForActions(tenantId: string, actions: AgentAction[], message: string) {
    const actionNames = new Set(actions.map((action) => action.action))
    if (actionNames.size === 0) return
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { canonical: true, manifest: true, products: { select: { id: true, name: true, description: true, price: true, currency: true, category: true } }, shippingZones: true },
    })
    if (!tenant) return
    const canonical = (tenant.canonical as Record<string, unknown> | null) ?? {}
    const writes: Promise<unknown>[] = []
    if (actionNames.has('ADD_PRODUCT') || actionNames.has('UPDATE_PRODUCT') || actionNames.has('UPDATE_PRODUCTS')) {
      writes.push(...tenant.products.map((product) => storeKnowledgeChunk({ tenantId, kind: 'product', sourceId: product.id, content: productKnowledgeContent(product) })))
    }
    if (actionNames.has('DELETE_PRODUCT')) {
      writes.push(deleteProductKnowledgeChunks(tenantId, actions.filter((action): action is Extract<AgentAction, { action: 'DELETE_PRODUCT' }> => action.action === 'DELETE_PRODUCT').map((action) => action.payload.id)))
    }
    for (const zone of tenant.shippingZones) {
      const metadata = zone.metadata as { type?: string; content?: string } | null
      if (metadata?.content) writes.push(storeKnowledgeChunk({ tenantId, kind: 'policy', sourceId: metadata.type ?? zone.name.toLowerCase(), content: `${metadata.type ?? zone.name} policy: ${metadata.content}` }))
    }
    if (actionNames.has('SET_ABOUT')) {
      const about = canonical.aboutOverride as { headline?: string; body?: string } | undefined
      writes.push(storeKnowledgeChunk({ tenantId, kind: 'about', sourceId: 'about', content: `About section: ${about?.headline ?? ''}. ${about?.body ?? ''}` }))
    }
    if (actionNames.has('SET_FAQ')) writes.push(storeKnowledgeChunk({ tenantId, kind: 'faq', sourceId: 'faq', content: JSON.stringify(canonical.faqItems ?? []) }))
    if (actionNames.has('PATCH_MANIFEST') || actionNames.has('PATCH_STOREFRONT')) {
      const manifest = tenant.manifest as Record<string, unknown> | null
      if (manifest) writes.push(storeKnowledgeChunk({ tenantId, kind: patchKnowledgeKind(actions.find((action) => action.action === 'PATCH_MANIFEST')?.payload as ManifestPatch ?? {}), sourceId: 'manifest', content: JSON.stringify(manifest) }))
    }
    if (actionNames.has('PATCH_NAV')) writes.push(storeKnowledgeChunk({ tenantId, kind: 'nav', sourceId: 'nav-items', content: `Navigation items: ${(((canonical.navOverride as { items?: string[] } | undefined)?.items) ?? []).join(', ')}` }))
    if (actionNames.has('PATCH_CTA')) writes.push(storeKnowledgeChunk({ tenantId, kind: 'theme', sourceId: 'cta', content: `Button settings: ${JSON.stringify(canonical.ctaOverrides ?? {})}` }))
    const recentTurns = await getRecentAgentTurns(tenantId, 6)
    writes.push(storeKnowledgeChunk({ tenantId, kind: 'conversation_summary', sourceId: 'summary', content: [...recentTurns.map((turn) => `${turn.role}: ${turn.content}`), `user: ${message}`].join('\n') }))
    await Promise.all(writes.map((write) => write.catch(() => null)))
  }

  private productCreateData(product: ProductSnapshot): Prisma.ProductCreateInput {
    return {
      id: product.id,
      tenant: { connect: { id: product.tenantId } },
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency,
      category: product.category,
      sku: product.sku,
      tags: product.tags as Prisma.InputJsonValue,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      images: { create: product.images.map((image) => ({ id: image.id, url: image.url, isPrimary: image.isPrimary })) },
      variants: { create: product.variants.map((variant) => ({ id: variant.id, name: variant.name, value: variant.value })) },
    }
  }

  private productUpdateData(product: ProductSnapshot): Prisma.ProductUpdateInput {
    return {
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency,
      category: product.category,
      sku: product.sku,
      tags: product.tags as Prisma.InputJsonValue,
      status: product.status,
      images: { deleteMany: {}, create: product.images.map((image) => ({ id: image.id, url: image.url, isPrimary: image.isPrimary })) },
      variants: { deleteMany: {}, create: product.variants.map((variant) => ({ id: variant.id, name: variant.name, value: variant.value })) },
    }
  }

  private async restorePatchSnapshot(storeId: string, before: PatchSnapshot, after: PatchSnapshot) {
    if (before.canonical !== undefined || before.manifest !== undefined || before.heroSource !== undefined || before.heroGeneratedAt !== undefined) {
      await prisma.tenant.update({
        where: { id: storeId },
        data: {
          ...(before.canonical !== undefined ? { canonical: before.canonical as Prisma.InputJsonValue } : {}),
          ...(before.manifest !== undefined ? { manifest: before.manifest as Prisma.InputJsonValue } : {}),
          ...(before.heroSource !== undefined ? { heroSource: before.heroSource } : {}),
          ...(before.heroGeneratedAt !== undefined ? { heroGeneratedAt: before.heroGeneratedAt } : {}),
          updatedAt: new Date(),
        },
      })
    }

    if (before.products) {
      for (const product of before.products) {
        const stillExists = await prisma.product.findUnique({ where: { id: product.id } })
        if (stillExists) await prisma.product.update({ where: { id: product.id }, data: this.productUpdateData(product) })
        else await prisma.product.create({ data: this.productCreateData(product) })
      }
      const addedIds = (after.products ?? [])
        .map((product) => product.id)
        .filter((id) => !before.products!.some((product) => product.id === id))
      if (addedIds.length) await prisma.product.deleteMany({ where: { id: { in: addedIds } } })
    }

    if (before.shippingZone !== undefined) {
      const zoneName = before.shippingZone?.name ?? after.shippingZone?.name
      if (zoneName && before.shippingZone) {
        await prisma.shippingZone.upsert({
          where: { tenantId_name: { tenantId: storeId, name: zoneName } },
          update: { metadata: before.shippingZone.metadata as Prisma.InputJsonValue },
          create: { tenantId: storeId, name: zoneName, metadata: before.shippingZone.metadata as Prisma.InputJsonValue },
        })
      } else if (zoneName) {
        await prisma.shippingZone.delete({ where: { tenantId_name: { tenantId: storeId, name: zoneName } } }).catch(() => null)
      }
    }
  }

  private async executeActions(store: Awaited<ReturnType<typeof StoreService.prototype.findByIdOrSlug>>, actions: AgentAction[], message: string) {
    const persisted: AgentAction[] = []
    const errors: ActionError[] = []
    let needsStorefrontRefetch = false
    let undoMessage: string | null = null  // FIX E: Track undo message separately

    for (const action of actions) {

      // ── HERO IMAGE — set (validated + re-hosted) ───────────────────────
      if (action.action === 'SET_HERO_IMAGE') {
        try {
          const before = await this.tenantSnapshot(store.id, ['canonical', 'heroSource'])
          await this.storeImageService.setHeroImageUrl(store.id, action.payload.url)
          const after = await this.tenantSnapshot(store.id, ['canonical', 'heroSource'])
          await this.logPatch(store.id, action, before, after)
          persisted.push(action)
          needsStorefrontRefetch = true
          const warning = heroImageSlotWarning(after.heroSource)
          if (warning) errors.push({ action: action.action, message: warning })
          const savedHeroUrl = (after.canonical as { heroImageUrl?: unknown } | null)?.heroImageUrl
          await storeKnowledgeChunk({ tenantId: store.id, kind: 'hero', sourceId: 'hero-image', content: `Hero image url: ${String(savedHeroUrl ?? '')}` }).catch(() => null)
        } catch (err) {
          errors.push({
            action: action.action,
            message: err instanceof BadRequestException ? (err.getResponse() as { message?: string })?.message ?? err.message : 'Could not update the hero image.',
          })
        }
      }

      // ── HERO IMAGE — generate ───────────────────────────────────────────
      if (action.action === 'GENERATE_HERO_IMAGE') {
        try {
          const before = await this.tenantSnapshot(store.id, ['canonical', 'heroSource'])
          const result = await this.storeImageService.regenerateHeroImage(store.id, action.payload.prompt)
          const loggedAction: AgentAction = { action: 'SET_HERO_IMAGE', payload: { url: result.url } }
          const after = await this.tenantSnapshot(store.id, ['canonical', 'heroSource'])
          await this.logPatch(store.id, loggedAction, before, after)
          persisted.push(loggedAction)
          needsStorefrontRefetch = true
          const warning = heroImageSlotWarning(after.heroSource)
          if (warning) errors.push({ action: action.action, message: warning })
          await storeKnowledgeChunk({ tenantId: store.id, kind: 'hero', sourceId: 'hero-image', content: `Hero image url: ${result.url}` }).catch(() => null)
        } catch (err) {
          errors.push({ action: action.action, message: err instanceof BadRequestException ? (err.getResponse() as { message?: string })?.message ?? err.message : 'Could not generate a hero image.' })
        }
      }

      if (action.action === 'SET_LOGO') {
        try {
          const before = await this.tenantSnapshot(store.id, ['canonical'])
          const result = await this.storeImageService.setLogoUrl(store.id, action.payload.url)
          const after = await this.tenantSnapshot(store.id, ['canonical'])
          const savedUrl = (after.canonical as { logoUrl?: unknown } | null)?.logoUrl
          if (savedUrl !== result.url) throw new Error('Logo verification failed')
          await this.logPatch(store.id, action, before, after)
          persisted.push({ action: 'SET_LOGO', payload: { url: result.url } })
          needsStorefrontRefetch = true
        } catch (err) {
          errors.push({ action: action.action, message: err instanceof BadRequestException ? (err.getResponse() as { message?: string })?.message ?? err.message : 'Could not update the logo.' })
        }
      }

      if (action.action === 'GENERATE_LOGO') {
        try {
          const before = await this.tenantSnapshot(store.id, ['canonical'])
          const result = await this.storeImageService.regenerateLogo(store.id, action.payload.prompt)
          const loggedAction: AgentAction = { action: 'SET_LOGO', payload: { url: result.url } }
          const after = await this.tenantSnapshot(store.id, ['canonical'])
          const savedUrl = (after.canonical as { logoUrl?: unknown } | null)?.logoUrl
          if (savedUrl !== result.url) throw new Error('Logo verification failed')
          await this.logPatch(store.id, loggedAction, before, after)
          persisted.push(loggedAction)
          needsStorefrontRefetch = true
        } catch (err) {
          errors.push({ action: action.action, message: err instanceof BadRequestException ? (err.getResponse() as { message?: string })?.message ?? err.message : 'Could not generate a logo.' })
        }
      }

      // ── PRODUCT IMAGE — set (validated + re-hosted) ────────────────────
      if (action.action === 'SET_PRODUCT_IMAGE') {
        const productId = await this.resolveProductId(store, action.payload.productId, action.payload.productName)
        if (!productId) {
          errors.push({ action: action.action, message: 'Couldn\'t find a product matching "' + (action.payload.productName ?? 'that') + '" to update.' })
        } else {
          try {
            const beforeProducts = await this.productSnapshots([productId])
            const result = await this.storeImageService.setProductImageUrl(store.id, productId, action.payload.url)
            const loggedAction: AgentAction = { action: 'SET_PRODUCT_IMAGE', payload: { productId, productName: result.productName, url: result.url } }
            const afterProducts = await this.productSnapshots([productId])
            await this.logPatch(store.id, loggedAction, { products: beforeProducts }, { products: afterProducts })
            persisted.push(loggedAction)
            needsStorefrontRefetch = true
          } catch (err) {
            errors.push({ action: action.action, message: err instanceof BadRequestException ? (err.getResponse() as { message?: string })?.message ?? err.message : 'Could not update that product image.' })
          }
        }
      }

      // ── PRODUCT IMAGE — generate ─────────────────────────────────────────
      if (action.action === 'GENERATE_PRODUCT_IMAGE') {
        const productId = await this.resolveProductId(store, action.payload.productId, action.payload.productName)
        if (!productId) {
          errors.push({ action: action.action, message: 'Couldn\'t find a product matching "' + (action.payload.productName ?? 'that') + '" to generate an image for.' })
        } else {
          try {
            const beforeProducts = await this.productSnapshots([productId])
            const result = await this.storeImageService.regenerateProductImage(store.id, productId, action.payload.prompt)
            const loggedAction: AgentAction = { action: 'SET_PRODUCT_IMAGE', payload: { productId, productName: result.productName, url: result.url } }
            const afterProducts = await this.productSnapshots([productId])
            await this.logPatch(store.id, loggedAction, { products: beforeProducts }, { products: afterProducts })
            persisted.push(loggedAction)
            needsStorefrontRefetch = true
          } catch (err) {
            errors.push({ action: action.action, message: err instanceof BadRequestException ? (err.getResponse() as { message?: string })?.message ?? err.message : 'Could not generate a product image.' })
          }
        }
      }

      if (action.action === 'SET_STORY_IMAGE') {
        try {
          const before = await this.tenantSnapshot(store.id, ['canonical'])
          const result = await this.storeImageService.setStoryImageUrl(store.id, action.payload.url)
          const loggedAction: AgentAction = { action: 'SET_STORY_IMAGE', payload: { url: result.url } }
          const after = await this.tenantSnapshot(store.id, ['canonical'])
          await this.logPatch(store.id, loggedAction, before, after)
          persisted.push(loggedAction)
          needsStorefrontRefetch = true
          await storeKnowledgeChunk({ tenantId: store.id, kind: 'about', sourceId: 'story-image', content: `Story section image url: ${result.url}` }).catch(() => null)
        } catch (err) {
          errors.push({
            action: action.action,
            message: err instanceof BadRequestException ? (err.getResponse() as { message?: string })?.message ?? err.message : 'Could not update the story image.',
          })
        }
      }

      if (action.action === 'GENERATE_STORY_IMAGE') {
        try {
          const before = await this.tenantSnapshot(store.id, ['canonical'])
          const result = await this.storeImageService.regenerateStoryImage(store.id, action.payload.prompt)
          const loggedAction: AgentAction = { action: 'SET_STORY_IMAGE', payload: { url: result.url } }
          const after = await this.tenantSnapshot(store.id, ['canonical'])
          await this.logPatch(store.id, loggedAction, before, after)
          persisted.push(loggedAction)
          needsStorefrontRefetch = true
          await storeKnowledgeChunk({ tenantId: store.id, kind: 'about', sourceId: 'story-image', content: `Story section image url: ${result.url}` }).catch(() => null)
        } catch (err) {
          errors.push({ action: action.action, message: err instanceof BadRequestException ? (err.getResponse() as { message?: string })?.message ?? err.message : 'Could not generate a story image.' })
        }
      }

      // ── ADD PRODUCT ────────────────────────────────────────────────────
      if (action.action === 'ADD_PRODUCT') {
        if (!messageIncludesPriceValue(message, action.payload.price)) {
          errors.push({ action: action.action, message: 'What price should I use for that product?' })
          continue
        }
        const [existingCount, maxProducts] = await Promise.all([
          prisma.product.count({ where: { tenantId: store.id } }),
          this.resolveMaxProducts(store.id),
        ])
        if (existingCount >= maxProducts) { continue }
        const p = action.payload
        const product = await prisma.product.create({
          data: {
            tenantId: store.id,
            name: p.name,
            description: p.description,
            price: String(p.price),
            currency: p.currency || 'GHS',
            category: p.category || 'Featured',
            tags: ['agent-created'],
            status: 'active',
          },
          include: this.productSelect(),
        })
        const loggedAction: AgentAction = { action: 'ADD_PRODUCT', payload: { id: product.id, name: product.name, price: product.price.toString(), currency: product.currency, description: product.description || undefined, category: product.category || undefined } }
        await this.logPatch(store.id, loggedAction, { products: [] }, { products: [product] })
        persisted.push(loggedAction)
        needsStorefrontRefetch = true
      }

      // ── UPDATE PRODUCT ─────────────────────────────────────────────────
      if (action.action === 'UPDATE_PRODUCT') {
        const p = action.payload
        if (p.price !== undefined && !messageIncludesPriceValue(message, p.price)) {
          errors.push({ action: action.action, message: 'What exact price would you like?' })
          continue
        }
        // If no explicit id, try to match by name fuzzy search
        let productId = p.id
        if (!productId || productId === 'unknown') {
          const match = store.products?.find(prod =>
            prod.name.toLowerCase().includes((p as { name?: string }).name?.toLowerCase() ?? '') ||
            (p as { name?: string }).name?.toLowerCase().includes(prod.name.toLowerCase().slice(0, 8))
          )
          productId = match?.id ?? ''
        }
        if (productId) {
          const updateData: Record<string, unknown> = {}
          if (p.name) updateData.name = p.name
          if (p.price !== undefined) updateData.price = String(p.price)
          if (p.description !== undefined) updateData.description = p.description
          if (p.category !== undefined) updateData.category = p.category
          if (Object.keys(updateData).length > 0) {
            const beforeProducts = await this.productSnapshots([productId])
            await prisma.product.update({ where: { id: productId }, data: updateData })
            const afterProducts = await this.productSnapshots([productId])
            await this.logPatch(store.id, action, { products: beforeProducts }, { products: afterProducts })
            persisted.push(action)
            needsStorefrontRefetch = true
          }
        }
      }

      // ── DELETE PRODUCT ─────────────────────────────────────────────────
      if (action.action === 'DELETE_PRODUCT') {
        const { id, name } = action.payload
        let productId = id
        if (!productId || productId === 'unknown') {
          const match = store.products?.find(p =>
            p.name.toLowerCase().includes(name?.toLowerCase() ?? '')
          )
          productId = match?.id ?? ''
        }
        if (productId) {
          const beforeProducts = await this.productSnapshots([productId])
          await prisma.product.delete({ where: { id: productId } }).catch(() => null)
          await this.logPatch(store.id, action, { products: beforeProducts }, { products: [] })
          persisted.push(action)
          needsStorefrontRefetch = true
        }
      }

      // ── UPDATE STORE META ──────────────────────────────────────────────
      if (action.action === 'UPDATE_STORE_META') {
        const { name, businessType, targetAudience } = action.payload
        const updateData: Record<string, unknown> = {}
        if (name) updateData.name = name
        if (businessType) updateData.businessType = businessType
        if (targetAudience) updateData.targetAudience = targetAudience
        if (Object.keys(updateData).length > 0) {
          await prisma.tenant.update({ where: { id: store.id }, data: updateData })
          persisted.push(action)
        }
      }

      // ── UPDATE THEME ───────────────────────────────────────────────────
      if (action.action === 'UPDATE_THEME') {
        const before = await this.tenantSnapshot(store.id, ['canonical'])
        const canonical = ((before.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
        const afterCanonical = { ...canonical, theme: { ...((canonical.theme as Record<string, unknown>) || {}), ...action.payload } }
        await prisma.tenant.update({
          where: { id: store.id },
          data: { canonical: afterCanonical },
        })
        await this.logPatch(store.id, action, before, { canonical: afterCanonical as Prisma.JsonValue })
        persisted.push(action)
        needsStorefrontRefetch = true
      }

      // ── SET POLICY ─────────────────────────────────────────────────────
      if (action.action === 'SET_POLICY') {
        const type = action.payload.type === 'returns' ? 'Returns' : 'Shipping'
        const existingZone = await prisma.shippingZone.findUnique({ where: { tenantId_name: { tenantId: store.id, name: type } } })
        const beforeManifest = (await prisma.tenant.findUnique({ where: { id: store.id }, select: { manifest: true } }))?.manifest
        await prisma.shippingZone.upsert({
          where: { tenantId_name: { tenantId: store.id, name: type } },
          update: { metadata: action.payload },
          create: { tenantId: store.id, name: type, metadata: action.payload },
        })
        const nextZone = await prisma.shippingZone.findUnique({ where: { tenantId_name: { tenantId: store.id, name: type } } })
        const manifest = beforeManifest as Parameters<typeof applyManifestPatch>[0] | null
        let afterManifest = beforeManifest as Prisma.JsonValue
        if (manifest) {
          const questionPattern = action.payload.type === 'returns' ? /return|refund/i : /deliver|ship/i
          const items = manifest.sections
            .filter((section) => section.type === 'faq')
            .flatMap((section) => (section.type === 'faq' ? section.items ?? [] : []))
            .map((item) => questionPattern.test(item.question) ? { ...item, answer: action.payload.content } : item)
          const faqPatch = items.length > 0
            ? { updateSectionFields: { type: 'faq' as const, fields: { items } } }
            : null
          if (faqPatch) {
            const result = applyManifestPatch(manifest, faqPatch)
            if (result.applied && result.after) {
              afterManifest = result.after as unknown as Prisma.JsonValue
              await prisma.tenant.update({ where: { id: store.id }, data: { manifest: result.after as unknown as Prisma.InputJsonValue, updatedAt: new Date() } })
            }
          }
        }
        await this.logPatch(
          store.id,
          action,
          { shippingZone: existingZone ? { name: type, metadata: existingZone.metadata as Prisma.JsonValue | null } : null },
          { shippingZone: nextZone ? { name: type, metadata: nextZone.metadata as Prisma.JsonValue | null } : null },
        )
        if (afterManifest !== beforeManifest) {
          await this.logPatch(store.id, { action: 'PATCH_MANIFEST', payload: { updateSectionFields: { type: 'faq', fields: { policy: action.payload.content } } } }, { manifest: beforeManifest as Prisma.JsonValue }, { manifest: afterManifest })
        }
        persisted.push(action)
        needsStorefrontRefetch = true
      }

      // ── PATCH STOREFRONT ───────────────────────────────────────────────
      if (action.action === 'PATCH_STOREFRONT') {
        const translated = inferManifestPatch(action.payload.instruction)
        const manifest = (await prisma.tenant.findUnique({ where: { id: store.id }, select: { manifest: true } }))?.manifest as Parameters<typeof applyManifestPatch>[0] | null | undefined
        if (translated && manifest) {
          const result = applyManifestPatch(manifest, translated)
          if (result.applied && result.after) {
            await prisma.tenant.update({
              where: { id: store.id },
              data: { manifest: result.after as unknown as Prisma.InputJsonValue, updatedAt: new Date() },
            })
            await this.logPatch(store.id, { action: 'PATCH_MANIFEST', payload: translated }, { manifest: result.before as unknown as Prisma.JsonValue }, { manifest: result.after as unknown as Prisma.JsonValue })
            persisted.push({ action: 'PATCH_MANIFEST', payload: translated })
          } else {
            errors.push({ action: action.action, message: result.reason || "I couldn't apply that storefront change." })
          }
        } else {
          errors.push({ action: action.action, message: "I couldn't apply that change — try being more specific about what you'd like to modify." })
        }
        needsStorefrontRefetch = true
      }

      // ── PATCH MANIFEST ────────────────────────────────────────────────
      if (action.action === 'PATCH_MANIFEST') {
        const manifest = (await prisma.tenant.findUnique({ where: { id: store.id }, select: { manifest: true } }))?.manifest as { sections?: unknown; palette?: unknown; typography?: unknown } | null | undefined
        if (!manifest) {
          errors.push({ action: action.action, message: 'Store manifest not found.' })
        } else {
          const result = applyManifestPatch(
            manifest as Parameters<typeof applyManifestPatch>[0],
            action.payload,
          )
          if (result.applied && result.after) {
            await prisma.tenant.update({
              where: { id: store.id },
              data: { manifest: result.after as unknown as Prisma.InputJsonValue, updatedAt: new Date() },
            })
            await this.logPatch(store.id, action, { manifest: result.before as unknown as Prisma.JsonValue }, { manifest: result.after as unknown as Prisma.JsonValue })
            persisted.push(action)
          } else {
            errors.push({ action: action.action, message: result.reason || "I couldn't apply that manifest change." })
          }
        }
        needsStorefrontRefetch = true
      }

      if (action.action === 'PATCH_NAV') {
        const before = await this.tenantSnapshot(store.id, ['canonical'])
        const canonical = ((before.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
        const navOverride = ((canonical.navOverride as Record<string, unknown> | undefined) ?? {}) as { items?: string[]; style?: 'flat' | 'mega-dropdown' }
        const fallbackItems = (canonical.productCategories as string[] | undefined) ?? []
        let items = [...(Array.isArray(navOverride.items) ? navOverride.items : fallbackItems)]
        const normalize = (value: string) => value.trim().toLowerCase()
        if (action.payload.items) items = action.payload.items.map((item) => item.trim()).filter(Boolean)
        if (action.payload.addItem) {
          const item = action.payload.addItem.trim()
          if (item && !items.some((existing) => normalize(existing) === normalize(item))) items.push(item)
        }
        if (action.payload.removeItem) {
          const remove = normalize(action.payload.removeItem)
          items = items.filter((item) => normalize(item) !== remove)
        }
        if (action.payload.reorder?.length) {
          const wanted = action.payload.reorder.map(normalize)
          items = [
            ...wanted.map((key) => items.find((item) => normalize(item) === key)).filter((item): item is string => Boolean(item)),
            ...items.filter((item) => !wanted.includes(normalize(item))),
          ]
        }
        const afterCanonical = { ...canonical, navOverride: { ...navOverride, items } }
        await prisma.tenant.update({ where: { id: store.id }, data: { canonical: afterCanonical, updatedAt: new Date() } })
        await this.logPatch(store.id, action, before, { canonical: afterCanonical as Prisma.JsonValue })
        persisted.push(action)
        needsStorefrontRefetch = true
      }

      if (action.action === 'PATCH_CTA') {
        try {
        const before = await this.tenantSnapshot(store.id, ['canonical', 'heroSource'])
        const canonical = ((before.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
        const ctaOverrides = { ...((canonical.ctaOverrides as Record<string, Record<string, string>> | undefined) ?? {}) }
        const palette = ((await prisma.tenant.findUnique({ where: { id: store.id }, select: { manifest: true } }))?.manifest as { palette?: Record<string, string> } | null)?.palette ?? {}
        const color = resolveNamedColor(action.payload.color) ?? action.payload.color
        const textColor = resolveNamedColor(action.payload.textColor) ?? action.payload.textColor
        if (color && textColor && getContrastRatio(color, textColor) < 4.5) {
          errors.push({ action: action.action, message: `That button color combination has insufficient contrast (${getContrastRatio(color, textColor).toFixed(1)}:1, minimum 4.5:1). Please choose colors with better contrast.` })
          continue
        }
        if (color && !textColor) {
          const fallbackText = palette.accentText ?? '#ffffff'
          if (getContrastRatio(color, fallbackText) < 4.5) {
            errors.push({ action: action.action, message: `That button color has insufficient contrast with the current button text (${getContrastRatio(color, fallbackText).toFixed(1)}:1, minimum 4.5:1). Add a text color too, or choose a darker/lighter button color.` })
            continue
          }
        }
        const scopes = action.payload.scope === 'global'
          ? ['hero_primary', 'hero_secondary', 'add_to_cart', 'checkout', 'newsletter']
          : [action.payload.scope]
        const heroLabelScopes = scopes.filter((scope) => scope === 'hero_primary' || scope === 'hero_secondary')
        let patchedHeroSource = before.heroSource
        if (action.payload.label && heroLabelScopes.length > 0) {
          patchedHeroSource = before.heroSource ? patchHeroSourceText(before.heroSource, {
            ...(heroLabelScopes.includes('hero_primary') ? { ctaLabel: action.payload.label } : {}),
            ...(heroLabelScopes.includes('hero_secondary') ? { secondaryCtaLabel: action.payload.label } : {}),
          }) : before.heroSource
          if (!before.heroSource || patchedHeroSource === before.heroSource) {
            errors.push({ action: action.action, message: 'I could not find the requested hero button text in this storefront source.' })
            continue
          }
        }
        for (const scope of scopes) {
          ctaOverrides[scope] = {
            ...(ctaOverrides[scope] ?? {}),
            ...(color ? { color } : {}),
            ...(textColor ? { textColor } : {}),
            ...(action.payload.label ? { label: action.payload.label } : {}),
          }
        }
        const afterCanonical = { ...canonical, ctaOverrides }
        await prisma.tenant.update({ where: { id: store.id }, data: { canonical: afterCanonical, ...(patchedHeroSource !== before.heroSource ? { heroSource: patchedHeroSource, heroGeneratedAt: new Date() } : {}), updatedAt: new Date() } })
        const persistedCanonical = ((await prisma.tenant.findUnique({
          where: { id: store.id },
          select: { canonical: true },
        }))?.canonical as Record<string, unknown> | null | undefined) ?? {}
        const persistedCta = (persistedCanonical.ctaOverrides as Record<string, Record<string, string>> | undefined) ?? {}
        const failedScope = scopes.find((scope) => {
          const written = persistedCta[scope]
          if (!written) return true
          if (color && written.color !== color) return true
          if (textColor && written.textColor !== textColor) return true
          if (action.payload.label && written.label !== action.payload.label) return true
          return false
        })
        if (failedScope) {
          errors.push({ action: action.action, message: `I couldn't confirm the ${failedScope.replace(/_/g, ' ')} button change was saved. Please try again.` })
        } else {
          const after = await this.tenantSnapshot(store.id, ['canonical', 'heroSource'])
          await this.logPatch(store.id, action, before, after)
          persisted.push(action)
        }
        needsStorefrontRefetch = true
        } catch (err) {
          errors.push({ action: action.action, message: err instanceof Error ? `I couldn't save that button change: ${err.message}` : "I couldn't save that button change." })
        }
      }

      if (action.action === 'UPDATE_PRODUCTS') {
        const operation = action.payload.operation
        if (operation === 'increase_prices_percent') {
          if (!messageIncludesPriceValue(message, action.payload.percent)) {
            errors.push({ action: action.action, message: 'What percentage should I use for the price increase?' })
            continue
          }
          const percent = Number(action.payload.percent ?? 10)
          const ids = (store.products ?? []).map((product) => product.id)
          const beforeProducts = await this.productSnapshots(ids)
          for (const product of store.products ?? []) {
            const nextPrice = Number(product.price) * (1 + percent / 100)
            await prisma.product.update({ where: { id: product.id }, data: { price: nextPrice.toFixed(2) } })
          }
          const afterProducts = await this.productSnapshots(ids)
          await this.logPatch(store.id, action, { products: beforeProducts }, { products: afterProducts })
          persisted.push(action)
          needsStorefrontRefetch = true
        }
        if (operation === 'premium_names') {
          const ids = (store.products ?? []).map((product) => product.id)
          const beforeProducts = await this.productSnapshots(ids)
          for (const product of store.products ?? []) {
            if (/premium|signature|reserve/i.test(product.name)) continue
            await prisma.product.update({ where: { id: product.id }, data: { name: 'Signature ' + product.name } })
          }
          const afterProducts = await this.productSnapshots(ids)
          await this.logPatch(store.id, action, { products: beforeProducts }, { products: afterProducts })
          persisted.push(action)
          needsStorefrontRefetch = true
        }
        if (operation === 'create_bundles') {
          const count = Math.min(Math.max(Number(action.payload.count ?? 3), 1), 8)
          const baseProducts = (store.products ?? []).slice(0, Math.max(1, Math.min(3, store.products?.length ?? 1)))
          const theme = action.payload.theme || 'Commerce'
          const average = baseProducts.length
            ? baseProducts.reduce((sum, product) => sum + Number(product.price || 0), 0) / baseProducts.length
            : 75
         const [existingCount, maxProducts] = await Promise.all([
            prisma.product.count({ where: { tenantId: store.id } }),
            this.resolveMaxProducts(store.id),
          ])

          const remaining = Math.max(0, maxProducts - existingCount)
          const createdIds: string[] = []
          for (let i = 0; i < Math.min(count, remaining); i++) {
            const created = await prisma.product.create({
              data: {
                tenantId: store.id,
                name: theme + ' Bundle ' + (i + 1),
                description: 'Curated ' + theme.toLowerCase() + ' set featuring ' + (baseProducts.map((product) => product.name).join(', ') || 'best-selling items') + '.',
                price: (average * (1.8 + i * 0.15)).toFixed(2),
                currency: baseProducts[0]?.currency || 'GHS',
                category: 'Bundles',
                tags: ['agent-created', 'bundle'],
                status: 'active',
              },
              include: this.productSelect(),
            })
            createdIds.push(created.id)
          }
          const afterProducts = await this.productSnapshots(createdIds)
          await this.logPatch(store.id, action, { products: [] }, { products: afterProducts })
          persisted.push(action)
          needsStorefrontRefetch = true
        }
        if (operation === 'dark_image_direction') {
          const ids = (store.products ?? []).map((product) => product.id)
          const beforeProducts = await this.productSnapshots(ids)
          for (const product of store.products ?? []) {
            const tags = Array.isArray(product.tags) ? product.tags.map(String) : []
            await prisma.product.update({
              where: { id: product.id },
              data: { tags: Array.from(new Set([...tags, 'image-style:dark-studio', 'agent-image-direction'])) },
            })
          }
          const afterProducts = await this.productSnapshots(ids)
          await this.logPatch(store.id, action, { products: beforeProducts }, { products: afterProducts })
          persisted.push(action)
          needsStorefrontRefetch = true
        }
      }

      if (action.action === 'CREATE_INVOICE') {
        const invoice = await this.createInvoiceFromAgent(store.id, action.payload)
        persisted.push({
          action: 'CREATE_INVOICE',
          payload: {
            ...action.payload,
            invoiceId: invoice.id,
            number: invoice.number,
          } as AgentAction['payload'] & { invoiceId: string; number: string },
        } as AgentAction)
      }

      if (action.action === 'SEND_SMS') {
        await this.moolre.sendSms(action.payload)
        await this.agentEvents.emit({
          tenantId: store.id,
          agent: 'CommerceAgent',
          type: 'sms.sent',
          action: 'SEND_SMS',
          payload: action.payload as Prisma.InputJsonValue,
        }).catch(() => null)
        persisted.push(action)
      }

      if (action.action === 'SET_TESTIMONIALS') {
        const before = await this.tenantSnapshot(store.id, ['canonical'])
        const canonical = ((before.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
        const afterCanonical = { ...canonical, testimonials: action.payload.testimonials }
        await prisma.tenant.update({
          where: { id: store.id },
          data: { canonical: afterCanonical },
        })
        await this.logPatch(store.id, action, before, { canonical: afterCanonical as Prisma.JsonValue })
        persisted.push(action)
        needsStorefrontRefetch = true
      }

      if (action.action === 'SET_FAQ') {
        const before = await this.tenantSnapshot(store.id, ['canonical'])
        const canonical = ((before.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
        const afterCanonical = { ...canonical, faqItems: action.payload.items }
        await prisma.tenant.update({
          where: { id: store.id },
          data: { canonical: afterCanonical },
        })
        await this.logPatch(store.id, action, before, { canonical: afterCanonical as Prisma.JsonValue })
        persisted.push(action)
        needsStorefrontRefetch = true
      }

      if (action.action === 'SET_ABOUT') {
        const before = await this.tenantSnapshot(store.id, ['canonical'])
        const canonical = ((before.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
        const afterCanonical = { ...canonical, aboutOverride: { headline: action.payload.headline, body: action.payload.body } }
        await prisma.tenant.update({
          where: { id: store.id },
          data: { canonical: afterCanonical },
        })
        await this.logPatch(store.id, action, before, { canonical: afterCanonical as Prisma.JsonValue })
        persisted.push(action)
        needsStorefrontRefetch = true
      }

      // ── SET HERO TEXT ──────────────────────────────────────────────────
      if (action.action === 'SET_HERO_TEXT') {
        const before = await this.tenantSnapshot(store.id, ['canonical', 'heroSource'])
        const canonical = ((before.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
        const existingOverride = (canonical.heroOverride as Record<string, unknown>) ?? {}
        const heroOverride = {
          ...existingOverride,
          ...(action.payload.headline !== undefined ? { headline: action.payload.headline } : {}),
          ...(action.payload.eyebrow !== undefined ? { eyebrow: action.payload.eyebrow } : {}),
          ...(action.payload.tagline !== undefined ? { tagline: action.payload.tagline } : {}),
          ...(action.payload.subtext !== undefined ? { subtext: action.payload.subtext } : {}),
          ...(action.payload.ctaLabel !== undefined ? { ctaLabel: action.payload.ctaLabel } : {}),
          ...(action.payload.secondaryCtaLabel !== undefined ? { secondaryCtaLabel: action.payload.secondaryCtaLabel } : {}),
        }
        const afterCanonical = { ...canonical, heroOverride }
        await prisma.tenant.update({
          where: { id: store.id },
          data: {
            canonical: afterCanonical,
            updatedAt: new Date(),
          },
        })
        const verified = await prisma.tenant.findUnique({ where: { id: store.id }, select: { canonical: true } })
        const verifiedOverride = (verified?.canonical as { heroOverride?: Record<string, unknown> } | null)?.heroOverride ?? {}
        const matches = Object.entries(action.payload).every(([field, value]) => verifiedOverride[field] === value)
        if (!matches) {
          errors.push({ action: action.action, message: 'I could not verify that hero text update. Please try again.' })
        } else {
          const migratedSource = before.heroSource ? ensureHeroClassNames(before.heroSource) : before.heroSource
          if (migratedSource !== before.heroSource) {
            await prisma.tenant.update({ where: { id: store.id }, data: { heroSource: migratedSource, heroGeneratedAt: new Date(), updatedAt: new Date() } })
          }
          const sourceOverrides = {
            headline: action.payload.headline,
            tagline: action.payload.tagline,
            eyebrow: action.payload.eyebrow,
            ctaLabel: action.payload.ctaLabel,
            secondaryCtaLabel: action.payload.secondaryCtaLabel,
          }
          const hasVisibleOverride = Object.values(sourceOverrides).some((value) => value !== undefined)
          const patchedSource = migratedSource && hasVisibleOverride
            ? patchHeroSourceText(migratedSource, sourceOverrides)
            : migratedSource
          if (hasVisibleOverride && (!migratedSource || patchedSource === migratedSource)) {
            await prisma.tenant.update({ where: { id: store.id }, data: { canonical: before.canonical as Prisma.InputJsonValue, updatedAt: new Date() } })
            errors.push({ action: action.action, message: 'I could not find an editable hero text element in this storefront source.' })
            continue
          }
          await prisma.tenant.update({
            where: { id: store.id },
            data: patchedSource !== before.heroSource ? { heroSource: patchedSource, heroGeneratedAt: new Date() } : {},
          })
          const after = await this.tenantSnapshot(store.id, ['canonical', 'heroSource'])
          await this.logPatch(store.id, action, before, after)
          persisted.push(action)
          await storeKnowledgeChunk({ tenantId: store.id, kind: 'hero', sourceId: 'hero-text', content: `Hero text: ${Object.entries(heroOverride).map(([key, value]) => `${key}: ${value}`).join('; ')}` }).catch(() => null)
          needsStorefrontRefetch = true
        }
      }

      // ── UNDO LAST CHANGE ────────────────────────────────────────────────
      // FIX E: Generate reply from log state only, never from LLM prose
      if (action.action === 'UNDO_LAST_CHANGE') {
        const candidates = await prisma.manifestPatchLog.findMany({
          where: { tenantId: store.id, reverted: false },
          orderBy: { createdAt: 'desc' },
          take: action.payload.scope ? 25 : 1,
        })
        const lastPatch = candidates.find((patch) => {
          const patchAction = (patch.patch as { action?: string } | null)?.action
          return patchActionMatchesScope(patchAction, action.payload.scope)
        })
        if (!lastPatch) {
          errors.push({ action: action.action, message: 'Nothing recent to undo.' })
        } else {
          const before = lastPatch.before as unknown as PatchSnapshot
          const after = lastPatch.after as unknown as PatchSnapshot
          await this.restorePatchSnapshot(store.id, before, after)
          await prisma.manifestPatchLog.update({
            where: { id: lastPatch.id },
            data: { reverted: true },
          })
          // Generate message from log state, not from LLM
          const patchAction = (lastPatch.patch as { action?: string } | null)?.action || 'last change'
          undoMessage = 'Reverted your last ' + undoActionLabel(patchAction) + '.'
          persisted.push(action)
        }
        needsStorefrontRefetch = true
      }

      // ── REGENERATE STOREFRONT ──────────────────────────────────────────
      if (action.action === 'REGENERATE_STOREFRONT') {
        const before = await this.tenantSnapshot(store.id, ['canonical', 'manifest'])
        const canonicalBefore = ((before.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
        const preservedOverrides = {
          ...(canonicalBefore.heroOverride !== undefined ? { heroOverride: canonicalBefore.heroOverride } : {}),
          ...(canonicalBefore.navOverride !== undefined ? { navOverride: canonicalBefore.navOverride } : {}),
          ...(canonicalBefore.ctaOverrides !== undefined ? { ctaOverrides: canonicalBefore.ctaOverrides } : {}),
        }
        await this.storeService.regenerateStorefrontCode(store.id)
        if (Object.keys(preservedOverrides).length > 0) {
          const latest = await this.tenantSnapshot(store.id, ['canonical'])
          const latestCanonical = ((latest.canonical as Record<string, unknown>) || {}) as Record<string, unknown>
          await prisma.tenant.update({
            where: { id: store.id },
            data: { canonical: { ...latestCanonical, ...preservedOverrides }, updatedAt: new Date() },
          })
        }
        const after = await this.tenantSnapshot(store.id, ['canonical', 'manifest'])
        await this.logPatch(store.id, action, before, after)
        persisted.push(action)
        needsStorefrontRefetch = true
      }
    }

    await this.indexKnowledgeForActions(store.id, persisted.filter((action) => action.action !== 'REFETCH_STOREFRONT'), message).catch(() => null)
    if (needsStorefrontRefetch) {
      persisted.push({ action: 'REFETCH_STOREFRONT', payload: { storeId: store.id } })
    }

    return { persisted, errors, undoMessage }
  }

  private async createInvoiceFromAgent(
    tenantId: string,
    payload: Extract<AgentAction, { action: 'CREATE_INVOICE' }>['payload'],
  ) {
    const items = (payload.items || []).filter((item) => item.description && Number(item.quantity) > 0)
    const subtotal = items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0)
    const invoiceCount = await prisma.invoice.count({ where: { tenantId } })
    const number = 'INV-' + String(invoiceCount + 1).padStart(5, '0')

    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        number,
        customerName: payload.customerName,
        customerEmail: payload.customerEmail,
        subtotal: new Prisma.Decimal(subtotal),
        total: new Prisma.Decimal(subtotal),
        pdfUrl: '/api/v1/invoices/' + number + '/pdf',
        items: {
          create: items.map((item) => ({
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: new Prisma.Decimal(item.unitPrice),
            total: new Prisma.Decimal(Number(item.unitPrice) * Number(item.quantity)),
          })),
        },
      },
    })

    await this.agentEvents.emit({
      tenantId,
      agent: 'InvoiceAgent',
      type: 'invoice.created',
      action: 'CREATE_INVOICE',
      payload: { invoiceId: invoice.id, number } as Prisma.InputJsonValue,
    }).catch(() => null)

    return invoice
  }

  private async resolveMaxProducts(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { owner: { select: { plan: true } } },
    })
    return planLimits(tenant?.owner?.plan).maxProductsPerStore
  }
}

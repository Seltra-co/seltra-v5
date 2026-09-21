//ai/agents/hero-nav-builder.agent.ts
import { cfCodegen, getRoleCandidates } from '../../providers/cloudflare'
import { codegenChat } from '../client'
import type { CanonicalStore } from '../../types'
import type { StoreManifest } from './manifest.agent'
import { designHero, designNav } from './design.agent'
import type { HeroDesignSpec, NavDesignSpec } from '../design-system/contracts'
import type { StoreDNA } from '../../types/store-dna'
import { isResponsiveHeroPattern, isResponsiveNavPattern } from '../design-system/guards'
import { buildDesignBookPromptBlock, CTA_CLASSES } from '../design-system/hero-design-book'
import { resolveComposition } from './composition-rules'

export type Role = 'hero' | 'nav'

interface BuildInput {
  blueprint: CanonicalStore
  manifest: StoreManifest
  dna: StoreDNA | null
  heroImageUrl?: string | null
  products: Array<{
    id: string
    name: string
    description?: string | null
    price: string | number
    currency?: string
    category?: string | null
    images?: Array<{ url: string; isPrimary?: boolean }>
  }>
}

export type HeroNavAttemptEvent = {
  role: Role
  attempt: number
  model: string
  ok: boolean
  reason?: string
}

interface StackFrame { type: 'tag' | 'paren' | 'brace' | 'bracket'; value: string }

function computeUnclosedStack(source: string): StackFrame[] {
  const stack: StackFrame[] = []
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++
      while (i < source.length && source[i] !== q) { if (source[i] === '\\') i++; i++ }
      continue
    }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue }
    if (c === '/' && source[i + 1] === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++; i++; continue }
    if (c === '(') stack.push({ type: 'paren', value: '(' })
    else if (c === '{') stack.push({ type: 'brace', value: '{' })
    else if (c === '[') stack.push({ type: 'bracket', value: '[' })
    else if (c === ')' && stack[stack.length - 1]?.type === 'paren') stack.pop()
    else if (c === '}' && stack[stack.length - 1]?.type === 'brace') stack.pop()
    else if (c === ']' && stack[stack.length - 1]?.type === 'bracket') stack.pop()
  }
  return stack
}

function detectTruncation(source: string): boolean {
  const trimmed = source.trimEnd()
  const backticks = (trimmed.match(/`/g) ?? []).length
  if (backticks % 2 !== 0) return true
  if (!/\}\s*$/.test(trimmed)) return true
  return computeUnclosedStack(trimmed).length > 0
}

function repairTruncation(source: string): string {
  let s = source.trimEnd()
  for (const frame of computeUnclosedStack(s).reverse()) {
    if (frame.type === 'paren') s += ')'
    if (frame.type === 'brace') s += '}'
    if (frame.type === 'bracket') s += ']'
  }
  if (!/\}\s*$/.test(s)) s += '\n}'
  return s
}

function sanitizeSource(raw: string): string {
  let s = raw.trim()
  if (s.startsWith('```javascript')) s = s.slice(13)
  else if (s.startsWith('```jsx')) s = s.slice(6)
  else if (s.startsWith('```js')) s = s.slice(5)
  else if (s.startsWith('```')) s = s.slice(3)
  if (s.endsWith('```')) s = s.slice(0, -3)
  return s
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/^(['"])use client\1;?\s*/g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('import ') && !t.startsWith('export ') && !/\brequire\s*\(/.test(t)
    })
    .join('\n')
    .trim()
}

function stripBannedInlineDisplay(source: string): string {
  return source.replace(
    /(\b(?:seltra-hamburger|seltra-desktop-cats)\b[\s\S]{0,1000}?style\s*:\s*\{)([^}]*)\}/gi,
    (full, head, body) => head + body.replace(/\b(display|visibility)\s*:\s*[^,}]+,?/gi, '') + '}',
  )
}

function patchNavRootClass(source: string): string {
  const rootPattern = /(React\.createElement\(\s*['"](?:header|nav)['"]\s*,\s*\{)([^}]*)\}/i
  const match = rootPattern.exec(source)
  if (!match) return source
  if (/className\s*:/i.test(match[2])) {
    return /className\s*:\s*['"][^'"]*\bseltra-nav\b/i.test(match[2])
      ? source
      : source.replace(rootPattern, (_full, head: string, body: string) => `${head}${body.replace(/className\s*:\s*(['"])[^'"]*\1/i, "className: 'seltra-nav'")}}`)
  }
  return source.replace(rootPattern, `$1 className: 'seltra-nav',$2}`)
}

function stripHeroLayoutInlineStyles(source: string): string {
  return source.replace(
    /(\b(?:seltra-hero|seltra-hero-content|seltra-hero-media|seltra-hero-secondary)\b[\s\S]{0,200}?style\s*:\s*\{)([^}]*)\}/gi,
    (full, head, body) => {
      const cleaned = body.replace(/\b(?:position|top|right|bottom|left|zIndex)\s*:\s*[^,}]+,?/gi, '')
      return `${head}${cleaned}}`
    },
  )
}

function sourceHasImageHeavyArchetype(source: string): boolean {
  return /\b(editorial-commerce|lifestyle-scrim-cart|fullbleed-bottom-text)\b/i.test(source)
}

function sourceHasScrimLayer(source: string): boolean {
  return /\bseltra-hero-scrim\b|\bscrim\b|linear-gradient|rgba\s*\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(?:0\.[3-9]|1)|rgba\s*\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(?:0\.[7-9]|1)/i.test(source)
}

function hasRiskyArrayLiteralChildren(source: string): boolean {
  const arrayPattern = /\[[\s\S]*?React\.createElement[\s\S]*?\]/g
  let match: RegExpExecArray | null
  while ((match = arrayPattern.exec(source)) !== null) {
    const arraySource = match[0]
    if (/\.map\s*\(/.test(arraySource)) continue
    if (!/key\s*:/.test(arraySource)) return true
  }
  return false
}

function heroHasBareCTAConcatenation(source: string): boolean {
  const bareTextPattern = /React\.createElement\(\s*['"](?:div|span|p|a|button)['"][^\n]*?,\s*[^,\n]+?\s*,\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]/gi
  return bareTextPattern.test(source)
}

function patchHeroPrimaryCtaClass(source: string): string {
  if (!source.includes('seltra-hero-actions') || source.includes(CTA_CLASSES.primary)) return source
  const actionsIdx = source.indexOf('seltra-hero-actions')
  const before = source.slice(0, actionsIdx)
  const after = source.slice(actionsIdx)
  const withClass = after.replace(
    /(React\.createElement\(\s*['"](?:button|a)['"]\s*,\s*\{[\s\S]{0,300}?className\s*:\s*['"])([^'"]*)(['"])/,
    (_full, head: string, classes: string, tail: string) => `${head}${`${classes} ${CTA_CLASSES.primary}`.trim()}${tail}`,
  )
  if (withClass !== after) return before + withClass
  return before + after.replace(
    /(React\.createElement\(\s*['"](?:button|a)['"]\s*,\s*\{)/,
    `$1 className: '${CTA_CLASSES.primary}',`,
  )
}

export function repairChunk(raw: string): string {
  let s = sanitizeSource(raw)
  s = stripBannedInlineDisplay(s)
  s = stripHeroLayoutInlineStyles(s)
  s = patchNavRootClass(s)
  s = patchHeroPrimaryCtaClass(s)
  if (detectTruncation(s)) s = repairTruncation(s)
  if (detectTruncation(s)) s = repairTruncation(s)
  return s
}

// Legitimate trustBadges (from design.agent's specIsClean gate) never contain
// these tokens, so if a hero source contains them, the codegen model
// hallucinated a fake social-proof element on its own — this is exactly the
// "★★★★★ Loved by customers — REAL REVIEWS, REAL ORDERS" bug seen in prod.
// Reject and let it retry/fall back to deterministic nav rather than ship it.
import { isFabricationGuarded } from '../design-system/guards'
import * as vm from 'node:vm'

export interface SandboxSmokeResult {
  ok: boolean
  reason?: string
}

export function runSandboxSmokeTest(source: string, role: Role): SandboxSmokeResult {
  try {
    const sandbox = {
      React: {
        createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props, children }),
      },
      fetch: () => {
        throw new Error('runtime: network access is blocked in sandbox')
      },
      console,
    }

    const mockProduct = {
      id: 'mock-product-1',
      name: 'Mock Product',
      price: 45,
      currency: 'GHS',
      category: 'Mock Category',
      images: [{ url: 'https://example.com/mock.jpg', isPrimary: true }],
    }

    const propsLiteral = role === 'hero'
      ? `{
          store: { displayName: 'Test Store' },
          products: [${JSON.stringify(mockProduct)}, ${JSON.stringify(mockProduct)}],
          features: ['Fast delivery', 'Secure checkout'],          secondaryCard: { kind: 'none', position: 'float-below', fields: {} },          onShopNow: () => {},
          onOpenCart: () => {},
        }`
      : `{
          displayName: 'Test Store',
          businessType: 'Retail',
          categories: ['Category A', 'Category B'],
          cartCount: 0,
          CartIcon: (p) => React.createElement('svg', p),
          onOpenCart: () => {},
          onCategoryClick: () => {},
          onLogoClick: () => {},
          onToggleMenu: () => {},
          menuOpen: false,
        }`

    const script = new vm.Script(`
      const props = (${propsLiteral});
      const component = (${source});
      const element = component(props);
      if (typeof element !== 'object' || element === null) throw new Error('runtime: component did not return a valid element');
      true;
    `)
    const context = vm.createContext(sandbox)
    script.runInContext(context, { timeout: 100 })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

interface GateResult {
  ok: boolean
  reason?: string
}

export function chunkPassesGateWithReason(source: string, role: Role, opts?: { requiresHeroImage?: boolean }): GateResult {
  const fnName = role === 'hero' ? 'StorefrontHero' : 'StorefrontNav'
  if (!source.includes(`function ${fnName}`)) {
    return { ok: false, reason: `missing function ${fnName}` }
  }
  if (role === 'hero' && !/\bdisplayName\b/.test(source)) {
    return { ok: false, reason: 'hero: missing displayName usage' }
  }
  if (role === 'hero' && opts?.requiresHeroImage && !/props\.heroImageUrl/.test(source)) {
    return { ok: false, reason: 'hero: heroImageUrl prop is available but source never references props.heroImageUrl' }
  }
  if (role === 'nav' && !source.includes('props.CartIcon') && !/\bCartIcon\b/.test(source)) {
    return { ok: false, reason: 'nav: missing CartIcon prop usage' }
  }
  if (
    role === 'nav' &&
    (
      /React\.createElement\(\s*(?:props\.)?CartIcon\s*,\s*(?:props|navProps)\b/.test(source) ||
      /\b(?:props\.)?CartIcon\s*\(\s*(?:props|navProps)\b/.test(source) ||
      /React\.createElement\(\s*(?:props\.)?CartIcon\s*,\s*\{[^}]*\bcartCount\s*:/.test(source) ||
      /\b(?:props\.)?CartIcon\s*\(\s*\{[^}]*\bcartCount\s*:/.test(source)
    )
  ) {
    return { ok: false, reason: 'nav: CartIcon must receive icon-only props, never cartCount or parent props' }
  }
  if (role === 'nav' && !/\b(?:onToggleMenu|props\.onToggleMenu)\b/.test(source)) {
    return { ok: false, reason: 'nav: missing onToggleMenu' }
  }
  if (role === 'nav' && !/className\s*:\s*['"][^'"]*seltra-hamburger\b/i.test(source)) {
    return { ok: false, reason: 'nav: missing seltra-hamburger mobile control' }
  }
  if (source.includes('.image}') || source.includes('.image,') || /\]\.image\b/.test(source)) {
    return { ok: false, reason: 'uses singular .image property' }
  }
  if (role === 'hero' && !isFabricationGuarded(source)) {
    return { ok: false, reason: 'hero: fabricated social-proof pattern detected' }
  }
  if (role === 'hero' && hasRiskyArrayLiteralChildren(source)) {
    return { ok: false, reason: 'hero: array literal children contain React elements without stable key props' }
  }
  if (role === 'hero' && sourceHasImageHeavyArchetype(source) && !sourceHasScrimLayer(source)) {
    return { ok: false, reason: 'hero: image-heavy archetype missing explicit scrim/contrast layer' }
  }
  if (role === 'hero' && /function StorefrontHero/.test(source) && !isResponsiveHeroPattern(source)) {
    return { ok: false, reason: 'hero: missing seltra-hero-media responsive hook' }
  }
  if (role === 'hero' && !secondaryCardIsNestedInMedia(source)) {
    console.warn('[HeroNav] warning: hero secondary card is not nested inside seltra-hero-media')
  }
  if (role === 'hero' && !source.includes('seltra-hero-actions') && heroHasBareCTAConcatenation(source)) {
    return { ok: false, reason: 'hero: CTA labels must be wrapped in seltra-hero-actions with separate button/link elements' }
  }
  if (role === 'hero' && source.includes('seltra-hero-actions') && !source.includes(CTA_CLASSES.primary)) {
    if (!/React\.createElement\(\s*['"](?:button|a)['"]/.test(source.slice(source.indexOf('seltra-hero-actions')))) {
      return { ok: false, reason: 'hero: CTA actions present but no button/link element exists' }
    }
    console.warn('[HeroNav] warning: hero primary CTA class missing after repair')
  }
  if (role === 'hero' && !heroContentSeparationValid(source)) {
    return { ok: false, reason: 'hero: seltra-hero-media contains too many textual content nodes' }
  }
  if (role === 'nav' && !isResponsiveNavPattern(source)) {
    return { ok: false, reason: 'nav: missing seltra-hamburger/seltra-desktop-cats hooks' }
  }
  if (role === 'nav') {
    const inlineDisplayRegex = /\b(seltra-hamburger|seltra-desktop-cats)\b[\s\S]{0,200}?style\s*:\s*\{[^}]*\b(?:display|visibility)\s*:/i
    if (inlineDisplayRegex.test(source)) {
      return { ok: false, reason: 'nav: responsive hooks must not include inline display or visibility styles' }
    }
    if (!navRootStructureValid(source)) {
      return { ok: false, reason: 'nav: root element is not a properly-classed seltra-nav container with siblings at the correct depth' }
    }
  }
  if (role === 'hero') {
    const inlineLayoutRegex = /\b(?:seltra-hero|seltra-hero-content|seltra-hero-media|seltra-hero-secondary)\b[\s\S]{0,200}?style\s*:\s*\{[^}]*\b(?:position|top|right|bottom|left|zIndex)\s*:/i
    if (inlineLayoutRegex.test(source)) {
      return { ok: false, reason: 'hero: inline layout styles are not allowed; use shared CSS classes and data attributes' }
    }
  }
  if (role === 'hero') {
    const totalMentions = (source.match(/\bdisplayName\b/g) ?? []).length
    const propAliasDeclarations = (source.match(/\b(?:const|let|var)\s+displayName\s*=\s*props(?:\.store)?\.displayName\b/g) ?? []).length
    const destructureDeclarations = (source.match(/\b(?:const|let|var)\s*\{\s*displayName(?:\s*=\s*[^,}]*)?\s*\}\s*=\s*props(?:\.store)?\b/g) ?? []).length

    const visibleSource = source.replace(/\b(?:alt|title|ariaLabel|aria-label)\s*:\s*[^,}]*\bdisplayName\b[^,}]*/g, '')
    const visibleMentions = (visibleSource.match(/\bdisplayName\b/g) ?? []).length
    const renderOccurrences = visibleMentions - propAliasDeclarations * 2 - destructureDeclarations
    if (renderOccurrences > 1) {
      return { ok: false, reason: `displayName rendered ${renderOccurrences} times, must be no more than 1` }
    }
  }
  if (/\.map\s*\(/.test(source) && !/key\s*[:=]/.test(source)) {
    return { ok: false, reason: 'map() without key prop' }
  }

  // More robust check: ensure every .map callback contains a key prop
  function mapCallbackMissingKey(code: string): boolean {
    let i = 0
    while (true) {
      const idx = code.indexOf('.map(', i)
      if (idx === -1) return false
      // find opening paren for .map(
      let p = idx + 5 // position after '.map('
      // walk to matching ')' to capture the callback body
      let depth = 1
      while (p < code.length && depth > 0) {
        const c = code[p]
        if (c === '(') depth++
        else if (c === ')') depth--
        else if (c === '"' || c === '\'' || c === '`') {
          const q = c
          p++
          while (p < code.length && code[p] !== q) {
            if (code[p] === '\\') p += 2
            else p++
          }
        } else if (code[p] === '/') {
          // skip simple comment starts
          if (code[p + 1] === '/') {
            p += 2
            while (p < code.length && code[p] !== '\n') p++
          } else if (code[p + 1] === '*') {
            p += 2
            while (p + 1 < code.length && !(code[p] === '*' && code[p + 1] === '/')) p++
            p += 2
            continue
          }
        }
        p++
      }
      if (depth !== 0) return true // truncated map callback — treat as failing
      const callback = code.slice(idx, p)
      // heuristics: callback should contain a key: or key= token within the returned element
      const hasKeyProp = /\bkey\s*[:=]\s*/.test(callback) || /props?\.key\b/.test(callback)
      const hasKeyAssignment = /\b(?:[A-Za-z_$][\w$]*\.)?key\s*=\s*/.test(callback)
      const hasCreateElement = /React\.createElement\s*\(/.test(callback)
      const rootCreateIdx = callback.indexOf('React.createElement(')
      if (rootCreateIdx !== -1) {
        let q = rootCreateIdx + 'React.createElement('.length
        let depth = 1
        let argIndex = 0
        let rootKeyPresent = false
        let argStart = q
        while (q < callback.length && depth > 0) {
          const c = callback[q]
          if (c === '(') depth++
          else if (c === ')') depth--
          else if (c === '"' || c === "'" || c === '`') {
            const quote = c
            q++
            while (q < callback.length && callback[q] !== quote) {
              if (callback[q] === '\\') q += 2
              else q++
            }
          } else if (c === '/') {
            if (callback[q + 1] === '/') { q += 2; while (q < callback.length && callback[q] !== '\n') q++ }
            else if (callback[q + 1] === '*') { q += 2; while (q + 1 < callback.length && !(callback[q] === '*' && callback[q + 1] === '/')) q++; q += 2; continue }
          } else if (c === ',' && depth === 1) {
            argIndex++
            if (argIndex === 2) {
              const argText = callback.slice(argStart, q).trim()
              if (/^\{/.test(argText) && /\bkey\s*[:=]/.test(argText)) rootKeyPresent = true
            }
            argStart = q + 1
          }
          q++
        }
        if (argIndex === 1) {
          const argText = callback.slice(argStart, q).trim()
          if (/^\{/.test(argText) && /\bkey\s*[:=]/.test(argText)) rootKeyPresent = true
        }
        if (argIndex >= 1 && !rootKeyPresent && !hasKeyAssignment) return true
        if (argIndex === 0 && !hasKeyProp) return true
      } else if (!hasKeyProp) {
        return true
      }
      i = p
    }
  }

  if (mapCallbackMissingKey(source)) {
    return { ok: false, reason: 'map() without key prop' }
  }
  if (/useState\s*\(|useContext\s*\(|createContext\s*\(|postMessage\s*\(|localStorage/.test(source)) {
    return { ok: false, reason: 'uses banned hook/API' }
  }
  if (/window\.|document\.|import\s|export\s|require\s*\(|`/.test(source)) {
    return { ok: false, reason: 'uses window/document/import/export/require/backtick' }
  }
  if (detectTruncation(source)) {
    return { ok: false, reason: 'source appears truncated' }
  }
  if (role === 'hero') {
    const requiredHeroClasses = ['seltra-hero-brand-label', 'seltra-hero-headline', 'seltra-hero-tagline']
    const missing = requiredHeroClasses.filter((cls) => !source.includes(cls))
    if (missing.length > 0) {
      return { ok: false, reason: `hero: missing required text className(s): ${missing.join(', ')}` }
    }
  }

  const sandboxResult = runSandboxSmokeTest(source, role)
  if (!sandboxResult.ok) {
    return { ok: false, reason: `sandbox execution failed: ${sandboxResult.reason}` }
  }
  return { ok: true }
}

function chunkPassesGate(source: string, role: Role): boolean {
  return chunkPassesGateWithReason(source, role).ok
}

function brandContext(input: BuildInput): string {
  const productSample = input.products.slice(0, 6).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    currency: p.currency ?? 'GHS',
    category: p.category,
    images: p.images?.map((i) => ({ url: i.url, isPrimary: i.isPrimary })) ?? [],
  }))
  return JSON.stringify({
    blueprint: input.blueprint,
    manifest: input.manifest,
    dna: input.dna,
    products: productSample,
  })
}

export function heroCodegenSpec(spec: HeroDesignSpec): Omit<HeroDesignSpec, 'layers' | 'motionProfile'> {
  return {
    archetype: spec.archetype,
    dominantElement: spec.dominantElement,
    imageTreatment: spec.imageTreatment,
    headline: spec.headline,
    tagline: spec.tagline,
    secondaryCard: spec.secondaryCard,
    ctaLabel: spec.ctaLabel,
    secondaryCtaLabel: spec.secondaryCtaLabel,
    spacingRhythm: spec.spacingRhythm,
    trustBadges: spec.trustBadges,
    rationale: spec.rationale,
  }
}

export function createHeroPromptSpec(spec: HeroDesignSpec, secondaryCardEnabled = false): HeroDesignSpec {
  return {
    ...spec,
    secondaryCard: secondaryCardEnabled && spec.secondaryCard?.kind && spec.secondaryCard.kind !== 'none'
      ? spec.secondaryCard
      : { kind: 'none', position: 'float-below', fields: {} },
  }
}

const SHARED_RULES = `Return only JavaScript. No markdown.
Use React.createElement only. Do not use JSX, imports, exports, TypeScript, template literals, window, document, localStorage, postMessage, useState, useContext, createContext, or any hooks.
Use only callback props provided. ASCII only.
Icons may only be inline svg with circle, rect, line, or ellipse shapes and strokeWidth:2.
Do not destructure the props parameter in the function signature (no \`function StorefrontHero({ store, ... })\`). Always write \`function StorefrontHero(props)\` and access fields via props.field or a local destructure inside the body if needed.
CRITICAL: any time you render an array with .map(), the outermost React.createElement call inside
that map MUST include a unique "key" prop in its props object. Use the array item's own stable
value (e.g. category name, product id, feature text) as the key, never the array index alone if a
stable value is available. Do not return a mapped list without a key prop; this is a failed component.
Every mapped list item needs its own key or React will throw console errors and misrender on updates.
Do not pass an array literal of React.createElement(...) nodes as a child, especially inside headings.
Use separate child arguments instead, or give every element in the array a stable key prop.`

function promptForHero(input: BuildInput, spec: HeroDesignSpec): string {
  const voice = input.blueprint.brandVoice || 'clear, friendly, professional'
  const secondaryCardEnabled = false
  const promptSpec = createHeroPromptSpec(spec, secondaryCardEnabled)
  const codegenSpec = heroCodegenSpec(promptSpec)
  const designBookBlock = buildDesignBookPromptBlock(spec.spacingRhythm, spec.imageTreatment)
  const secondaryCardBlock = secondaryCardEnabled && promptSpec.secondaryCard?.kind && promptSpec.secondaryCard.kind !== 'none'
    ? `
SECONDARY CARD — implement only if secondaryCard.kind !== "none":
Render a visually distinct elevated card (background var(--store-surface), border var(--store-border), radius var(--store-radius-card), soft drop shadow) positioned according to secondaryCard.position. Use a negative margin or absolute positioning relative to the hero image/container to achieve the overlap; do not place it side-by-side. Render ONLY the fields present in secondaryCard.fields. Do not invent any field not listed. If kind is "pricing-tile", show fields.price as the dominant numeric value and fields.unit as small muted text. If kind is "subscribe-offer", render fields.discountPercent only if it exists and keep copy grounded in real storeFeatures. STACKING RULE, non-negotiable when a secondary card is present: the card must never overlap the headline, tagline, or subtext text — verify its position value keeps it clear of the text block entirely (e.g. "float-right" or "overlap-bottom-*" means anchored to the IMAGE side/corner, not drifting into the text column). The card needs its own stacking context (position: relative or absolute with a defined z-index higher than the image but not overlapping text) and a solid var(--store-surface) background with full opacity — never a semi-transparent fill that lets the image or other text show through it. If you cannot guarantee non-overlapping placement for the chosen archetype, render the card in its "float-below" position instead of forcing a float-right or overlap position — a correctly-placed card below the fold beats a garbled overlapping one. This card must be a plain function-scoped element inside StorefrontHero — no separate component, no useState.`
    : ''
  return `${SHARED_RULES}
Brand data: ${brandContext(input)}

DESIGN SPEC — implement this exactly, do not deviate from the archetype or CTA hierarchy:
${JSON.stringify(codegenSpec)}

Archetype meanings:
  soft shadow) on the other, with a row of small pill-shaped trust chips beneath the CTAs.

Write function StorefrontHero(props) for props { store, products, features, onShopNow, onOpenCart }.
Use dominantElement="${spec.dominantElement}" to decide visual weight, imageTreatment="${spec.imageTreatment}" for how the image (if any) is composited, spacingRhythm="${spec.spacingRhythm}" for padding scale (tight=2-3rem, generous=4-6rem, editorial=6-8rem vertical).
If props.heroImageUrl is present, render it as the hero background/media image. Do not ignore the provided hero image and fall back to a generic gradient when a real hero image was supplied.
Primary CTA label must be exactly "${promptSpec.ctaLabel}" and call props.onShopNow(). ${promptSpec.secondaryCtaLabel ? `Secondary action label "${promptSpec.secondaryCtaLabel}" must look visually subordinate (outline/ghost) and call props.onOpenCart().` : 'Do not add a secondary button.'}
This hero has TWO distinct text elements, rendered separately — never merge them:
1. BRAND LABEL — a small eyebrow/label element showing props.store.displayName or store.displayName exactly once. This is NOT the H1. Render it as a small tag, badge, or label above the headline (font-size smaller than the headline, e.g. an eyebrow-style span or small heading).
2. MARKETING HEADLINE — the large <h1> element. Its text must be exactly "${promptSpec.headline}". Do not use store.displayName as the H1 text. Do not paraphrase or invent different headline copy.
The tagline text must be exactly "${promptSpec.tagline}", rendered as supporting copy below the headline.

STABLE CLASSNAME CONTRACT — every one of these classNames is mandatory and must match EXACTLY,
because Seltra's chat-edit system locates and replaces this text by className after generation.
Missing or renamed classNames make headline/tagline/button edits silently fail for the merchant.

- Brand label / eyebrow element: className must include "seltra-hero-brand-label"
- The <h1> marketing headline: className must include "seltra-hero-headline"
- The tagline <p>: className must include "seltra-hero-tagline"
- If a subtext/description paragraph is rendered: className must include "seltra-hero-subtext"
- Primary CTA button: className must be exactly "${CTA_CLASSES.primary}" (already required above)
- Secondary CTA button (if present): className must be exactly "${CTA_CLASSES.secondary}" (already required above)

These classNames may be combined with other classNames on the same element (e.g.
className: 'seltra-hero-headline some-other-class') — just make sure the exact string
"seltra-hero-headline" (etc.) appears somewhere in the className value.
Do not use the className "seltra-hero-secondary" anywhere in this component — secondary cards are disabled for this generation.
Render the CTA row inside a wrapper with className "seltra-hero-actions" and use separate button/link elements for the primary and secondary actions. The primary button's className must be exactly "${CTA_CLASSES.primary}" and the secondary button's className (if present) must be exactly "${CTA_CLASSES.secondary}" — see the HERO DESIGN BOOK section above for why this is mandatory.

${designBookBlock}

MANDATORY ROOT STRUCTURE — copy this shape exactly, only filling in your content:
React.createElement('div', { className: 'seltra-hero', 'data-archetype': '${spec.archetype}' },
  React.createElement('div', { className: 'seltra-hero-content' }, /* headline, tagline, CTAs, badges go HERE */),
  React.createElement('div', { className: 'seltra-hero-media' }, /* ONLY the image or gradient div goes HERE — no text, no headline, no buttons */)
)
seltra-hero-content and seltra-hero-media MUST be siblings at the same level, both direct children
of the root seltra-hero div. Never nest one inside the other. Never put a headline, paragraph,
button, or badge anywhere inside seltra-hero-media.

CONTRAST RULE, non-negotiable: any outline/ghost button (secondary CTA) or pill-shaped chip must use a border and text color with clear contrast against var(--store-bg). Never use var(--store-border) or var(--store-muted) for text color, and never use opacity below 0.85 on button or chip text. Use var(--store-accent) or var(--store-text) for outline-button text and border, not var(--store-muted). A secondary CTA that is hard to read against its own background is a failed component.

${promptSpec.trustBadges.length > 0 ? `Beneath the CTA row, render a horizontal row of ${promptSpec.trustBadges.length} small pill-shaped chips with these exact labels, in order: ${JSON.stringify(promptSpec.trustBadges)}. Each chip: border var(--store-border), radius var(--store-radius-full), small text with color var(--store-text), and background var(--store-surface) or a very light tint derived from var(--store-accent). Do not add any other badges, stars, or numbers beyond these exact strings — do not invent ratings or review counts.` : 'Do not render any trust badges or credibility chips.'}
${secondaryCardBlock}

DO NOT, under any circumstances, invent or render: a star rating, a review count, "X reviews", a
"loved by customers" card, a "trusted by" badge, a testimonial, or any other social-proof element —
even if it feels visually natural for this archetype. This is a brand-new store with zero orders;
any such element would be a fabricated, deceptive claim. The ONLY credibility elements allowed are
the exact trustBadges chips listed above (or none, if the list is empty).

If imageTreatment is not "none", composite the image behind text with a solid scrim/gradient overlay
(var(--store-text) at low opacity, or a dark linear-gradient) strong enough that headline text has
clear contrast — do not rely on the image's own contrast, and never let any secondary text or a
ghost/duplicate of the headline show through the image itself.
For image-heavy archetypes, especially editorial-commerce, lifestyle-scrim-cart, and fullbleed-bottom-text,
this is mandatory even when the image sits in the media sibling: include an explicit scrim/overlay element
or gradient layer inside seltra-hero-media using className "seltra-hero-scrim" or a clear linear-gradient /
rgba overlay. The scrim is a contrast layer only; never render text, badges, buttons, or card labels inside it.

COHESION RULE: if imageTreatment !== "none" and archetype is split-image-right/left, the text panel and the image panel must read as one hero, not two separate cards. Either:
(a) give both panels the same border-radius and remove any background-color difference between them beyond the image itself (no flat gray/neutral fill behind the text — use var(--store-bg) or a subtle var(--store-accent-soft) tint, never a mid-gray placeholder fill), or
(b) composite the text directly over the image with a scrim per the existing scrim rules.
Never render the text panel as an unstyled gray box — that reads as a broken/placeholder state, not a design choice. If there is no real product image, use a gradient background derived from var(--store-accent) and var(--store-bg), never a generic gray.

If imageTreatment is not "none", give the image container element a className "seltra-hero-media"
in addition to any other classes so the parent stylesheet can make the hero image responsive on
narrow viewports. You do not need to write any @media query, <style> tag, or CSS yourself;
just ensure the className "seltra-hero-media" is present on the hero image wrapper.
Structure contract for the shared stylesheet: the root hero container should include className "seltra-hero" and data-archetype="${spec.archetype}"; the text column should use className "seltra-hero-content". Do not set inline style objects with position, top/right/bottom/left, or zIndex on these elements — the shared stylesheet owns that layout contract.
Brand voice: ${voice} — supporting copy must sound like this, not generic filler.
Use CSS variables var(--store-bg), var(--store-surface), var(--store-text), var(--store-muted), var(--store-accent), var(--store-accent-text), var(--store-border), var(--store-radius-card), var(--store-radius-full).
Product images: if you reference props.products[i], the correct path is
props.products[i].images?.find(im => im.isPrimary)?.url ?? props.products[i].images?.[0]?.url — 
there is NO "image" (singular) property. Never render an <img> without first checking the url is
truthy; if it's falsy, render a plain CSS gradient div instead, never an <img> with an empty/undefined src.
Reference props.store.displayName exactly ONCE in the entire component — never repeat the brand name
in a second element (no duplicate badge, pill, or secondary heading with the same text). Do not assign
props.store.displayName to a local variable and then render that variable; use it directly in the one
label element only.
End with the closing brace of StorefrontHero.`
}

  function secondaryCardIsNestedInMedia(source: string): boolean {
    const secIdx = source.indexOf('seltra-hero-secondary')
    if (secIdx === -1) return true
    const mediaIdx = source.lastIndexOf('seltra-hero-media', secIdx)
    if (mediaIdx === -1) return false
    const mediaCreateIdx = source.lastIndexOf('React.createElement', mediaIdx)
    if (mediaCreateIdx === -1) return false

    let depth = 0
    let inString: string | null = null
    let escaped = false
    for (let i = source.indexOf('(', mediaCreateIdx); i < source.length; i++) {
      const char = source[i]
      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === inString) {
          inString = null
        }
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        inString = char
        continue
      }
      if (char === '(') {
        depth++
        continue
      }
      if (char === ')') {
        depth--
        if (depth === 0) {
          return false
        }
        continue
      }
      if (i >= secIdx && depth > 0) {
        return true
      }
    }
    return false
  }
  
  function heroContentSeparationValid(source: string): boolean {
    // If there's an explicit seltra-hero-content sibling, accept as valid.
    const contentIdx = source.indexOf('seltra-hero-content')
    if (contentIdx !== -1) return true

    // No explicit content sibling — allow this unless the media container itself contains
    // primary textual elements (headline, tagline, CTAs or props.store.displayName),
    // which indicates the model stuffed all content into the image wrapper.
    const mediaIdx = source.indexOf('seltra-hero-media')
    if (mediaIdx === -1) return true

    // find the React.createElement that creates the media at or after mediaIdx
    const mediaCreateIdx = source.lastIndexOf('React.createElement', mediaIdx)
    if (mediaCreateIdx === -1) return true

    // locate end of that createElement call
    let p = source.indexOf('(', mediaCreateIdx)
    if (p === -1) return true
    let depth = 0
    let inString: string | null = null
    let escaped = false
    while (p < source.length) {
      const ch = source[p]
      if (inString) {
        if (escaped) { escaped = false } else if (ch === '\\') { escaped = true } else if (ch === inString) { inString = null }
        p++
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { inString = ch; p++; continue }
      if (ch === '(') { depth++; p++; continue }
      if (ch === ')') { depth--; p++; if (depth === 0) break; continue }
      p++
    }
    const mediaEndPos = p

    // examine the media contents for textual/createElement nodes.
    // Allow a single headline or single text node, but reject when multiple
    // textual elements (headline, paragraph, CTA-like elements) appear inside
    // the media container — this is the Notion-Hub anti-pattern.
    const mediaContent = source.slice(mediaIdx, mediaEndPos)
    const textualTagRegex = /React\.createElement\(\s*['\"](h1|h2|h3|p|button|a|div)['\"]/gi
    let match: RegExpExecArray | null
    let textualCount = 0
    while ((match = textualTagRegex.exec(mediaContent)) !== null) {
      // skip divs that are clearly image containers by heuristics (className: 'img' or 'seltra-hero-image')
      const tag = match[1].toLowerCase()
      const start = match.index
      const snippet = mediaContent.slice(start, start + 200)
      const lookbehind = mediaContent.slice(Math.max(0, start - 120), start)
      // skip elements that are rendered inside a .map() callback - content separation shouldn't
      // count mapped list item nodes as hero textual content for this heuristic.
      if (/\.map\s*\(/.test(lookbehind)) continue
      if (tag === 'div' && /className\s*:\s*['\"](?:img|seltra-hero-image)['\"]/.test(snippet)) continue
      textualCount++
      if (textualCount > 2) return false
    }
    return true
  }

export function navRootStructureValid(source: string): boolean {
  const rootPattern = /React\.createElement\(\s*['"](?:header|nav)['"]\s*,/g
  let rootMatch: RegExpExecArray | null
  while ((rootMatch = rootPattern.exec(source)) !== null) {
    const open = source.indexOf('(', rootMatch.index)
    if (open === -1) continue
    let depth = 0
    let braceDepth = 0
    let bracketDepth = 0
    let quote: string | null = null
    let escaped = false
    const argumentsList: string[] = []
    let argumentStart = open + 1
    let callEnd = -1
    for (let index = open; index < source.length; index++) {
      const character = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = null
        continue
      }
      if (character === '"' || character === "'" || character === '`') quote = character
      else if (character === '(') depth++
      else if (character === ')') {
        depth--
        if (depth === 0) {
          argumentsList.push(source.slice(argumentStart, index))
          callEnd = index
          break
        }
      } else if (character === '{') braceDepth++
      else if (character === '}') braceDepth--
      else if (character === '[') bracketDepth++
      else if (character === ']') bracketDepth--
      else if (character === ',' && depth === 1 && braceDepth === 0 && bracketDepth === 0) {
        argumentsList.push(source.slice(argumentStart, index))
        argumentStart = index + 1
      }
    }
    if (callEnd === -1 || argumentsList.length < 6 || !/className\s*:\s*['"][^'"]*\bseltra-nav\b/i.test(argumentsList[1])) continue
    const childArguments = argumentsList.slice(2)
    const requiredMarkers = [
      /seltra-hamburger/,
      /seltra-desktop-cats/,
      /\b(?:CartIcon|onOpenCart)\b/,
      /\b(?:logoUrl|displayName|brandContent|brandMark|seltra-nav-brand|seltra-logo)\b/,
    ]
    if (requiredMarkers.every((marker) => childArguments.some((child) => marker.test(child)))) return true
  }
  return false
}

export function deriveNavDesignSpec(input: Pick<BuildInput, 'blueprint'>): NavDesignSpec {
  const categories = input.blueprint.productCategories ?? []
  const composition = resolveComposition(input.blueprint.businessType ?? '')
  const eligible = (composition.navStyle === 'mega-dropdown' || ['electronics', 'tech', 'logistics'].some((token) => `${input.blueprint.businessType ?? ''} ${categories.join(' ')}`.toLowerCase().includes(token))) && categories.length >= 4

  if (!eligible) {
    return { style: 'flat' }
  }

  const groups = [
    { label: 'Shop', items: categories.slice(0, 2) },
    { label: 'Explore', items: categories.slice(2) },
  ].filter((group) => group.items.length > 0)

  return {
    style: 'mega-dropdown',
    dropdownGroups: groups,
  }
}

function promptForNav(input: BuildInput, navSpec: NavDesignSpec | null = null): string {
  const spec = navSpec ?? deriveNavDesignSpec(input)
  const dropdownBlock = spec.style === 'mega-dropdown'
    ? `
When the navigation style is mega-dropdown, you may add a sibling element with className "seltra-dropdown-panel" next to the category row. It must be hidden by default, then exposed through CSS-only :focus-within or data-open behavior. Keep the parent component in charge of interaction state; do not render your own hamburger drawer or use useState. The panel may include groups from the design spec: ${JSON.stringify(spec.dropdownGroups ?? [])}.`
    : ''

  return `${SHARED_RULES}
Brand data: ${brandContext(input)}

Design spec: ${JSON.stringify(spec)}

Write function StorefrontNav(props) for props { displayName, logoUrl, businessType, categories, cartCount, CartIcon, onOpenCart, onCategoryClick, onLogoClick, onToggleMenu, menuOpen }.
It is ONLY the top bar — never render a dropdown, panel, or mobile menu list yourself; a parent component owns and renders that.
Below 768px width (use a media query in inline style via matchMedia is NOT allowed — instead ALWAYS render a hamburger button that calls props.onToggleMenu(), and rely on CSS to hide/show it: render both the desktop category row and the hamburger button always, and use CSS media queries embedded as a <style> string is not allowed either — instead give the hamburger button a className "seltra-hamburger" and the desktop category row a className "seltra-desktop-cats"; the parent stylesheet hides/shows them responsively.
Correct hamburger pattern example (copy this shape exactly, only changing the icon):
React.createElement('button', { className: 'seltra-hamburger', onClick: props.onToggleMenu }, React.createElement('svg', { viewBox: '0 0 24 24', width: 24, height: 24 }, ...))
Do NOT set inline display or visibility styles on the hamburger button or the desktop category row. Those elements must be visible or hidden only through the shared stylesheet media query, not via explicit \`display:\` or \`visibility:\` values rendered in the component.
Do NOT branch on window width in JS. Do NOT use props.menuOpen to change your own layout — that state belongs to the parent panel, not you.
Category buttons call props.onCategoryClick(category). Logo calls props.onLogoClick(). Cart calls props.onOpenCart().
The nav must be a polished standard commerce header, not raw unstyled text. Use exactly these direct sibling roles under the seltra-nav root: brand mark className "seltra-brand-mark"; desktop category row className "seltra-desktop-cats"; hamburger button className "seltra-hamburger"; cart button className "seltra-cart-button". The shared stylesheet lays these into a three-column layout: brand left, categories centered on desktop, hamburger and cart grouped on the right on mobile. Do not add wrappers around these four roles, do not use inline display or visibility, and do not invent extra controls. The brand text must be exactly props.displayName or displayName. The cart control must render React.createElement(props.CartIcon, { width: 20, height: 20 }) and put the numeric cart count in a child with className "seltra-cart-count". Hide the count when props.cartCount is zero; never show a zero badge. Do not add a visible "Cart" text label. The hamburger must call props.onToggleMenu() and be a sibling immediately before the cart on mobile.
If props.logoUrl is present and truthy, render it as an img inside the brand mark element. Otherwise render the full displayName as a text wordmark with className "seltra-brand-name". Never render an initial-letter badge, generic circle, placeholder icon, or invented logo.
Use CSS variables var(--store-bg), var(--store-surface), var(--store-text), var(--store-muted), var(--store-accent), var(--store-accent-text), var(--store-border), var(--store-radius-full).
Category buttons come from props.categories.map(...) — each button's React.createElement call
must include { key: category, onClick: ... } (or similar), using the category string itself as
the key. Do not omit the key prop on any mapped element.${dropdownBlock}
End with the closing brace of StorefrontNav.`
}

function promptFor(role: Role, input: BuildInput, spec: HeroDesignSpec | NavDesignSpec | null): string {
  return role === 'hero' ? promptForHero(input, spec as HeroDesignSpec) : promptForNav(input, spec as NavDesignSpec | null)
}

function deterministicHeroSource(): string {
  return `function StorefrontHero(props) {
  const store = props.store || {};
  const primaryLabel = props.primaryCtaLabel || "Shop now";
  const secondaryLabel = props.secondaryCtaLabel || "Browse products";
  const headline = props.headline || store.displayName || store.name || "Shop the collection";
  const tagline = props.tagline || "Fresh picks, ready when you are.";
  const heroImageUrl = props.heroImageUrl;
  const media = heroImageUrl
    ? React.createElement("div", { className: "seltra-hero-media", style: { minHeight: "320px", overflow: "hidden", background: "var(--store-surface)" } },
        React.createElement("img", { src: heroImageUrl, alt: "", className: "seltra-hero-image", style: { minHeight: "320px" } }),
        React.createElement("div", { className: "seltra-hero-scrim", style: { background: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.34))" } })
      )
    : React.createElement("div", { className: "seltra-hero-media", style: { minHeight: "320px", background: "linear-gradient(135deg, var(--store-accent-soft), var(--store-surface))" } });
  return React.createElement("section", { className: "seltra-hero", "data-archetype": "split-image-right", style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 0.9fr)", gap: "clamp(1.5rem, 4vw, 4rem)", alignItems: "center", padding: "clamp(3rem, 7vw, 6rem) clamp(1.5rem, 5vw, 5rem)", background: "var(--store-bg)", color: "var(--store-text)" } },
    React.createElement("div", { className: "seltra-hero-content", style: { display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "620px" } },
      React.createElement("p", { className: "seltra-hero-brand-label", style: { margin: 0, color: "var(--store-accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "0.75rem", fontWeight: 700 } }, store.businessType || "Featured"),
      React.createElement("h1", { className: "seltra-hero-headline", style: { margin: 0, fontFamily: "var(--store-heading-font)", fontSize: "clamp(2.75rem, 7vw, 5.5rem)", lineHeight: 0.95 } }, headline),
      React.createElement("p", { className: "seltra-hero-tagline", style: { margin: 0, color: "var(--store-muted)", fontSize: "1rem", lineHeight: 1.7 } }, tagline),
      React.createElement("div", { className: "seltra-hero-actions", style: { display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem" } },
        React.createElement("button", { type: "button", className: "seltra-hero-cta-primary", onClick: props.onShopNow }, primaryLabel),
        React.createElement("button", { type: "button", className: "seltra-hero-cta-secondary", onClick: props.onOpenCart }, secondaryLabel)
      )
    ),
    media
  );
}`
}

function deterministicNavSource(): string {
  return `function StorefrontNav(props) {
  const categories = props.categories || [];
  const displayName = props.displayName || "Store";
  const logoUrl = props.logoUrl;
  const first = categories[0] || "Products";
  const second = categories[1] || "Featured";
  const third = categories[2] || "About";
  const fourth = categories[3] || "Contact";
  return React.createElement("header", { className: "seltra-nav", style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "1rem clamp(1.25rem, 4vw, 4rem)", borderBottom: "1px solid var(--store-border)", background: "var(--store-bg)", color: "var(--store-text)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 } },
      logoUrl
        ? React.createElement("img", { src: logoUrl, alt: "", style: { width: "2rem", height: "2rem", borderRadius: "var(--store-radius-full)", objectFit: "cover", flexShrink: 0 } })
        : React.createElement("span", { style: { display: "inline-flex", width: "2rem", height: "2rem", alignItems: "center", justifyContent: "center", borderRadius: "var(--store-radius-full)", background: "var(--store-accent)", color: "var(--store-accent-text)", fontWeight: 800 } }, String(displayName).charAt(0)),
      React.createElement("strong", { style: { fontFamily: "var(--store-heading-font)", fontSize: "1.1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, displayName)
    ),
    React.createElement("nav", { className: "seltra-desktop-cats", style: { alignItems: "center", gap: "1rem", fontSize: "0.9rem", color: "var(--store-muted)" } },
      React.createElement("a", { href: "#products" }, first),
      React.createElement("a", { href: "#featured" }, second),
      React.createElement("a", { href: "#about" }, third),
      React.createElement("a", { href: "#contact" }, fourth)
    ),
    React.createElement("button", { type: "button", onClick: props.onOpenCart, style: { border: "1px solid var(--store-border)", borderRadius: "var(--store-radius-full)", background: "var(--store-surface)", color: "var(--store-text)", width: "2.5rem", height: "2.5rem" } }, React.createElement(props.CartIcon, { width: 18, height: 18 })),
    React.createElement("button", { type: "button", className: "seltra-hamburger", "aria-label": "Menu", onClick: props.onToggleMenu, style: { border: "1px solid var(--store-border)", borderRadius: "var(--store-radius-full)", background: "var(--store-surface)", color: "var(--store-text)", width: "2.5rem", height: "2.5rem" } }, "Menu")
  );
}`
}

async function buildOne(
  role: Role,
  input: BuildInput,
  spec: HeroDesignSpec | NavDesignSpec | null,
  onAttempt?: (event: HeroNavAttemptEvent) => void,
) {
  const maxTokens = 9000
  let prompt: string
  try {
    prompt = promptFor(role, input, spec)
  } catch (err) {
    const rawError = err instanceof Error ? err.message : String(err)
    onAttempt?.({ role, attempt: 0, model: 'prompt-builder', ok: false, reason: rawError })
    console.warn(`[HeroNav] prompt builder failed for ${role}: ${rawError}`)
    return { source: null, provider: 'codegen:null', error: `${role} prompt builder failed: ${rawError}` }
  }
  const cfRole = role === 'hero' ? 'hero' : 'generic'
  const temperature = role === 'hero' ? 0.13 : 0.1
  const cfModels = getRoleCandidates(cfRole)
  const attempts = cfModels.map((model) => ({
    label: model.split('/').pop() ?? model,
    model,
  }))

  let lastError: string | null = null
  let lastSnippet = ''

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const attempt = attempts[attemptIndex]
    const contextSuffix = lastError
      ? `\nPREVIOUS ATTEMPT FAILED: ${lastError}. Do not repeat that mistake. Previous attempt began: ${lastSnippet.slice(0, 400)}`
      : ''
    const contextualPrompt = `${prompt}${contextSuffix}`

    try {
      const result = await cfCodegen([{ role: 'user', content: contextualPrompt }], maxTokens, { model: attempt.model, temperature })
      const source = repairChunk(result.content)
      const gate = chunkPassesGateWithReason(source, role, { requiresHeroImage: role === 'hero' && Boolean(input.heroImageUrl) })

      onAttempt?.({ role, attempt: attemptIndex + 1, model: attempt.label, ok: gate.ok, reason: gate.reason })

      if (gate.ok) return { source, provider: result.provider, error: null }

      lastError = gate.reason ?? 'gate rejection'
      lastSnippet = source.slice(0, 400)
      console.warn(`[HeroNav] gate rejected ${role} on ${attempt.label}: ${gate.reason}`)
      console.warn(`[HeroNav] ${attempt.label} rejected ${role}: ${gate.reason}\n---source(first 600 chars)---\n${source.slice(0, 600)}`)
    } catch (err) {
      const rawError = err instanceof Error ? err.message : String(err)
      onAttempt?.({ role, attempt: attemptIndex + 1, model: attempt.label, ok: false, reason: rawError })
      lastError = rawError
      lastSnippet = rawError.slice(0, 400)
      console.warn(`[HeroNav] ${attempt.label} failed for ${role}: ${rawError}`)
    }
  }

  return { source: null, provider: 'codegen:null', error: `${role} failed validation after ${attempts.length} model attempts: ${lastError ?? 'unknown error'}` }
}

export async function generateHeroNavSources(
  input: BuildInput,
  dna: StoreDNA | null = null,
  onAttempt?: (event: HeroNavAttemptEvent) => void,
): Promise<{
  heroSource: string | null
  navSource: string | null
  heroSpec: HeroDesignSpec
  provider: string
  error: string | null
}> {
  const [heroSpec, navSpec] = await Promise.all([
    designHero(input.blueprint, dna ?? input.dna ?? null, input.products),
    designNav(input.blueprint, dna ?? input.dna ?? null),
  ])
  const [hero, nav] = await Promise.all([
    buildOne('hero', input, heroSpec, onAttempt),
    buildOne('nav', input, navSpec, onAttempt),
  ])
  return {
    heroSource: hero.source,
    navSource: nav.source,
    heroSpec,
    provider: `hero:${hero.provider},nav:${nav.provider},design:${heroSpec.archetype}`,
    error: [hero.error, nav.error].filter(Boolean).join('; ') || null,
  }
}

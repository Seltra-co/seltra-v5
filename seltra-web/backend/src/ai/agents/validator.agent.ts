//seltra-web/backend/src/ai/agents/validator.agent.ts

// Seltra Post-Render Validator — checks the generated HTML for real problems.
// Runs after codegen. If critical issues are found, triggers surgical repair
// rather than full regeneration.

export interface ValidationIssue {
  id:       string
  severity: 'critical' | 'warning'
  message:  string
  repair:   string
}

export interface ValidationReport {
  passed:   boolean
  issues:   ValidationIssue[]
  score:    number
}

// ── HTML analysis helpers ─────────────────────────────────────────────────────

function extractText(html: string, selector: string): string[] {
  // Simple regex-based extraction — avoids DOM dependency in Node.js
  const tag = selector.replace('.', '').replace('#', '')
  const matches: string[] = []
  const re = new RegExp(`class="[^"]*${tag}[^"]*"[^>]*>([^<]{1,200})`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    matches.push(m[1].trim())
  }
  return matches
}

function hasElement(html: string, pattern: string): boolean {
  return new RegExp(pattern, 'i').test(html)
}

function countOccurrences(html: string, pattern: string): number {
  return (html.match(new RegExp(pattern, 'gi')) ?? []).length
}

// ── Validation checks ─────────────────────────────────────────────────────────

function validateHeroPresent(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!hasElement(html, 'class="hero')) {
    issues.push({
      id: 'html-hero-missing',
      severity: 'critical',
      message: 'No hero section found in rendered HTML.',
      repair: 'REGENERATE_HERO',
    })
  }
  return issues
}

function validateProductCards(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cardCount = countOccurrences(html, 'class="pcard')

  if (cardCount === 0) {
    issues.push({
      id: 'html-no-products',
      severity: 'critical',
      message: 'No product cards rendered. Products may have failed to inject.',
      repair: 'REGENERATE_PRODUCT_GRID',
    })
  }

  return issues
}

function validateProductNames(html: string, businessName: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const names = extractText(html, 'pcard-name')

  if (names.length === 0) return issues

  // Detect when product names are just the businessName repeated with a suffix
  // e.g. "A luxury skincare brand for young women Starter Set"
  const genericPattern = names.filter(n =>
    n.toLowerCase().includes(businessName.toLowerCase().slice(0, 20))
  )

  if (genericPattern.length >= names.length * 0.6) {
    issues.push({
      id: 'html-generic-product-names',
      severity: 'warning',
      message: `${genericPattern.length}/${names.length} product names appear to be generated from the business name prompt, not real product names.`,
      repair: 'FLAG_PRODUCT_NAMES',
    })
  }

  return issues
}

function validateHeroHeadline(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Extract h1 text
  const h1Match = html.match(/<h1[^>]*>([^<]{1,200})<\/h1>/)
  if (!h1Match) return issues

  const headline = h1Match[1].trim()

  // Flag if headline is more than 6 words (likely the full prompt)
  if (headline.split(/\s+/).length > 6) {
    issues.push({
      id: 'html-hero-headline-too-long',
      severity: 'warning',
      message: `Hero headline "${headline.slice(0, 60)}..." is too long. Should be a short brand name.`,
      repair: 'FLAG_HERO_HEADLINE',
    })
  }

  return issues
}

function validateCheckoutButton(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!hasElement(html, 'checkout-btn|checkout_btn|Checkout')) {
    issues.push({
      id: 'html-no-checkout',
      severity: 'critical',
      message: 'No checkout button found. Cart cannot complete purchases.',
      repair: 'REGENERATE_CART',
    })
  }

  return issues
}

function validateCartScript(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!hasElement(html, 'function addToCart') && !hasElement(html, 'addToCart')) {
    issues.push({
      id: 'html-no-cart-script',
      severity: 'critical',
      message: 'Cart JavaScript missing. Add-to-cart will not function.',
      repair: 'REGENERATE_SCRIPTS',
    })
  }

  return issues
}

function validateFonts(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!hasElement(html, 'fonts.googleapis.com')) {
    issues.push({
      id: 'html-no-font-import',
      severity: 'warning',
      message: 'No Google Fonts import found. Typography will fall back to system fonts.',
      repair: 'FLAG_FONTS',
    })
  }

  return issues
}

function validateMinimumLength(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // A real storefront should be substantial
  if (html.length < 8000) {
    issues.push({
      id: 'html-too-short',
      severity: 'critical',
      message: `HTML is only ${html.length} chars. Expected at least 8000 for a real storefront.`,
      repair: 'FULL_REGENERATION',
    })
  }

  return issues
}

function validateSectionManifestComment(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!hasElement(html, 'SELTRA_MANIFEST')) {
    issues.push({
      id: 'html-no-manifest-comment',
      severity: 'warning',
      message: 'SELTRA_MANIFEST comment missing. StorefrontCanvas cannot extract theme data.',
      repair: 'FLAG_MANIFEST',
    })
  }

  return issues
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function scoreValidation(issues: ValidationIssue[]): number {
  const PENALTY: Record<string, number> = { critical: 30, warning: 8 }
  const penalty = issues.reduce((s, i) => s + (PENALTY[i.severity] ?? 0), 0)
  return Math.max(0, 100 - penalty)
}

// ── Repair dispatcher ─────────────────────────────────────────────────────────
// Maps repair codes to actionable metadata the caller can act on.
export interface RepairAction {
  type:    'full_regeneration' | 'flag_only' | 'patch'
  target?: string
  reason:  string
}

export function resolveRepairs(report: ValidationReport): RepairAction[] {
  if (report.passed) return []

  const actions: RepairAction[] = []
  const criticalRepairs = report.issues
    .filter(i => i.severity === 'critical')
    .map(i => i.repair)

  if (criticalRepairs.includes('FULL_REGENERATION')) {
    actions.push({ type: 'full_regeneration', reason: 'HTML output too short — full regeneration required' })
    return actions  // Full regen supersedes all other repairs
  }

  if (criticalRepairs.includes('REGENERATE_HERO')) {
    actions.push({ type: 'full_regeneration', reason: 'Hero section missing from rendered output' })
    return actions
  }

  if (criticalRepairs.includes('REGENERATE_PRODUCT_GRID')) {
    actions.push({ type: 'patch', target: 'product-grid', reason: 'Product cards not rendered' })
  }

  if (criticalRepairs.includes('REGENERATE_CART')) {
    actions.push({ type: 'patch', target: 'cart', reason: 'Checkout button missing' })
  }

  if (criticalRepairs.includes('REGENERATE_SCRIPTS')) {
    actions.push({ type: 'full_regeneration', reason: 'Cart JavaScript missing' })
    return actions
  }

  // Warnings are flagged only — no automatic repair
  const warnings = report.issues.filter(i => i.severity === 'warning')
  for (const w of warnings) {
    actions.push({ type: 'flag_only', reason: w.message })
  }

  return actions
}

// ── Main export ───────────────────────────────────────────────────────────────
export function validateStorefrontHtml(
  html:         string,
  businessName: string,
): ValidationReport {
  const issues: ValidationIssue[] = [
    ...validateMinimumLength(html),
    ...validateHeroPresent(html),
    ...validateProductCards(html),
    ...validateProductNames(html, businessName),
    ...validateHeroHeadline(html),
    ...validateCheckoutButton(html),
    ...validateCartScript(html),
    ...validateFonts(html),
    ...validateSectionManifestComment(html),
  ]

  const score    = scoreValidation(issues)
  const critical = issues.filter(i => i.severity === 'critical')

  const report: ValidationReport = {
    passed: score >= 70 && critical.length === 0,
    issues,
    score,
  }

  if (!report.passed) {
    console.warn(`[Validator] FAILED — score ${score}/100, ${critical.length} critical issues:`)
    critical.forEach(i => console.warn(`  ✗ ${i.id}: ${i.message}`))
  } else {
    const warnings = issues.filter(i => i.severity === 'warning')
    if (warnings.length > 0) {
      console.log(`[Validator] PASSED (${score}/100) with ${warnings.length} warnings`)
    } else {
      console.log(`[Validator] PASSED (${score}/100) — clean output`)
    }
  }

  return report
}
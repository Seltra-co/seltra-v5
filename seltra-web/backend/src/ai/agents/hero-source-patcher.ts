export interface HeroTextOverrides {
  headline?: string
  tagline?: string
  eyebrow?: string
  ctaLabel?: string
  secondaryCtaLabel?: string
}

function findCallEnd(source: string, callStart: number): number {
  const open = source.indexOf('(', callStart)
  if (open === -1) return -1
  let depth = 0
  let quote: string | null = null
  let escaped = false
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
    else if (character === ')' && --depth === 0) return index
  }
  return -1
}

function spliceElementText(source: string, matcher: RegExp, newText: string): string {
  const match = matcher.exec(source)
  if (!match || match.index === undefined) return source
  const callStart = source.lastIndexOf('React.createElement', match.index)
  if (callStart === -1) return source
  const open = source.indexOf('(', callStart)
  const callEnd = findCallEnd(source, callStart)
  if (open === -1 || callEnd === -1) return source

  let lastComma = open + 1
  let parenDepth = 1
  let braceDepth = 0
  let bracketDepth = 0
  let quote: string | null = null
  let escaped = false
  for (let index = open + 1; index < callEnd; index++) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === '`') quote = character
    else if (character === '(') parenDepth++
    else if (character === ')') parenDepth--
    else if (character === '{') braceDepth++
    else if (character === '}') braceDepth--
    else if (character === '[') bracketDepth++
    else if (character === ']') bracketDepth--
    else if (character === ',' && parenDepth === 1 && braceDepth === 0 && bracketDepth === 0) lastComma = index + 1
  }

  const argument = source.slice(lastComma, callEnd)
  const literal = /^(\s*)(['"])([\s\S]*)(\2)(\s*)$/.exec(argument)
  if (!literal) return source
  return source.slice(0, lastComma) + literal[1] + JSON.stringify(newText) + literal[5] + source.slice(callEnd)
}

export function patchHeroSourceText(source: string, overrides: HeroTextOverrides): string {
  let patched = source
  if (overrides.headline !== undefined) patched = spliceElementText(patched, /React\.createElement\(\s*['"]h1['"][\s\S]*?className\s*:\s*['"][^'"]*seltra-hero-headline/i, overrides.headline)
  if (overrides.tagline !== undefined) patched = spliceElementText(patched, /React\.createElement\(\s*['"]p['"][\s\S]*?className\s*:\s*['"][^'"]*seltra-hero-tagline/i, overrides.tagline)
  if (overrides.eyebrow !== undefined) patched = spliceElementText(patched, /className\s*:\s*['"][^'"]*seltra-hero-brand-label/i, overrides.eyebrow)
  if (overrides.ctaLabel !== undefined) patched = spliceElementText(patched, /className\s*:\s*['"][^'"]*seltra-hero-cta-primary/i, overrides.ctaLabel)
  if (overrides.secondaryCtaLabel !== undefined) patched = spliceElementText(patched, /className\s*:\s*['"][^'"]*seltra-hero-cta-secondary/i, overrides.secondaryCtaLabel)
  return patched
}
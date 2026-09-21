//seltra-web/backend/src/ai/agents/color-lexicon.ts
export const COLOR_LEXICON: Record<string, string> = {
  black: '#050505',
  white: '#ffffff',
  cream: '#fff7ed',
  ivory: '#fffff0',
  beige: '#f5f5dc',
  red: '#dc2626',
  orange: '#f97316',
  yellow: '#eab308',
  gold: '#b8860b',
  green: '#16a34a',
  grean: '#16a34a',
  emerald: '#059669',
  blue: '#2563eb',
  navy: '#1e3a8a',
  navyblue: '#1e3a8a',
  purple: '#7c3aed',
  violet: '#7c3aed',
  mauve: '#8b5cf6',
  move: '#8b5cf6',
  pink: '#ec4899',
  rose: '#e11d48',
  brown: '#92400e',
  grey: '#6b7280',
  gray: '#6b7280',
  slate: '#475569',
}

export const COLOR_LEXICON_HINT = Object.entries(COLOR_LEXICON)
  .map(([name, hex]) => `${name}=${hex}`)
  .join(', ')

export function resolveNamedColor(input?: string): string | null {
  if (!input) return null
  const normalized = input.toLowerCase().replace(/[^a-z0-9#]/g, '')
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized
  return COLOR_LEXICON[normalized] ?? null
}

export function findNamedColor(text: string): { name: string; hex: string } | null {
  const lower = text.toLowerCase()
  const entries = Object.entries(COLOR_LEXICON).sort((a, b) => b[0].length - a[0].length)
  let best: { name: string; hex: string; index: number } | null = null
  for (const [name, hex] of entries) {
    const match = new RegExp(`\\b${name}\\b`, 'i').exec(lower)
    if (match && (!best || match.index > best.index)) best = { name, hex, index: match.index }
  }
  return best ? { name: best.name, hex: best.hex } : null
}

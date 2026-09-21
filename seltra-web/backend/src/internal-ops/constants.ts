export const PAID_STATUSES = ['paid', 'completed'] as const
export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export type MoneyDto = { amount: string; currency: string }

export function money(amount: { toString(): string } | number | string | null | undefined, currency = 'GHS'): MoneyDto {
  const raw = amount == null ? '0' : amount.toString()
  const normalized = Number.isFinite(Number(raw)) ? Number(raw).toFixed(2) : raw
  return { amount: normalized, currency }
}

export function parseBasedIn(basedIn: string | null | undefined): { city: string | null; country: string | null } {
  if (!basedIn) return { city: null, country: null }
  const index = basedIn.lastIndexOf(',')
  if (index <= 0 || index === basedIn.length - 1) return { city: null, country: null }
  const city = basedIn.slice(0, index).trim()
  const country = basedIn.slice(index + 1).trim()
  return city && country ? { city, country } : { city: null, country: null }
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

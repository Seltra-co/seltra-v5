export function safeDate(value: unknown, fallback: Date | number | string | null = null): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? (fallback ? safeDate(fallback, null) : null) : new Date(value.getTime())
  }

  if (value === null || value === undefined || value === '') {
    return fallback === null ? null : safeDate(fallback, null)
  }

  let timestamp: number
  if (typeof value === 'number') {
    timestamp = value < 100_000_000_000 ? value * 1000 : value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback === null ? null : safeDate(fallback, null)

    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed)
      timestamp = numeric < 100_000_000_000 ? numeric * 1000 : numeric
    } else {
      const parsed = new Date(trimmed)
      timestamp = parsed.getTime()
    }
  } else {
    return fallback === null ? null : safeDate(fallback, null)
  }

  if (!Number.isFinite(timestamp)) {
    return fallback === null ? null : safeDate(fallback, null)
  }

  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? (fallback === null ? null : safeDate(fallback, null)) : date
}

export function safeISOString(value: unknown, fallback: Date | number | string = Date.now()): string | undefined {
  const date = safeDate(value, fallback)
  return date ? date.toISOString() : undefined
}

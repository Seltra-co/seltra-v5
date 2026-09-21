//ai/utils/json-repair.util.ts
export function cleanJSON(raw: string): string {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  return cleaned.trim()
}

// Repairs JSON truncated mid-stream (ran out of maxTokens). Closes any
// dangling string, strips a trailing comma/partial key, and balances
// unclosed [ ] and { } based on raw bracket counts. Works for both a
// truncated single object (blueprint) and a truncated array of objects
// (products) since it just balances whatever brackets are open.
export function repairTruncatedJSON(raw: string): string {
  let s = raw.trim()
  s = s.replace(/,\s*$/, '')
  const quotePositions: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) {
      quotePositions.push(i)
    }
  }
  if (quotePositions.length % 2 !== 0) {
    s = s + '"'
  }
  s = s.replace(/,\s*"?\s*$/, '')
  const unclosedArrays =
    (s.match(/\[/g) ?? []).length - (s.match(/\]/g) ?? []).length
  const unclosedObjects =
    (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length
  s += ']'.repeat(Math.max(0, unclosedArrays))
  s += '}'.repeat(Math.max(0, unclosedObjects))
  return s
}
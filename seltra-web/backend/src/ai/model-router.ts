export type ModelRole = 'reasoning' | 'default' | 'fast' | 'vision' | 'image'

export function modelFor(role: ModelRole): { model: string; fallback?: string } {
  const key = role === 'default' ? 'AI_MODEL_DEFAULT' : `AI_MODEL_${role.toUpperCase()}`
  return {
    model: process.env[key] ?? '',
    fallback: process.env[`${key}_FALLBACK`] || undefined,
  }
}

export function roleTokenWeight(role: ModelRole) {
  const key = `CREDIT_WEIGHT_${role.toUpperCase()}`
  const value = Number(process.env[key] ?? 1)
  return Number.isFinite(value) && value >= 0 ? value : 1
}

export function creditCost(tokensIn: number, tokensOut: number, role: ModelRole) {
  const minimum = Math.max(1, Number(process.env.CREDITS_MIN_CHARGE_PER_CALL ?? 1) || 1)
  const weight = roleTokenWeight(role)
  const metered = Math.ceil(((Math.max(0, tokensIn) + Math.max(0, tokensOut)) / 1000) * weight)
  return Math.max(minimum, metered)
}

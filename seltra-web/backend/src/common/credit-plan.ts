//backend/src/common/credit-plan.ts
export const TOKENS_PER_CREDIT = 1_000

export function tokenAllowanceForPlan(plan?: string | null) {
  const freeDefault = 20_000_000
  const base = Number(process.env.MODEL_MAX_TOKENS_PER_WORKSPACE ?? freeDefault)
  const freeAllowance = Number.isFinite(base) && base > 0 ? Math.floor(base) : freeDefault
  if (plan === 'premium' || plan === 'pro') {
    const configuredPro = Number(process.env.SELTRA_PRO_MAX_TOKENS_PER_WORKSPACE ?? freeAllowance * 5)
    return Number.isFinite(configuredPro) && configuredPro > 0 ? Math.floor(configuredPro) : freeAllowance * 5
  }
  return freeAllowance
}

export function creditAllowanceForPlan(plan?: string | null) {
  return Math.ceil(tokenAllowanceForPlan(plan) / TOKENS_PER_CREDIT)
}

export function nextUtcCreditReset(from = new Date()) {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1))
  return next
}

export function isCreditWindowExpired(startedAt: Date, now = new Date()) {
  return Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate()) <
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

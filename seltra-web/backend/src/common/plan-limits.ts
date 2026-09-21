//common/plan-limits.ts
/*
Tier limits (1 store/50 products free → 3 stores/100 products premium)
 */
export type PlanTier = 'free' | 'premium'

export function planLimits(plan?: string | null) {
  const tier: PlanTier = plan === 'premium' ? 'premium' : 'free'
  return {
    tier,
    maxStores: tier === 'premium' ? 3 : 1,
    maxProductsPerStore: tier === 'premium' ? 100 : 50,
  }
}

export function getStoreCreationError(plan?: string | null, currentStoreCount = 0) {
  const limits = planLimits(plan)
  if (currentStoreCount >= limits.maxStores) {
    if (limits.tier === 'premium') {
      return `Premium allows up to ${limits.maxStores} stores.`
    }
    return 'Free tier allows 1 store. Upgrade to Premium to launch additional stores.'
  }
  return null
}
import { creditCost, modelFor } from '../ai/model-router'
import { PHASE_LABELS } from '../build/run-types'

describe('V5 run reliability helpers', () => {
  it('uses environment-only model routing', () => {
    process.env.AI_MODEL_DEFAULT = 'env-builder-model'
    expect(modelFor('default').model).toBe('env-builder-model')
  })

  it('calculates a minimum deterministic credit charge', () => {
    process.env.CREDITS_MIN_CHARGE_PER_CALL = '1'
    process.env.CREDIT_WEIGHT_DEFAULT = '1'
    expect(creditCost(1, 1, 'default')).toBe(1)
  })

  it('provides all shared phase labels and specific sub-statuses', () => {
    expect(Object.keys(PHASE_LABELS)).toEqual([
      'understand', 'analyze', 'plan', 'build', 'inspect', 'improve', 'polish', 'verify',
    ])
    expect(PHASE_LABELS.verify.detail).toContain('Checkout')
  })
})

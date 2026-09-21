import { getStoreCreationError } from '../common/plan-limits'

describe('planLimits', () => {
  it('blocks a free-tier merchant from creating a second store', () => {
    expect(getStoreCreationError('free', 1)).toContain('Free tier allows 1 store')
  })

  it('allows premium merchants to stay within their store quota', () => {
    expect(getStoreCreationError('premium', 2)).toBeNull()
    expect(getStoreCreationError('premium', 3)).toContain('Premium allows up to 3 stores')
  })
})

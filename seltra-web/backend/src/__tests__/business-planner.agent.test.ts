jest.mock('../providers/cloudflare', () => ({
  CF_MODELS: { PLANNER_FAST: 'planner-fast', PLANNER_FALLBACK: 'planner-fallback' },
  isModelAvailable: jest.fn(),
  callCloudflare: jest.fn(),
}))
jest.mock('../ai/client', () => ({ chat: jest.fn() }))

import { callCloudflare, isModelAvailable } from '../providers/cloudflare'
import { chat } from '../ai/client'
import { planFromPrompt } from '../ai/agents/business-planner.agent'

describe('business planner minimum questionnaire', () => {
  beforeEach(() => jest.clearAllMocks())

  it('replaces an empty or ready model result with exactly one contextual question', async () => {
    ;(isModelAvailable as jest.Mock).mockReturnValue(true)
    ;(callCloudflare as jest.Mock).mockResolvedValue({ content: JSON.stringify({ readyToBuild: true, questions: [], inferredSummary: 'A coffee shop.' }) })

    const result = await planFromPrompt('A coffee shop for local commuters')

    expect(result.readyToBuild).toBe(false)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0].question).toContain('drinks')
  })

  it('returns exactly one fallback question when every planner model fails', async () => {
    ;(isModelAvailable as jest.Mock).mockReturnValue(false)
    ;(chat as jest.Mock).mockRejectedValue(new Error('unavailable'))

    const result = await planFromPrompt('A clothing shop for runners')

    expect(result.readyToBuild).toBe(false)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0].question).toContain('clothing')
  })
})

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

  it('does not ask commerce questions for a portfolio prompt', async () => {
    ;(isModelAvailable as jest.Mock).mockReturnValue(true)
    ;(callCloudflare as jest.Mock).mockResolvedValue({
      content: JSON.stringify({
        readyToBuild: false,
        questions: [{
          id: 'audience',
          question: 'Who are the main customers for your products, and what design style should the store use?',
          why: 'This helps shape the storefront.',
        }],
        inferredSummary: 'A graphic designer portfolio.',
      }),
    })

    const result = await planFromPrompt('A portfolio page for a freelance graphic designer')

    expect(result.questions).toHaveLength(1)
    expect(result.questions[0].question).toMatch(/clients or projects/i)
    expect(result.questions[0].question).not.toMatch(/products|store/i)
  })

  it('asks a project-relevant fallback question if the planner is unavailable', async () => {
    ;(isModelAvailable as jest.Mock).mockReturnValue(false)
    ;(chat as jest.Mock).mockRejectedValue(new Error('unavailable'))

    const result = await planFromPrompt('A portfolio page for a freelance graphic designer')

    expect(result.questions).toHaveLength(1)
    expect(result.questions[0].question).toMatch(/clients or projects/i)
  })
})

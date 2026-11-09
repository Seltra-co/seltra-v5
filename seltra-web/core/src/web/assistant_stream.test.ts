import { describe, expect, it } from 'vitest'
import { projectAssistantStreamText } from '../../../frontend/lib/workbench/assistant-stream'

describe('projectAssistantStreamText', () => {
  it('suppresses tool and implementation chatter while preserving user-facing text', () => {
    expect(projectAssistantStreamText([
      'I am laying out the product page.',
      'Playwright could not start because node_modules are missing.',
      'There is no terminal available.',
      'The product page is ready for review.',
    ].join('\n'))).toBe('I am laying out the product page.\nThe product page is ready for review.')
  })

  it('leaves verified preview status to Core state events', () => {
    expect(projectAssistantStreamText('Preview ready. I finished the build.')).toBe('')
  })
})


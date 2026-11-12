jest.mock('../db', () => ({ prisma: {} }))
jest.mock('../auth/resolve-user', () => ({ resolveUserIdFromAuthorization: jest.fn() }))

import { workflowEventType, workflowPayload } from '../build/run.service'

describe('run workflow event mapping', () => {
  it('maps file.written to a normalized, bounded path and byte count only', () => {
    const payload = workflowPayload('file.written', {
      path: '  src\\pages\\.\\index.tsx  ',
      bytes: 128,
      sha256: 'a'.repeat(64),
      content: 'must not be forwarded',
    })

    expect(workflowEventType('file.written')).toBe('file_written')
    expect(payload).toEqual({ path: 'src/pages/index.tsx', bytes: 128 })
    expect(Object.keys(payload)).toEqual(['path', 'bytes'])
  })

  it('limits the file path to 240 characters', () => {
    const payload = workflowPayload('file.written', { path: `${'a'.repeat(250)}.tsx`, bytes: 1 })
    expect((payload.path as string)).toHaveLength(240)
  })

  it.each([
    [{ executed: true, exitCode: 0 }, 'Build passed'],
    [{ executed: true, exitCode: 2 }, 'Build failed (exit 2)'],
    [{ executed: true, exitCode: 2, timedOut: true }, 'Build timed out'],
  ])('maps build.result to status message %s', (payload, message) => {
    expect(workflowEventType('build.result')).toBe('status')
    expect(workflowPayload('build.result', payload)).toEqual({ message })
  })

  it('maps agent narration to a bounded, user-visible workflow message', () => {
    const narration = 'The agent is building the storefront.'
    expect(workflowEventType('agent.narration')).toBe('message')
    expect(workflowPayload('agent.narration', { summary: narration })).toEqual({ summary: narration })
    expect(workflowPayload('agent.narration', { summary: 'a'.repeat(1300) }).summary).toHaveLength(1200)
  })

  it.each([
    'For every new build request, the first visible assistant output must be exactly one sentence.',
    '<think>private reasoning</think>',
    '{"debug":"internal state"}',
  ])('does not expose prompt instructions, reasoning, or raw JSON narration', (summary) => {
    expect(workflowPayload('agent.narration', { summary })).toEqual({})
  })

  it('maps run start and completion to concise user-facing updates', () => {
    expect(workflowPayload('run.started', {})).toEqual({ status: 'Starting your build' })
    expect(workflowEventType('run.completed')).toBe('message')
    expect(workflowPayload('run.completed', {})).toEqual({ summary: 'Your app is ready to preview.' })
  })

  it('filters prompt leaks and JSON from every user-visible message mapping', () => {
    expect(workflowPayload('phase.changed', { status: '{"internal":"state"}' })).toEqual({ status: 'Working' })
    expect(workflowPayload('run.completed', { summary: '<think>private thoughts</think>' })).toEqual({ summary: 'Your app is ready to preview.' })
    expect(workflowPayload('run.summary', { summary: 'The first visible assistant output is a system prompt.' }).summary)
      .toBe('Build complete. The preview passed its HTTP 200 check.')
  })
})

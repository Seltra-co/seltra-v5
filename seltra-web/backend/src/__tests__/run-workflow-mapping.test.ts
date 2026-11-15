jest.mock('../db', () => ({ prisma: {} }))
jest.mock('../auth/resolve-user', () => ({ resolveUserIdFromAuthorization: jest.fn() }))

import { prisma } from '../db'
import { resolveUserIdFromAuthorization } from '../auth/resolve-user'
import { RunService, workflowEventType, workflowPayload } from '../build/run.service'

describe('run workflow event mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma as any).tenant = {
      findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
      findUnique: jest.fn().mockResolvedValue({ heroSnapshotUrl: 'https://example.test/hero.png' }),
    }
    ;(prisma as any).tenantApp = {
      findFirst: jest.fn().mockResolvedValue({ heroSnapshotUrl: 'https://example.test/hero.png', lastPushedSha: 'abc123def456', lastCommitSha: 'abc123def456' }),
    }
    ;(prisma as any).projectSnapshot = {
      findFirst: jest.fn().mockResolvedValue({ id: 'snapshot-1', runId: 'run-1', label: 'Build completed', createdAt: new Date() }),
      findMany: jest.fn().mockResolvedValue([{ id: 'snapshot-1', runId: 'run-1', label: 'Build completed', kind: 'final', createdAt: new Date() }]),
    }
    ;(prisma as any).projectFile = {
      findMany: jest.fn().mockResolvedValue([{ projectId: 'project-1', path: 'src/App.tsx', contentHash: 'hash' }]),
    }
    ;(prisma as any).run = {
      findFirst: jest.fn().mockResolvedValue({ id: 'run-1', state: 'running', phase: 'building', workspaceId: 'workspace-1' }),
    }
    ;(resolveUserIdFromAuthorization as jest.Mock).mockResolvedValue('user-1')
  })
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
    expect(workflowPayload('run.completed', { status: 'degraded', reasons: ['placeholder image fallback', 'browser QA unavailable'], summary: 'App ready with warnings.' })).toEqual({
      status: 'degraded',
      reasons: ['placeholder image fallback', 'browser QA unavailable'],
      summary: 'App ready with warnings.',
    })
  })

  it('accepts planner-style questionnaire payloads and save/restore lifecycle events', () => {
    expect(workflowPayload('questionnaire.requested', { questionnaire: [{ id: 'brand' }] })).toEqual({ questionCount: 1, questions: [{ id: 'brand' }] })
    expect(workflowPayload('save.state', { state: 'saved', sha: 'a'.repeat(64), filesCount: 3 })).toEqual({ state: 'saved', sha: 'a'.repeat(64), filesCount: 3 })
    expect(workflowPayload('restore.state', { state: 'ready', reason: 'Preview is ready.' })).toEqual({ state: 'ready', reason: 'Preview is ready.' })
  })

  it('filters prompt leaks and JSON from every user-visible message mapping', () => {
    expect(workflowPayload('phase.changed', { status: '{"internal":"state"}' })).toEqual({ status: 'Working' })
    expect(workflowPayload('run.completed', { summary: '<think>private thoughts</think>' })).toEqual({ summary: 'Your app is ready to preview.' })
    expect(workflowPayload('run.summary', { summary: 'The first visible assistant output is a system prompt.' }).summary)
      .toBe('Build complete. The preview passed its HTTP 200 check.')
  })

  it('returns a restore payload with durable save state and replay metadata', async () => {
    const service = new RunService({} as any)
    const result = await service.restore('project-1', 'Bearer token')

    expect(resolveUserIdFromAuthorization).toHaveBeenCalledWith('Bearer token', expect.anything())
    expect(result.saveState).toBe('saved')
    expect(result.lastSavePointSha).toBe('abc123def456')
    expect(result.heroUrl).toBe('https://example.test/hero.png')
    expect(result.replay).toEqual({
      runId: 'run-1',
      eventsUrl: '/api/v5/runs/run-1/events',
      checkpoints: [{ id: 'snapshot-1', runId: 'run-1', label: 'Build completed', kind: 'final', createdAt: expect.any(Date) }],
    })
    expect(result.sandbox).toEqual({ state: 'running', runId: 'run-1', workspaceId: 'workspace-1' })
    expect(result.snapshot).toEqual({ id: 'snapshot-1', runId: 'run-1', label: 'Build completed', createdAt: expect.any(Date) })
  })
})

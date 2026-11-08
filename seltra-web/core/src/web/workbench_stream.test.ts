import { describe, expect, it, vi } from 'vitest'
import { DEV_STREAM_REPLAY, replayWorkbench, transitionWorkbench, type WorkbenchState } from '../../../frontend/lib/workbench/stream-store'

const empty: WorkbenchState = { layout: 'chat-wide', phase: 'idle', projectName: '', intent: '', currentStep: '', steps: [], questionnaire: false, tipDismissed: false, previewUrl: '', error: '' }

describe('workbench layout state machine', () => {
  it('starts wide, opens split for questions/build, then changes to live on preview-ready', () => {
    expect(transitionWorkbench(empty, { type: 'send' }).layout).toBe('chat-wide')
    const asking = transitionWorkbench(empty, { type: 'questionnaire' })
    expect(asking).toMatchObject({ layout: 'split', phase: 'asking', questionnaire: true })
    const building = transitionWorkbench(asking, { type: 'build-started' })
    expect(building).toMatchObject({ layout: 'split', phase: 'building', questionnaire: false })
    expect(transitionWorkbench(building, { type: 'preview-ready', url: 'https://preview.example.test' })).toMatchObject({ layout: 'live', phase: 'ready' })
  })

  it('replays the complete stream at recorded event timing', async () => {
    vi.useFakeTimers()
    let state = transitionWorkbench(empty, { type: 'send' })
    const replay = replayWorkbench(DEV_STREAM_REPLAY, (event) => { state = transitionWorkbench(state, event) })
    await vi.runAllTimersAsync()
    await replay
    expect(state).toMatchObject({ layout: 'live', phase: 'ready', projectName: 'Service Catalog', questionnaire: false, previewUrl: 'about:blank#seltra-replay' })
    expect(state.steps).toContainEqual(expect.objectContaining({ title: 'Service catalog created', status: 'done' }))
    vi.useRealTimers()
  })

  it('keeps friendly failures in chat/preview state and never falls back to raw detail', () => {
    expect(transitionWorkbench(empty, { type: 'failed', friendlyMessage: 'Seltra couldn’t start the preview. Retry to continue.' }).error)
      .toBe('Seltra couldn’t start the preview. Retry to continue.')
  })
})

import { describe, expect, it } from 'vitest'
import {
  enqueueBrowserQaEvent,
  previewOverlayTransition,
  takePendingBrowserQaEvents,
} from '../../../frontend/lib/core/preview-qa'

describe('dashboard browser QA state', () => {
  it('does not show the preview overlay for a WebSocket console error', () => {
    expect(previewOverlayTransition({
      type: 'console-log',
      message: '[vite] failed to connect to websocket',
    })).toBeNull()
  })

  it('shows the overlay for preview.failed and clears it for preview.ready', () => {
    expect(previewOverlayTransition({ type: 'preview.failed' })).toEqual({
      action: 'set',
      reason: 'PREVIEW_FAILED',
    })
    expect(previewOverlayTransition({ type: 'preview.ready' })).toEqual({ action: 'clear' })
  })

  it('buffers browser QA until a run ID arrives, then drains it', () => {
    const buffer: Array<{ status: string }> = []
    const event = { status: 'passed' }

    expect(enqueueBrowserQaEvent(buffer, event)).toBe(false)
    expect(takePendingBrowserQaEvents(buffer)).toEqual([])
    expect(buffer).toEqual([event])
    expect(takePendingBrowserQaEvents(buffer, 'run-1')).toEqual([event])
    expect(buffer).toEqual([])
  })
})

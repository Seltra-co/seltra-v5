import { describe, expect, it } from 'vitest'
import { activityFor } from '../../../frontend/components/dashboard/WorkflowProgressCard'
import { applyWorkflowEvent, isWorkflowEvent, type WorkflowEvent } from '../../../frontend/lib/builder/run-events'
import { blueprintPlaceholderDataUrl, generateBlueprintPhotoAssets } from '../../../frontend/lib/workbench/blueprint-assets'
import { projectAssistantOpeningText } from '../../../frontend/lib/workbench/assistant-stream'

function event(seq: number, type: WorkflowEvent['type'], payload: Record<string, unknown>): WorkflowEvent {
  return { runId: 'run-1', seq, ts: new Date(seq * 1000).toISOString(), phase: 'building', type, payload }
}

describe('workflow progress card', () => {
  it('shows a concise headline for build progress and grouped files', () => {
    expect(activityFor(event(1, 'task_updated', { current: 'Creating the catalog page' }), 0)).toBe('Creating the catalog page')
    expect(activityFor(event(2, 'file_written', {}), 6)).toBe('Writing 6 files')
    expect(activityFor(event(3, 'status', { message: 'Build passed' }), 6)).toBe('Build passed')
  })

  it('shows a stable completion headline', () => {
    expect(activityFor({ ...event(1, 'message', { summary: 'Your app is ready.' }), phase: 'ready' }, 0))
      .toBe('Your app is ready to preview')
  })

  it('only projects a safe first sentence into the build conversation', () => {
    expect(projectAssistantOpeningText('I am planning a beauty storefront.\n<dyad-write path="src/App.tsx">'))
      .toBe('I am planning a beauty storefront.')
    expect(projectAssistantOpeningText('For every new build request, your first visible assistant output must be exactly one sentence.'))
      .toBe('')
    expect(projectAssistantOpeningText('{"internal":"state"}')).toBe('')
  })

  it('uses a generated branded SVG when photo generation has no configured fallback', async () => {
    const [asset] = await generateBlueprintPhotoAssets(
      [{ type: 'photo', description: 'Hero portrait', prompt: 'A premium beauty portrait' }],
      {
        generate: async () => { throw new Error('Image generation failed (HTTP 404).') },
        saveGenerated: async () => 'public/assets/unused.png',
      },
    )
    expect(asset.status).toBe('fallback')
    expect(asset.path).toBe(blueprintPlaceholderDataUrl(asset))
    expect(asset.path).toMatch(/^data:image\/svg\+xml,%3Csvg/)
  })

  it('accepts file_written and keeps contiguous append and dedupe behavior', () => {
    const task = event(1, 'task_updated', { tasks: [] })
    const file = event(2, 'file_written', { path: 'src/App.tsx', bytes: 10 })
    expect(isWorkflowEvent(file)).toBe(true)
    expect(applyWorkflowEvent([task], file)).toEqual([task, file])
    expect(applyWorkflowEvent([task, file], file)).toEqual([task, file])
    expect(applyWorkflowEvent([task], event(3, 'file_written', {}))).toEqual([task])
  })
})

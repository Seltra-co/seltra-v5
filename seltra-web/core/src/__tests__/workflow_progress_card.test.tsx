import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowProgressCard } from '../../../frontend/components/dashboard/WorkflowProgressCard'
import { applyWorkflowEvent, isWorkflowEvent, type WorkflowEvent } from '../../../frontend/lib/builder/run-events'

function event(seq: number, type: WorkflowEvent['type'], payload: Record<string, unknown>): WorkflowEvent {
  return { runId: 'run-1', seq, ts: new Date(seq * 1000).toISOString(), phase: 'building', type, payload }
}

describe('workflow progress card', () => {
  it('keeps the latest task snapshot visible alongside subsequent file events', () => {
    const events = [
      event(1, 'task_updated', { tasks: [{ id: 'task-1', title: 'Create the catalog page', state: 'in_progress' }] }),
      event(2, 'file_written', { path: 'src/App.tsx', bytes: 200 }),
      event(3, 'file_written', { path: 'src/index.css', bytes: 100 }),
      event(4, 'file_written', { path: 'package.json', bytes: 80 }),
      event(5, 'status', { message: 'Build passed' }),
    ]

    const markup = renderToStaticMarkup(<WorkflowProgressCard events={events} />)
    expect(markup).toContain('Create the catalog page')
    expect(markup).toContain('3 files written')
    expect(markup).toContain('src/App.tsx')
    expect(markup).toContain('src/index.css')
    expect(markup).toContain('package.json')
    expect(markup).toContain('data-state="in-progress"')
    expect(markup).toContain('package.json · writing')
    expect(markup).toContain('Build passed')
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

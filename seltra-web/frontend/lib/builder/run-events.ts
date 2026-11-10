export type WorkflowPhase = 'planning' | 'awaiting_approval' | 'preparing' | 'building' | 'verifying' | 'ready' | 'failed'
export type WorkflowEventType = 'phase_changed' | 'status' | 'task_updated' | 'asset_updated' | 'preview_state' | 'message' | 'error'

export type WorkflowEvent = {
  runId: string
  seq: number
  ts: string
  phase: WorkflowPhase
  type: WorkflowEventType
  actor?: 'planner' | 'builder' | 'supervisor'
  payload: Record<string, unknown>
}

export function isWorkflowEvent(value: unknown): value is WorkflowEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<WorkflowEvent>
  return typeof event.runId === 'string' && Number.isSafeInteger(event.seq) && (event.seq ?? 0) > 0 &&
    typeof event.ts === 'string' && ['planning', 'awaiting_approval', 'preparing', 'building', 'verifying', 'ready', 'failed'].includes(event.phase ?? '') &&
    (event.actor === undefined || ['planner', 'builder', 'supervisor'].includes(event.actor)) &&
    ['phase_changed', 'status', 'task_updated', 'asset_updated', 'preview_state', 'message', 'error'].includes(event.type ?? '') &&
    Boolean(event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload))
}

/** Applies replayed/live events exactly once and rejects gaps or reordering. */
export function applyWorkflowEvent(current: WorkflowEvent[], incoming: WorkflowEvent): WorkflowEvent[] {
  const last = current.at(-1)
  if (last && (incoming.runId !== last.runId || incoming.seq <= last.seq || incoming.seq !== last.seq + 1)) return current
  return [...current, incoming]
}

export function lastWorkflowSeq(events: WorkflowEvent[]) {
  return events.at(-1)?.seq ?? 0
}

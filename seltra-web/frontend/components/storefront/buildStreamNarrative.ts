//seltra-web/frontend/components/storefront/buildStreamNarrative.ts
export type PlanItem = { label: string; detail: string }

export type NarrativeEntry =
  | { kind: 'thought'; seconds: number; text: string }
  | { kind: 'action'; title: string; subtext?: string; imageUrl?: string; status: 'active' | 'done' }
  | { kind: 'plan'; items: PlanItem[] }

type StreamEvent =
  | { type: 'plan'; items: PlanItem[] }
  | { type: 'step'; step: string; status: 'started' | 'completed' | 'failed'; label?: string }
  | { type: 'preview'; url: string }
  | { type: 'error'; message: string }

export function deriveNarrativeEntries(previous: NarrativeEntry[], event: StreamEvent): NarrativeEntry[] {
  const next = [...previous]

  if (event.type === 'plan') {
    return [...next, { kind: 'plan', items: event.items }]
  }

  if (event.type === 'step') {
    const label = event.label ?? event.step

    if (event.status === 'started') {
      next.push({ kind: 'thought', seconds: 0, text: `${label} is underway` })
      next.push({ kind: 'action', title: label, subtext: 'Starting now', status: 'active' })
    }

    if (event.status === 'completed') {
      const lastActionIndex = next.findLastIndex((entry) => entry.kind === 'action' && entry.title === label)
      if (lastActionIndex >= 0) {
        const entry = next[lastActionIndex]
        if (entry.kind === 'action') {
          next[lastActionIndex] = {
            kind: 'action',
            title: entry.title,
            subtext: 'Completed',
            imageUrl: entry.imageUrl,
            status: 'done',
          }
        }
      } else {
        next.push({ kind: 'action', title: label, subtext: 'Completed', status: 'done' })
      }
    }

    return next.slice(-20)
  }

  if (event.type === 'preview') {
    return [...next, {
      kind: 'action',
      title: 'Preview is ready',
      subtext: 'The storefront preview is refreshing',
      imageUrl: event.url,
      status: 'active',
    }]
  }

  return next
}

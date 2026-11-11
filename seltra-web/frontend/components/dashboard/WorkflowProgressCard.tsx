'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { WorkflowEvent } from '@/lib/builder/run-events'

export function WorkflowProgressCard({ events, onRetry, onRetryAsset }: { events: WorkflowEvent[]; onRetry?: () => void; onRetryAsset?: (prompt: string) => Promise<void> }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const latest = events.at(-1)
  if (!latest) return null
  const phaseLabels: Record<WorkflowEvent['phase'], string> = {
    planning: 'Planning your app', awaiting_approval: 'Plan ready for your approval', preparing: 'Preparing your app',
    building: 'Building your app', verifying: 'Checking your app', ready: 'Preview ready', failed: 'Build needs attention',
  }
  const taskSnapshot = [...events].reverse().find((event) => event.type === 'task_updated')
  const tasks = taskSnapshot && Array.isArray(taskSnapshot.payload.tasks) ? taskSnapshot.payload.tasks.slice(0, 6) : []
  const filesByPath = new Map<string, Record<string, unknown>>()
  for (const event of [...events].reverse()) {
    if (event.type === 'file_written' && typeof event.payload.path === 'string' && event.payload.path) {
      filesByPath.set(event.payload.path, event.payload)
    }
  }
  const files = [...filesByPath.entries()].slice(0, 8)
  const assetBySlot = new Map<string, Record<string, unknown>>()
  for (const event of events) if (event.type === 'asset_updated') assetBySlot.set(String(event.payload.slot ?? 'asset'), event.payload)
  const assets = [...assetBySlot.entries()].slice(-4)
  const detail = latest.type === 'error' ? latest.payload.user_message : latest.payload.message
  const summary = latest.type === 'message' ? latest.payload.summary : null
  const buildMessage = [...events].reverse().find((event) => {
    if (event.type !== 'status' || typeof event.payload.message !== 'string') return false
    return event.payload.message === 'Build passed' || event.payload.message === 'Build timed out' || /^Build failed \(exit .+\)$/.test(event.payload.message)
  })?.payload.message
  const previewState = [...events].reverse().find((event) => event.type === 'preview_state')?.payload
  return <section className="w-full max-w-[680px] rounded-2xl border border-white/10 bg-[#171b19] p-4" aria-live="polite">
    <p className="mb-3 text-sm font-medium text-white/70">{phaseLabels[latest.phase]}</p>
    {tasks.length > 0 && <ul className="space-y-2">{tasks.map((item, index) => {
      const task = item as { id?: string; title?: string; state?: string }
      return <li key={task.id ?? index} className="flex items-center gap-2 text-sm text-white/80"><span aria-hidden="true" className={cn('h-2 w-2 rounded-full', task.state === 'completed' ? 'bg-emerald-400' : task.state === 'in_progress' ? 'animate-pulse bg-emerald-300' : 'bg-white/25')} />{task.title}</li>
    })}</ul>}
    {files.length > 0 && <div className="mt-3" aria-label="Files written">
      <p className="mb-1 text-xs text-white/50">{filesByPath.size} files written</p>
      <ul className="space-y-1 text-xs text-white/65">{files.map(([path], index) => <li key={path} data-state={index === 0 ? 'in-progress' : 'written'} className="break-all">{path}{index === 0 ? ' · writing' : ''}</li>)}</ul>
    </div>}
    {assets.length > 0 && <div className="mt-3 flex min-w-0 flex-wrap gap-2">{assets.map(([slot, asset]) => <div key={slot} className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60"><span className="min-w-0 break-words">{slot}: {String(asset.state ?? 'pending')}</span>{(asset.state === 'failed' || asset.state === 'skipped') && typeof asset.prompt === 'string' && onRetryAsset && <button type="button" onClick={() => void onRetryAsset(String(asset.prompt))} className="shrink-0 rounded-full bg-[#22c55e] px-3 py-1 font-semibold text-[#082012] hover:bg-[#4ade80]">Retry</button>}</div>)}</div>}
    {Boolean(previewState && previewState.state !== 'ready') && <p className="mt-2 text-xs text-white/55">Preview: {String(previewState?.state)}{typeof previewState?.reason === 'string' ? ` · ${previewState.reason}` : ''}</p>}
    {typeof summary === 'string' && <p className="mt-3 text-sm leading-5 text-white/80">{summary}</p>}
    {typeof buildMessage === 'string' && <p className="mt-2 text-xs text-white/55">{buildMessage}</p>}
    <button type="button" onClick={() => setDetailsOpen((value) => !value)} className="mt-3 text-xs text-white/50 hover:text-white">{detailsOpen ? 'Hide Details' : 'Details'}</button>
    {detailsOpen && <pre className="mt-2 max-h-32 max-w-full overflow-auto whitespace-pre-wrap break-all text-xs text-white/45">{String(detail ?? JSON.stringify(latest.payload))}</pre>}
    {latest.type === 'error' && latest.payload.retryable === true && <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-[#082012]">Retry</button>}
  </section>
}

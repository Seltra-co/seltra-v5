'use client'

import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Bookmark, BookmarkCheck, Globe2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { WorkflowEvent } from '../../lib/builder/run-events'

type BuildTask = { id?: string; title: string; state?: string }

function isBuildTask(value: unknown): value is BuildTask {
  return typeof value === 'object'
    && value !== null
    && 'title' in value
    && typeof value.title === 'string'
    && (!('id' in value) || typeof value.id === 'string')
    && (!('state' in value) || typeof value.state === 'string')
}

const FOLLOW_UPS = [
  'Polish the mobile layout',
  'Add another section',
  'Help me test the main flow',
]

export function activityFor(event: WorkflowEvent, fileCount: number) {
  const { payload } = event
  if (event.type === 'phase_changed') return String(payload.status ?? 'Working on your app')
  if (event.type === 'task_updated') return String(payload.current ?? 'Updating your build plan')
  if (event.type === 'file_written') return `Writing ${fileCount} file${fileCount === 1 ? '' : 's'}`
  if (event.type === 'asset_updated') {
    const state = String(payload.state ?? '')
    return state === 'generated' || state === 'fallback' ? 'Adding finished artwork' : 'Creating your app artwork'
  }
  if (event.type === 'preview_state') return payload.state === 'ready' ? 'Previewing your app' : 'Starting your preview'
  if (event.type === 'status') return String(payload.message ?? 'Working on your app')
  if (event.type === 'error') return String(payload.user_message ?? 'The build needs attention')
  if (event.type === 'message') return event.phase === 'ready' ? 'Your app is ready to preview' : 'Building your app'
  return 'Working on your app'
}

export function WorkflowProgressCard({
  events,
  openingMessage,
  active = true,
  onRetry,
  onRetryAsset,
  onOpenPreview,
  onFollowUp,
}: {
  events: WorkflowEvent[]
  openingMessage?: string
  active?: boolean
  onRetry?: () => void
  onRetryAsset?: (prompt: string) => Promise<void>
  onOpenPreview?: () => void
  onFollowUp?: (prompt: string) => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const latest = events.at(-1)
  if (!latest) return null

  const taskSnapshot = [...events].reverse().find((event) => event.type === 'task_updated')
  const tasks = taskSnapshot && Array.isArray(taskSnapshot.payload.tasks)
    ? taskSnapshot.payload.tasks.filter(isBuildTask).slice(0, 10)
    : []
  const filesByPath = new Map<string, Record<string, unknown>>()
  for (const event of events) {
    if (event.type === 'file_written' && typeof event.payload.path === 'string' && event.payload.path) {
      filesByPath.set(event.payload.path, event.payload)
    }
  }
  const files = [...filesByPath.entries()].slice(-8).reverse()
  const assetBySlot = new Map<string, Record<string, unknown>>()
  for (const event of events) if (event.type === 'asset_updated') assetBySlot.set(String(event.payload.slot ?? 'asset'), event.payload)
  const assets = [...assetBySlot.entries()].slice(-6)
  const title = activityFor(latest, filesByPath.size)
  const summary = latest.type === 'message' ? latest.payload.summary : null
  const completed = latest.phase === 'ready'
  const planEvent = events.find((event) => event.type === 'phase_changed' && event.payload.appName)
  const appName = planEvent?.payload.appName

  return (
    <section className="w-full max-w-[680px] overflow-hidden rounded-2xl border border-white/10 bg-[#171b19]" aria-live="polite">
      {typeof appName === 'string' && (
        <div className="border-b border-white/10 px-4 py-3">
          <p className="text-sm font-semibold text-white">{String(appName)}</p>
          <p className="mt-1 text-xs text-white/50">Your app plan is ready</p>
        </div>
      )}

      {openingMessage && <p className="border-b border-white/10 px-4 py-3 text-sm leading-6 text-white/75">{openingMessage}</p>}

      <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.025]"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {completed ? <Check className="h-4 w-4 shrink-0 text-emerald-300" /> : <Loader2 className={`h-4 w-4 shrink-0 text-emerald-300${active ? ' animate-spin' : ''}`} />}
          <span className="truncate text-sm font-medium text-white/90">{title}</span>
        </span>
        {detailsOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-white/45" /> : <ChevronRight className="h-4 w-4 shrink-0 text-white/45" />}
      </button>

      {detailsOpen && (
        <div className="space-y-4 border-t border-white/10 px-4 py-3">
          {tasks.length > 0 && (
            <ul className="space-y-2" aria-label="Build checklist">
              {tasks.map((item, index) => {
                const task = item
                return (
                  <li key={task.id ?? index} className="flex items-center gap-2 text-sm text-white/75">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${task.state === 'completed' ? 'bg-emerald-400' : task.state === 'in_progress' ? 'animate-pulse bg-emerald-300' : 'bg-white/25'}`} />
                    <span>{task.title}</span>
                  </li>
                )
              })}
            </ul>
          )}

          {files.length > 0 && (
            <div aria-label="Files written">
              <p className="mb-1.5 text-xs text-white/50">{filesByPath.size} files updated</p>
              <ul className="space-y-1 text-xs text-white/65">{files.map(([path]) => <li key={path} className="break-all">{path}</li>)}</ul>
            </div>
          )}

          {assets.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Generated artwork">
              {assets.map(([slot, asset]) => (
                <div key={slot} className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
                  {typeof asset.url === 'string' && <img src={asset.url} alt="" className="h-20 w-28 object-cover" />}
                  {asset.state === 'fallback' && typeof asset.url !== 'string' && <div className="grid h-20 w-28 place-items-center bg-gradient-to-br from-[#f8f4ee] via-[#e8d8c2] to-[#c5a77e] text-[10px] font-medium text-[#5f5143]">Brand placeholder</div>}
                  <div className="flex max-w-36 items-center gap-2 px-2 py-1.5 text-[11px] text-white/60">
                    <span className="truncate">{slot}</span>
                    {(asset.state === 'failed' || asset.state === 'skipped') && typeof asset.prompt === 'string' && onRetryAsset && (
                      <button type="button" onClick={() => void onRetryAsset(String(asset.prompt))} className="shrink-0 rounded-full bg-[#22c55e] px-2 py-0.5 font-semibold text-[#082012] hover:bg-[#4ade80]">Retry</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {typeof summary === 'string' && summary && (
        <p className="border-t border-white/10 px-4 py-3 text-sm leading-6 text-white/80">{summary}</p>
      )}

      {latest.type === 'error' && latest.payload.retryable === true && (
        <div className="border-t border-white/10 px-4 py-3">
          <button type="button" onClick={onRetry} className="rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-[#082012]">Retry build</button>
        </div>
      )}

      {completed && (
        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{typeof appName === 'string' ? `Added ${appName}` : 'Your app is ready'}</p>
              <p className="mt-1 text-xs text-white/45">Build complete</p>
            </div>
            <button type="button" onClick={() => setBookmarked((value) => !value)} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark version'} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white">
              {bookmarked ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setDetailsOpen((value) => !value)} className="flex-1 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/70 hover:bg-white/5">Details</button>
            <button type="button" onClick={onOpenPreview} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-200 hover:bg-blue-500/15"><Globe2 className="h-3.5 w-3.5" /> Previewing</button>
          </div>
        </div>
      )}

      {completed && onFollowUp && (
        <div className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-3">
          {FOLLOW_UPS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => onFollowUp(prompt)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65 hover:border-white/20 hover:text-white">{prompt}</button>
          ))}
        </div>
      )}
      <p className="px-4 pb-3 text-[11px] text-white/35">{new Date(latest.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
    </section>
  )
}

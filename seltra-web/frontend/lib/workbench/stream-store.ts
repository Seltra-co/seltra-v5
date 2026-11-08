import { useSyncExternalStore } from 'react'

export type WorkbenchLayout = 'chat-wide' | 'split' | 'live'
export type WorkbenchPhase = 'idle' | 'submitted' | 'narrating' | 'asking' | 'planReady' | 'building' | 'ready' | 'error'
export type WorkbenchStep = { id: string; title: string; detail?: string; status: 'active' | 'done' }
export type WorkbenchState = {
  layout: WorkbenchLayout
  phase: WorkbenchPhase
  projectName: string
  intent: string
  currentStep: string
  steps: WorkbenchStep[]
  questionnaire: boolean
  tipDismissed: boolean
  previewUrl: string
  error: string
}

const initial: WorkbenchState = { layout: 'chat-wide', phase: 'idle', projectName: '', intent: '', currentStep: '', steps: [], questionnaire: false, tipDismissed: false, previewUrl: '', error: '' }
let state = initial
const listeners = new Set<() => void>()
let tokenFrame = 0
let queuedText: string | undefined

function publish(next: WorkbenchState) {
  state = next
  listeners.forEach((listener) => listener())
}

export function getWorkbenchState() { return state }
export function subscribeWorkbench(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function useWorkbenchState() { return useSyncExternalStore(subscribeWorkbench, getWorkbenchState, getWorkbenchState) }

export type WorkbenchEvent =
  | { type: 'send'; keepSplit?: boolean }
  | { type: 'intent'; name: string; sentence: string }
  | { type: 'status'; sentence: string }
  | { type: 'questionnaire' }
  | { type: 'answer' }
  | { type: 'plan-ready' }
  | { type: 'build-started' }
  | { type: 'step-started'; id: string; title: string }
  | { type: 'step-finished'; id: string; title: string; detail?: string }
  | { type: 'preview-ready'; url: string }
  | { type: 'failed'; friendlyMessage: string }
  | { type: 'finish' }
  | { type: 'dismiss-tip' }

export function transitionWorkbench(current: WorkbenchState, event: WorkbenchEvent): WorkbenchState {
  switch (event.type) {
    case 'send': return { ...initial, layout: event.keepSplit ? current.layout : 'chat-wide', projectName: event.keepSplit ? current.projectName : '', previewUrl: event.keepSplit ? current.previewUrl : '', phase: 'submitted' }
    case 'intent': return { ...current, phase: 'narrating', projectName: event.name.trim(), intent: event.sentence.trim() }
    case 'status': return { ...current, phase: current.phase === 'building' ? current.phase : 'narrating', currentStep: event.sentence }
    case 'questionnaire': return { ...current, layout: 'split', phase: 'asking', questionnaire: true, currentStep: '' }
    case 'answer': return { ...current, phase: 'narrating', questionnaire: false }
    case 'plan-ready': return { ...current, phase: 'planReady', questionnaire: false }
    case 'build-started': return { ...current, layout: 'split', phase: 'building', questionnaire: false }
    case 'step-started': return { ...current, layout: 'split', phase: 'building', currentStep: event.title, steps: [...current.steps.filter((step) => step.status !== 'active'), { id: event.id, title: event.title, status: 'active' }] }
    case 'step-finished': return { ...current, currentStep: '', steps: [...current.steps.filter((step) => step.id !== event.id), { id: event.id, title: event.title, detail: event.detail, status: 'done' }] }
    case 'preview-ready': return { ...current, layout: 'live', phase: 'ready', previewUrl: event.url, error: '' }
    case 'failed': return { ...current, phase: 'error', error: event.friendlyMessage }
    case 'finish': return { ...current, phase: current.layout === 'live' ? 'ready' : 'planReady', currentStep: '' }
    case 'dismiss-tip': return { ...current, tipDismissed: true }
  }
}

export function dispatchWorkbench(event: WorkbenchEvent) { publish(transitionWorkbench(state, event)) }
export function queueWorkbenchTokenText(content: string, flush: (text: string) => void) {
  queuedText = content
  if (tokenFrame) return
  tokenFrame = requestAnimationFrame(() => {
    tokenFrame = 0
    if (queuedText !== undefined) flush(queuedText)
    queuedText = undefined
  })
}

export type RecordedWorkbenchFrame = { atMs: number; event: WorkbenchEvent }
export async function replayWorkbench(frames: RecordedWorkbenchFrame[], emit: (event: WorkbenchEvent) => void | Promise<void>, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let elapsed = 0
  for (const frame of frames) {
    const delay = Math.max(0, frame.atMs - elapsed)
    if (delay) await wait(delay)
    elapsed = frame.atMs
    await emit(frame.event)
  }
}

// Synthetic sample is intentionally development-only and contains no account,
// project, prompt, token, or runtime payload from a real customer session.
export const DEV_STREAM_REPLAY: RecordedWorkbenchFrame[] = [
  { atMs: 0, event: { type: 'intent', name: 'Service Catalog', sentence: 'I’ll shape a clear services catalog with pricing and a simple path to contact the team.' } },
  { atMs: 480, event: { type: 'status', sentence: 'Reviewing the catalog layout' } },
  { atMs: 1_100, event: { type: 'questionnaire' } },
  { atMs: 2_200, event: { type: 'answer' } },
  { atMs: 2_400, event: { type: 'plan-ready' } },
  { atMs: 2_500, event: { type: 'build-started' } },
  { atMs: 3_000, event: { type: 'step-started', id: 'layout', title: 'Creating the service catalog' } },
  { atMs: 4_100, event: { type: 'step-finished', id: 'layout', title: 'Service catalog created', detail: 'Added tiered service cards, clear pricing, and contact links.' } },
  { atMs: 4_600, event: { type: 'preview-ready', url: 'about:blank#seltra-replay' } },
  { atMs: 5_500, event: { type: 'finish' } },
]

export function recordWorkbenchFrame(frames: RecordedWorkbenchFrame[], event: WorkbenchEvent, at = performance.now()) {
  if (process.env.NODE_ENV !== 'development') return frames
  return [...frames, { atMs: Math.round(at), event }]
}

let capturedFrames: RecordedWorkbenchFrame[] = []
let captureStartedAt = 0
export function beginWorkbenchCapture() {
  if (process.env.NODE_ENV !== 'development') return
  capturedFrames = [{ atMs: 0, event: { type: 'send' } }]
  captureStartedAt = performance.now()
  ;(window as Window & { __SELTRA_STREAM_REPLAY__?: RecordedWorkbenchFrame[] }).__SELTRA_STREAM_REPLAY__ = [...capturedFrames]
}
export function captureWorkbenchEvent(event: WorkbenchEvent) {
  if (process.env.NODE_ENV !== 'development') return
  const atMs = Math.max(0, Math.round(performance.now() - captureStartedAt))
  // Keep this a safe UI replay, never a raw WebSocket capture: preview URLs
  // can contain short-lived access credentials and are replaced by a mock URL.
  const safeEvent = event.type === 'preview-ready' ? { ...event, url: 'about:blank#seltra-replay' } : event
  capturedFrames = recordWorkbenchFrame(capturedFrames, safeEvent, atMs)
  ;(window as Window & { __SELTRA_STREAM_REPLAY__?: RecordedWorkbenchFrame[] }).__SELTRA_STREAM_REPLAY__ = [...capturedFrames]
  try { sessionStorage.setItem('seltra:dev:stream-replay', JSON.stringify(capturedFrames)) } catch { /* replay capture is best-effort */ }
}

export function getWorkbenchReplayFrames(): RecordedWorkbenchFrame[] | null {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return null
  try {
    const frames = JSON.parse(sessionStorage.getItem('seltra:dev:stream-replay') || 'null') as RecordedWorkbenchFrame[] | null
    if (!Array.isArray(frames) || !frames.length || frames.some((frame) => typeof frame.atMs !== 'number' || !frame.event || typeof frame.event.type !== 'string')) return null
    return frames.map((frame) => frame.event.type === 'preview-ready' ? { ...frame, event: { ...frame.event, url: 'about:blank#seltra-replay' } } : frame)
  } catch { return null }
}

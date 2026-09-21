//store/build-events.service.ts
import { Injectable, NotFoundException } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { Observable } from 'rxjs'

export type BuildEvent =
  | { type: 'step'; step: string; status: 'started' | 'completed' | 'failed'; label?: string }
  | { type: 'log'; message: string }
  | { type: 'plan'; items: Array<{ label: string; detail: string }> }
  | { type: 'file'; name: string; status: 'started' | 'completed' | 'failed' }
  | { type: 'chunk'; file: string; content: string }
  | { type: 'image'; role: 'hero' | 'product' | 'story'; url: string; label?: string }
  | { type: 'preview'; url: string; store?: unknown }
  | { type: 'heartbeat' }
  | { type: 'done'; store?: unknown }
  | { type: 'error'; message: string }

export interface BuildContext {
  buildId: string
  emit: (event: BuildEvent) => void
}

type Subscriber = (event: BuildEvent) => void

interface BuildSession {
  id: string
  status: 'running' | 'done' | 'error'
  currentStep?: string
  startedAt: string
  events: BuildEvent[]
  subscribers: Set<Subscriber>
}

@Injectable()
export class BuildEventsService {
  private readonly sessions = new Map<string, BuildSession>()

  createSession(): BuildContext {
    const buildId = `build_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.sessions.set(buildId, {
      id: buildId,
      status: 'running',
      startedAt: new Date().toISOString(),
      events: [],
      subscribers: new Set(),
    })
    return {
      buildId,
      emit: (event) => this.emit(buildId, event),
    }
  }

  emit(buildId: string, event: BuildEvent) {
    const session = this.sessions.get(buildId)
    if (!session) return

    if (event.type === 'step') {
      if (event.status === 'started') session.currentStep = event.step
      if (event.status !== 'started' && session.currentStep === event.step) {
        session.currentStep = undefined
      }
    }

    if (event.type === 'error') {
      session.status = 'error'
      if (session.currentStep) {
        const failedStep: BuildEvent = { type: 'step', step: session.currentStep, status: 'failed' }
        session.events.push(failedStep)
        for (const subscriber of session.subscribers) subscriber(failedStep)
        session.currentStep = undefined
      }
    }

    if (event.type === 'done') session.status = 'done'
    session.events.push(event)
    session.events = session.events.slice(-300)
    for (const subscriber of session.subscribers) subscriber(event)
  }

  stream(buildId: string): Observable<MessageEvent> {
    const session = this.sessions.get(buildId)
    if (!session) throw new NotFoundException(`Build session "${buildId}" not found`)

    return new Observable<MessageEvent>((observer) => {
      const send = (event: BuildEvent) => {
        // 'error' is a reserved/special SSE event name for EventSource — a server-sent
        // frame literally named `event: error` can race with or get swallowed by the
        // browser's own connection-error handling (source.onerror), which is why real
        // error messages were showing up as a generic "stream disconnected" instead.
        // The JSON payload still says type: 'error' (client logic is unaffected) — only
        // the wire-level SSE event name changes.
        const wireType = event.type === 'error' ? 'build-error' : event.type
        observer.next({ type: wireType, data: event })
        if (event.type === 'done' || event.type === 'error') observer.complete()
      }

      for (const event of session.events) send(event)
      if (session.status !== 'running') {
        observer.complete()
        return undefined
      }

      session.subscribers.add(send)

      const heartbeat = setInterval(() => {
        if (session.status === 'running') {
          observer.next({ type: 'heartbeat', data: { type: 'heartbeat' } })
        }
      }, 8000)

      return () => {
        clearInterval(heartbeat)
        session.subscribers.delete(send)
      }
    })
  }
}
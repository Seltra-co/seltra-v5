export type BuildPhase = 'understand' | 'analyze' | 'plan' | 'build' | 'inspect' | 'improve' | 'polish' | 'verify'

export const PHASE_LABELS: Record<BuildPhase, { headline: string; detail: string }> = {
  understand: { headline: 'Thinking', detail: 'Understanding merchant intent' },
  analyze: { headline: 'Analyzing', detail: 'Business type · Products · Target customer · Required functionality · Brand identity' },
  plan: { headline: 'Planning', detail: 'Application architecture · Component selection · Data models · Integrations' },
  build: { headline: 'Composing', detail: 'Generating application · Creating components · Connecting data' },
  inspect: { headline: 'Rendering', detail: 'Running application · Checking visual output' },
  improve: { headline: 'Refactoring', detail: 'Fixing structural issues' },
  polish: { headline: 'Refining', detail: 'Typography · Spacing · Responsive behaviour · UX' },
  verify: { headline: 'Testing', detail: 'Routes · Interactions · Components · Cart · Checkout · Forms' },
}

export type RunState = 'queued' | 'running' | 'waiting_for_user' | 'stopping' | 'stopped' | 'interrupted' | 'failed' | 'paused_no_credits' | 'completed'

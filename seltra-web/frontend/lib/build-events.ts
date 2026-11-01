export const BUILD_PHASES = {
  understand: { headline: 'Thinking', detail: 'Understanding merchant intent' },
  analyze: { headline: 'Analyzing', detail: 'Business type · Products · Target customer · Required functionality · Brand identity' },
  plan: { headline: 'Planning', detail: 'Application architecture · Component selection · Data models · Integrations' },
  build: { headline: 'Composing', detail: 'Generating application · Creating components · Connecting data' },
  inspect: { headline: 'Rendering', detail: 'Running application · Checking visual output' },
  improve: { headline: 'Refactoring', detail: 'Fixing structural issues' },
  polish: { headline: 'Refining', detail: 'Typography · Spacing · Responsive behaviour · UX' },
  verify: { headline: 'Testing', detail: 'Routes · Interactions · Components · Cart · Checkout · Forms' },
} as const

export const VERIFY_CHECKS = [
  { id: 'routes', label: 'No broken routes' },
  { id: 'images', label: 'Images load' },
  { id: 'catalog', label: 'Live Seltra catalog wired' },
  { id: 'social-proof', label: 'No fabricated reviews, ratings, or testimonials' },
] as const

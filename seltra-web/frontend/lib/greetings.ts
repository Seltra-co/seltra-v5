export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night' | 'generic'

export type GreetingInput = {
  firstName?: string | null
  hasProjects: boolean
  hour: number | null
  seed: string
}

export const greetingCopy: Record<'newUser' | 'returningUser', Record<GreetingPeriod, string | readonly string[]>> = {
  newUser: {
    morning: "Good morning, {name}. Let's build something.",
    afternoon: 'Good afternoon, {name}. Ready to build?',
    evening: "Good evening, {name}. Let's start your store.",
    night: "Hello, night owl. Let's build your first store.",
    generic: "Welcome, {name}. What's the vision?",
  },
  returningUser: {
    morning: 'Good morning, {name}.',
    afternoon: 'Good afternoon, {name}.',
    evening: 'Good evening, {name}.',
    night: 'Hello, night owl.',
    generic: [
      'Ready when you are, {name}.',
      'Welcome back, {name}.',
      'Pick up where you left off.',
      'What are we building today, {name}?',
    ],
  },
}

function getPeriod(hour: number | null): GreetingPeriod {
  if (hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) return 'generic'
  if (hour < 5 || hour >= 21) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'generic'
}

function selectVariant(seed: string, variants: readonly string[]): string {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return variants[(hash >>> 0) % variants.length]
}

export function getGreeting({ firstName, hasProjects, hour, seed }: GreetingInput): string {
  const name = firstName?.trim().split(/\s+/)[0] ?? ''
  const audience = hasProjects ? 'returningUser' : 'newUser'
  const period = getPeriod(hour)
  const copy = greetingCopy[audience][period]
  const template = typeof copy === 'string' ? copy : selectVariant(seed, copy)
  return template.replace(', {name}', name ? `, ${name}` : '').replace('{name}', name)
}

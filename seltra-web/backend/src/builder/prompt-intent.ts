export type PromptIntent = { name: string; intent: string }

const ignoredTitleWords = new Set(['build', 'create', 'make', 'design', 'develop', 'simple', 'a', 'an', 'the', 'for', 'with', 'of', 'my', 'me', 'please', 'website', 'web'])

function clean(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxLength) : ''
}

export function deterministicPromptIntent(prompt: string): PromptIntent {
  const text = clean(prompt, 4_000)
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? []
  const titleWords = words.filter((word) => !ignoredTitleWords.has(word.toLowerCase())).slice(0, 3)
  const title = titleWords.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ')
  return {
    name: title ? `${title} Project`.slice(0, 48) : 'New Project',
    intent: '',
  }
}

export async function resolvePromptIntent(input: { prompt: string; baseUrl: string; model: string; apiKey?: string; timeoutMs?: number }): Promise<PromptIntent> {
  const fallback = deterministicPromptIntent(input.prompt)
  if (!input.baseUrl || !input.model || !input.apiKey) return fallback
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        max_tokens: 96,
        messages: [
          { role: 'system', content: 'Return only JSON with "name" (short project title, <=48 chars) and "intent" (one plain-language sentence, <=180 chars). Do not add markdown.' },
          { role: 'user', content: clean(input.prompt, 4_000) },
        ],
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 1_200),
    })
    if (!response.ok) return fallback
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') return fallback
    const result = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>
    const name = clean(result.name, 48)
    const intent = clean(result.intent, 180)
    return name && intent ? { name, intent } : fallback
  } catch {
    return fallback
  }
}

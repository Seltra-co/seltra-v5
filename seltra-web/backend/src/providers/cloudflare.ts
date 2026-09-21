//providers/cloudflare.ts

export const CF_API_BASE = 'https://api.cloudflare.com/client/v4/accounts'

// ── Fetch with timeout ────────────────────────────────────────────────────────
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    console.warn(`[CF] fetch aborted/failed after ${elapsedMs}ms: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

interface ModelState {
  cooldownUntil: number
  requestsThisMinute: number
  windowStart: number
  consecutiveErrors: number
}

const modelState = new Map<string, ModelState>()

export function getModelState(model: string): ModelState {
  if (!modelState.has(model)) {
    modelState.set(model, {
      cooldownUntil: 0,
      requestsThisMinute: 0,
      windowStart: Date.now(),
      consecutiveErrors: 0,
    })
  }
  return modelState.get(model)!
}

export function recordSuccess(model: string) {
  const s = getModelState(model)
  s.consecutiveErrors = 0
  const now = Date.now()
  if (now - s.windowStart >= 60_000) {
    s.requestsThisMinute = 1
    s.windowStart = now
  } else {
    s.requestsThisMinute++
  }
}

export function recordError(model: string, cooldownMs = 30_000) {
  const s = getModelState(model)
  s.consecutiveErrors++
  const backoff = Math.min(
    cooldownMs * Math.pow(2, Math.max(0, s.consecutiveErrors - 1)),
    300_000,
  )
  s.cooldownUntil = Date.now() + backoff
  console.warn(
    `[CF] ${model.split('/').pop()} cooled down ${Math.round(backoff / 1000)}s (error #${s.consecutiveErrors})`,
  )
}

export function isModelAvailable(model: string): boolean {
  return Date.now() > getModelState(model).cooldownUntil
}

// ── Verified against developers.cloudflare.com/workers-ai/models/ ─────────────
// NOTE: this account has no AI Gateway configured — every call below goes
// straight at api.cloudflare.com/.../ai/run/{model} with just account id +
// token. Do NOT reintroduce gateway URLs (ai/v1/chat/completions) or a
// cf-aig-gateway-id header here unless a real gateway id is provisioned —
// that combination 400s with "Please configure AI Gateway" on this account.
export const CF_MODELS = {
  CODEGEN_PRIMARY:       '@cf/qwen/qwen2.5-coder-32b-instruct',
  CODEGEN_QWEN3:         '@cf/qwen/qwen3-30b-a3b-fp8',
  CODEGEN_NEMOTRON:      '@cf/nvidia/nemotron-3-120b-a12b',
  CODEGEN_REASONING:     '@cf/openai/gpt-oss-120b',
  CODEGEN_SECONDARY:     '@cf/openai/gpt-oss-20b',
  CHAT_LIGHT:             '@cf/meta/llama-3.2-3b-instruct',
  CHAT_FAST:             '@cf/openai/gpt-oss-20b',
  CHAT_REASONING:        '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  PLANNER_FAST:          '@cf/qwen/qwq-32b',
  PLANNER_FALLBACK:      '@cf/zai-org/glm-4.7-flash',
  DESIGN_PRIMARY:        '@cf/nvidia/nemotron-3-120b-a12b',
  DESIGN_REASONING:      '@cf/openai/gpt-oss-120b',
  DESIGN_FALLBACK:       '@cf/qwen/qwq-32b',
  NAV_DESIGN_FAST:       '@cf/qwen/qwq-32b',
  NAV_DESIGN_FALLBACK:   '@cf/zai-org/glm-4.7-flash',
} as const

export type CFModel = typeof CF_MODELS[keyof typeof CF_MODELS]

export interface CFMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CFResponse {
  content: string
  provider: 'cloudflare'
  model: string
  tokensUsed?: number
}

function extractResponsesApiText(output: Array<Record<string, unknown>>): string | null {
  for (const item of output) {
    const content = item.content
    if (Array.isArray(content)) {
      for (const c of content as Array<Record<string, unknown>>) {
        if (typeof c.text === 'string' && c.text.length > 0) return c.text
      }
    }
  }
  return null
}

function extractContent(data: unknown, model: string): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>

  if (d.result && typeof d.result === 'object') {
    const r = d.result as Record<string, unknown>
    if (typeof r.response === 'string' && r.response.length > 0) return r.response
    if (Array.isArray(r.choices) && r.choices.length > 0) {
      const choice = r.choices[0] as Record<string, unknown>
      const msg = choice.message as Record<string, unknown> | undefined
      if (typeof msg?.content === 'string') return msg.content
      if (typeof msg?.reasoning === 'string') return msg.reasoning
      if (typeof choice.text === 'string') return choice.text
    }
    if (typeof r.output_text === 'string') return r.output_text
    if (Array.isArray(r.output)) {
      const text = extractResponsesApiText(r.output as Array<Record<string, unknown>>)
      if (text) return text
    }
  }

  if (Array.isArray(d.choices) && d.choices.length > 0) {
    const choice = d.choices[0] as Record<string, unknown>
    const msg = choice.message as Record<string, unknown> | undefined
    if (typeof msg?.content === 'string') return msg.content
    if (typeof msg?.reasoning === 'string') return msg.reasoning
    if (typeof choice.text === 'string') return choice.text
  }

  if (typeof d.output_text === 'string') return d.output_text
  if (Array.isArray(d.output)) {
    const text = extractResponsesApiText(d.output as Array<Record<string, unknown>>)
    if (text) return text
  }

  if (typeof d.response === 'string') return d.response

  console.error(
    `[CF] Cannot extract content from ${model} response:`,
    JSON.stringify(d).slice(0, 300),
  )
  return ''
}

function extractTokens(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') return undefined
  const d = data as Record<string, unknown>
  const result = d.result as Record<string, unknown> | undefined
  const usage = (result?.usage ?? d.usage) as Record<string, unknown> | undefined
  if (!usage) return undefined
  return (usage.total_tokens ?? usage.completion_tokens ?? undefined) as number | undefined
}

// Per-model timeout in ms — larger models need more time. Entries for the
// planner/design models too so they don't fall back to the generic 60s
// default, which was too long for the small fast ones (gemma, glm-flash)
// and too short for nemotron-120b.
const MODEL_TIMEOUT_MS: Record<string, number> = {
  '@cf/qwen/qwen2.5-coder-32b-instruct':          75_000,
  '@cf/qwen/qwen3-30b-a3b-fp8':                   75_000,
  '@cf/openai/gpt-oss-120b':                      90_000,
  '@cf/openai/gpt-oss-20b':                       45_000,
  '@cf/meta/llama-3.2-3b-instruct':               20_000,
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': 60_000,
  '@cf/qwen/qwq-32b':                             45_000,
  '@cf/zai-org/glm-4.7-flash':                    20_000,
  '@cf/nvidia/nemotron-3-120b-a12b':              70_000,
}

export async function callCloudflare(
  messages: CFMessage[],
  options: {
    model?: CFModel | string
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
  } = {},
): Promise<CFResponse> {
  const accountId = process.env.CF_ACCOUNT_ID
  const apiToken  = process.env.CF_AI_API_TOKEN

  if (!accountId || !apiToken) {
    throw new Error('[CF] CF_ACCOUNT_ID or CF_AI_API_TOKEN not configured')
  }

  const model = options.model ?? CF_MODELS.CHAT_FAST

  if (!isModelAvailable(model)) {
    const s = getModelState(model)
    const waitSec = Math.ceil((s.cooldownUntil - Date.now()) / 1000)
    throw new Error(`[CF] ${model.split('/').pop()} in cooldown for ${waitSec}s`)
  }

  // Direct per-model endpoint — model id goes in the PATH with real slashes,
  // never encodeURIComponent'd. No gateway header. This is the only shape
  // that works with just CF_ACCOUNT_ID + CF_AI_API_TOKEN and no configured
  // AI Gateway.
  const url = `${CF_API_BASE}/${accountId}/ai/run/${model}`
  const timeoutMs = options.timeoutMs ?? MODEL_TIMEOUT_MS[model] ?? 60_000

  let res: Response
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          messages,
          max_tokens: options.maxTokens ?? 2048,
          temperature: options.temperature ?? 0.4,
          ...(model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
          stream: false,
        }),
      },
      timeoutMs,
    )
  } catch (e) {
    const msg = (e as Error).message ?? String(e)
    if (msg.includes('abort') || msg.includes('Abort') || (e as Error).name === 'AbortError') {
      recordError(model, 30_000)
      throw new Error(`[CF] ${model.split('/').pop()} timed out after ${timeoutMs / 1000}s`)
    }
    recordError(model, 15_000)
    throw new Error(`[CF] fetch failed: ${msg.slice(0, 120)}`)
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)

    if (res.status === 429) {
      recordError(model, 60_000)
      throw new Error(`[CF] 429 rate limited: ${errText.slice(0, 150)}`)
    }
    if (res.status === 408 || res.status === 503 || res.status === 502 || res.status === 504) {
      recordError(model, 15_000)
      throw new Error(`[CF] ${res.status} model temporarily unavailable`)
    }
    if (res.status === 400) {
      console.error(`[CF] 400 bad request for ${model}:`, errText.slice(0, 300))
      recordError(model, 180_000)
      throw new Error(`[CF] 400 bad request`)
    }
    if (res.status === 401 || res.status === 403) {
      recordError(model, 300_000)
      throw new Error(`[CF] Auth error ${res.status} -- check CF_AI_API_TOKEN`)
    }

    recordError(model, 30_000)
    throw new Error(`[CF] ${res.status}: ${errText.slice(0, 150)}`)
  }

  const data = await res.json()
  const content = extractContent(data, model)

  if (!content) {
    recordError(model, 10_000)
    throw new Error(`[CF] Empty response from ${model.split('/').pop()}`)
  }

  recordSuccess(model)

  return {
    content,
    provider: 'cloudflare',
    model,
    tokensUsed: extractTokens(data),
  }
}

export async function cfChat(
  messages: CFMessage[],
  maxTokens = 600,
  temperature = 0.3,
): Promise<CFResponse> {
  const chainStartedAt = Date.now()
  const chainBudgetMs = 60_000
  const candidates = [
    CF_MODELS.CHAT_LIGHT,
    CF_MODELS.CHAT_FAST,
    CF_MODELS.CODEGEN_SECONDARY,
    CF_MODELS.PLANNER_FALLBACK,
    CF_MODELS.CHAT_REASONING,
  ]

  for (const model of candidates) {
    const remainingMs = chainBudgetMs - (Date.now() - chainStartedAt)
    if (remainingMs <= 0) {
      console.warn(`[CF] cfChat chain budget (${chainBudgetMs}ms) exceeded, aborting remaining candidates`)
      break
    }
    if (!isModelAvailable(model)) continue
    try {
      return await callCloudflare(messages, { model, maxTokens, temperature, timeoutMs: remainingMs })
    } catch (e) {
      console.warn(
        `[CF] cfChat failed on ${model.split('/').pop()}:`,
        (e as Error).message?.slice(0, 80),
      )
    }
  }

  throw new Error('[CF] All chat models unavailable or in cooldown')
}

export interface CFCodegenOptions {
  model?: CFModel | string
  skipFirstCandidate?: boolean
  role?: 'hero' | 'extras' | 'generic'
  temperature?: number
}

const ROLE_CANDIDATES: Record<NonNullable<CFCodegenOptions['role']>, string[]> = {
  hero: [
    CF_MODELS.CODEGEN_QWEN3,
    CF_MODELS.CODEGEN_NEMOTRON,
    CF_MODELS.CODEGEN_SECONDARY,
    CF_MODELS.CODEGEN_REASONING,
    CF_MODELS.CODEGEN_PRIMARY,
    CF_MODELS.CHAT_FAST,
  ],
  extras: [
    CF_MODELS.CODEGEN_REASONING,
    CF_MODELS.CODEGEN_PRIMARY,
    CF_MODELS.CODEGEN_SECONDARY,
    CF_MODELS.CHAT_FAST,
  ],
  generic: [
    CF_MODELS.CODEGEN_PRIMARY,
    CF_MODELS.CODEGEN_REASONING,
    CF_MODELS.CODEGEN_SECONDARY,
    CF_MODELS.CHAT_FAST,
  ],
}

export function getRoleCandidates(role: NonNullable<CFCodegenOptions['role']>): string[] {
  const base = ROLE_CANDIDATES[role]
  return base
}

export async function cfCodegen(
  messages: CFMessage[],
  maxTokens = 6144,
  options: CFCodegenOptions = {},
): Promise<CFResponse> {
  const chainStartedAt = Date.now()
  const chainBudgetMs = 60_000
  let candidates = options.model
    ? [options.model]
    : getRoleCandidates(options.role ?? 'generic')

  if (!options.model && options.skipFirstCandidate) {
    candidates = candidates.slice(1)
  }

  for (const model of candidates) {
    const remainingMs = chainBudgetMs - (Date.now() - chainStartedAt)
    if (remainingMs <= 0) {
      console.warn(`[CF] cfCodegen chain budget (${chainBudgetMs}ms) exceeded, aborting remaining candidates`)
      break
    }
    if (!isModelAvailable(model)) {
      console.warn(`[CF] ${model.split('/').pop()} in cooldown, trying next`)
      continue
    }
    try {
      const result = await callCloudflare(messages, {
        model,
        maxTokens,
        temperature: options.temperature ?? 0.55,
        timeoutMs: remainingMs,
      })
      const shortModel = model.split('/').pop() ?? model
      console.log(
        `[CF] Codegen via ${shortModel} (${options.model ? 'override' : options.role ?? 'generic'}) -- ${result.content.length} chars, ~${result.tokensUsed ?? '?'} tokens`,
      )
      return result
    } catch (e) {
      console.warn(
        `[CF] cfCodegen failed on ${model.split('/').pop()}:`,
        (e as Error).message?.slice(0, 80),
      )
    }
  }

  throw new Error('[CF] All CF codegen models unavailable')
}

export function isCFAvailable(): boolean {
  return Boolean(process.env.CF_ACCOUNT_ID && process.env.CF_AI_API_TOKEN)
}

export function getCFModelStatus(): Record<string, { available: boolean; cooldownEndsIn?: number; consecutiveErrors?: number }> {
  const status: Record<string, { available: boolean; cooldownEndsIn?: number; consecutiveErrors?: number }> = {}
  const now = Date.now()

  for (const [name, model] of Object.entries(CF_MODELS)) {
    const s = getModelState(model)
    const available = now > s.cooldownUntil

    status[name] = available
      ? { available: true }
      : {
          available: false,
          cooldownEndsIn: Math.ceil((s.cooldownUntil - now) / 1000),
          consecutiveErrors: s.consecutiveErrors,
        }
  }

  return status
}

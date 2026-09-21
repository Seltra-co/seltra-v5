//seltra-web/backend/src/ai/client.ts

import {
  cfChat,
  cfCodegen,
  isCFAvailable,
  type CFMessage,
  type CFCodegenOptions,
} from '../providers/cloudflare'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AIResponse {
  content: string
  provider: 'cloudflare'
}

export interface ChatOptions {
  maxTokens?: number
  preferLocal?: boolean
  temperature?: number
}

function toCFMessages(messages: ChatMessage[]): CFMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

// ── Standard chat: blueprint, products, agent messages ────────────────────
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<AIResponse> {
  if (!isCFAvailable()) {
    throw new Error('[AI] chat: Cloudflare not configured (CF_ACCOUNT_ID/CF_AI_API_TOKEN missing)')
  }

  const result = await cfChat(toCFMessages(messages), options.maxTokens ?? 600, options.temperature ?? 0.3)
  return { content: result.content, provider: 'cloudflare' }
}

export async function codegenChat(
  messages: ChatMessage[],
  maxTokens = 1800,
  role: 'storefront' | 'hero' | 'nav' | 'generic' = 'storefront',
  temperature?: number,
): Promise<AIResponse> {
  const resolvedTemperature = temperature ?? (role === 'hero' ? 0.18 : role === 'nav' ? 0.1 : 0.2)

  if (!isCFAvailable()) {
    throw new Error('[AI] codegenChat: Cloudflare not configured (CF_ACCOUNT_ID/CF_AI_API_TOKEN missing)')
  }

  const cfRole: NonNullable<CFCodegenOptions['role']> =
    role === 'hero' ? 'hero' : role === 'nav' ? 'extras' : 'generic'
  const result = await cfCodegen(toCFMessages(messages), maxTokens, { role: cfRole, temperature: resolvedTemperature })
  return { content: result.content, provider: 'cloudflare' }
}
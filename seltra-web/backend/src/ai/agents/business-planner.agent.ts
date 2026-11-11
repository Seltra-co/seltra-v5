//ai/agents/business-planner.agent.ts
import { callCloudflare, CF_MODELS, isModelAvailable } from '../../providers/cloudflare'
import { chat } from '../client'

export interface PlannerQuestion {
  id: string
  question: string
  why: string // one-line rationale, shown to merchant so it doesn't feel like a form
  options?: string[] // optional quick-pick suggestions, merchant can still free-type
}

export interface PlannerResult {
  readyToBuild: boolean
  questions: PlannerQuestion[]
  inferredSummary: string // what the planner already understood, so merchant can correct it
}

const SYSTEM_PROMPT = `You are Seltra's Business Planner Agent. Creator: Seltra Inc. A merchant just typed a short prompt
describing the business they want to launch. Your job is NOT to build the store or app — that happens after
you. Your job is to read the prompt like a sharp co-founder would, and ask ONLY the questions that
would meaningfully change how the store gets built.

Rules:
- Always ask at least one question. Ask 1 to 4 questions and set readyToBuild: false.
- Never ask generic boilerplate ("what's your business about?", "who's your audience?") if the prompt
  already answers it. Only ask what's genuinely missing or ambiguous given THIS prompt.
- Prioritize questions whose answer changes a structural decision: fulfillment (pickup vs delivery vs
  both), price positioning (budget/mid/premium), and whether they have real product photos or need
  AI-generated ones.
- Ask store-specific setup questions in real time when the answer would change generated features:
  product variants (sizes, colors, scents, pack sizes), delivery tiers, delivery speed, delivery pricing,
  pickup availability, preorder/stock rules, or launch offers. These questions must be tailored to the
  merchant's business, not generic boilerplate.
- Do not ask the merchant to manually enumerate a full variant table or delivery matrix. Ask for the
  signal that matters (for example whether they have sizes/colors, or whether they want standard/express
  delivery and rough pricing). If the merchant answers briefly ("yes", "we do", "not sure"), downstream
  generation should infer sensible launch-ready defaults.
- Never ask for WhatsApp, phone, or merchant contact details during this planner step.
- Every question needs a one-line "why" so it doesn't feel like an interrogation.
- Where sensible, provide 2-4 short "options" as quick picks, but the merchant can always type free text.
- Write inferredSummary as 1-3 sentences describing what you already understood from their prompt, so
  they can correct you instead of repeating themselves.
- Return ONLY valid JSON, no markdown, matching exactly:
{
  "readyToBuild": boolean,
  "questions": [{ "id": string, "question": string, "why": string, "options"?: string[] }],
  "inferredSummary": string
}`

function cleanJSON(raw: string): string {
  let s = raw.trim()
  if (s.startsWith('```json')) s = s.slice(7)
  else if (s.startsWith('```')) s = s.slice(3)
  if (s.endsWith('```')) s = s.slice(0, -3)
  return s.trim()
}

function fallbackPlan(prompt: string): PlannerResult {
  const lower = prompt.toLowerCase()
  const product = /coffee|tea|drink|beverage/.test(lower) ? 'drinks'
    : /clothing|fashion|shirt|dress|apparel/.test(lower) ? 'clothing'
      : /skin|beauty|cosmetic|soap/.test(lower) ? 'beauty products'
        : /food|bakery|cake|restaurant/.test(lower) ? 'food'
          : /jewel|accessor/.test(lower) ? 'accessories'
            : 'products'
  return {
    readyToBuild: false,
    inferredSummary: `Building a first version based on: "${prompt.slice(0, 140)}"`,
    questions: [{
      id: 'launch_focus',
      question: `Who are the main customers for your ${product}, and what design style should the store use?`,
      why: 'This helps shape the storefront and product presentation around the right audience.',
      options: ['Everyday shoppers', 'Premium buyers', 'Gift shoppers'],
    }],
  }
}

export async function planFromPrompt(prompt: string): Promise<PlannerResult> {
  let result
  try {
    if (isModelAvailable(CF_MODELS.PLANNER_FAST)) {
      result = await callCloudflare(
        [{ role: 'user', content: `${SYSTEM_PROMPT}\n\nMerchant prompt:\n${prompt}` }],
        { model: CF_MODELS.PLANNER_FAST, maxTokens: 500, temperature: 0.3 },
      )
    } else {
      result = await callCloudflare(
        [{ role: 'user', content: `${SYSTEM_PROMPT}\n\nMerchant prompt:\n${prompt}` }],
        { model: CF_MODELS.PLANNER_FALLBACK, maxTokens: 500, temperature: 0.3 },
      )
    }
  } catch {
    try {
      result = await chat([{ role: 'user', content: `${SYSTEM_PROMPT}\n\nMerchant prompt:\n${prompt}` }], { maxTokens: 500 })
    } catch {
      return fallbackPlan(prompt)
    }
  }

  try {
    const parsed = JSON.parse(cleanJSON(result.content)) as PlannerResult
    if (!Array.isArray(parsed.questions)) throw new Error('bad shape')
    const questions = parsed.questions
      .filter((q): q is PlannerQuestion => Boolean(q && typeof q === 'object' && typeof q.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(q.id) && typeof q.question === 'string' && q.question.trim() && typeof q.why === 'string'))
      .filter((q) => q.id !== 'contact_number')
      .filter((q) => !/whats\s?app|phone|contact number|customer.*reach/i.test(q.question))
      .map((q) => ({ ...q, question: q.question.trim().slice(0, 240), why: q.why.trim().slice(0, 180), options: Array.isArray(q.options) ? q.options.filter((option): option is string => typeof option === 'string' && Boolean(option.trim())).slice(0, 4).map((option) => option.trim().slice(0, 120)) : undefined }))
      .slice(0, 4)
    if (!questions.length || parsed.readyToBuild) return fallbackPlan(prompt)
    return {
      readyToBuild: false,
      questions,
      inferredSummary: parsed.inferredSummary || fallbackPlan(prompt).inferredSummary,
    }
  } catch {
    return fallbackPlan(prompt)
  }
}

// Merges the merchant's answers back into a single enriched prompt string
// that gets passed into generateBlueprint() unchanged — no new plumbing
// needed downstream, the planner just makes the input prompt richer.
export function mergeAnswersIntoPrompt(originalPrompt: string, answers: Record<string, string>): string {
  const lines = Object.entries(answers)
    .filter(([, v]) => v && v.trim())
    .map(([, v]) => v.trim())
  if (lines.length === 0) return originalPrompt
  return `${originalPrompt}\n\nAdditional details from merchant:\n${lines.join('\n')}`
}

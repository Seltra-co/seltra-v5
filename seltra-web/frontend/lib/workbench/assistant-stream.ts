const INTERNAL_STREAM_CHATTER = /\b(?:playwright|node_modules|no terminal|tool (?:errors?|failures?|failed)|tool call failed)\b/i
const MODEL_PREVIEW_CLAIM = /\bpreview\s+ready\b/i
const INTERNAL_CORE_CONTROL_MESSAGE = /^(?:a model-backed planning turn has already completed without runtime tools|continue from the completed plan in this conversation|the app blueprint has been approved\. please build the app based on the following approved blueprint)\b/i
const INTERNAL_CORE_CONTEXT_SUFFIX = /\s*Building a first version based on:[\s\S]*$/i
const PROMPT_CONTRACT = /for every new build request|first visible assistant output|streamed build narration|do not call update_todos|do not .*before the user approves|first call write_app_blueprint|do not create todos, edit files|before approval|prompt[- ]contract|system prompt/i

/** Keep implementation traces out of customer-facing assistant text. Core phase events own preview status. */
export function projectAssistantStreamText(content: string): string {
  if (INTERNAL_CORE_CONTROL_MESSAGE.test(content.trim())) return ''
  return content
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_STREAM_CHATTER.test(line) && !MODEL_PREVIEW_CLAIM.test(line) && !PROMPT_CONTRACT.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function projectCoreConversationMessage(role: 'user' | 'assistant', content: string): string {
  const trimmed = content.trim()
  if (INTERNAL_CORE_CONTROL_MESSAGE.test(trimmed)) return ''

  const visibleContent = trimmed.replace(INTERNAL_CORE_CONTEXT_SUFFIX, '').trim()
  return role === 'assistant' ? projectAssistantStreamText(visibleContent) : visibleContent
}

export function projectAssistantOpeningText(content: string): string {
  const firstLine = projectAssistantStreamText(content).split(/\r?\n/, 1)[0]?.split(/<(?:(?:dyad|seltra)-|think\b)/i, 1)[0]?.trim() ?? ''
  if (!firstLine || firstLine.length > 240 || /[{}\[\]<>]/.test(firstLine) || PROMPT_CONTRACT.test(firstLine)) return ''
  return firstLine.match(/^(.{1,240}?[.!?])(?:\s|$)/)?.[1]?.trim() ?? ''
}

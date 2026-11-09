const INTERNAL_STREAM_CHATTER = /\b(?:playwright|node_modules|no terminal|tool (?:errors?|failures?|failed)|tool call failed)\b/i
const MODEL_PREVIEW_CLAIM = /\bpreview\s+ready\b/i

/** Keep implementation traces out of customer-facing assistant text. Core phase events own preview status. */
export function projectAssistantStreamText(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_STREAM_CHATTER.test(line) && !MODEL_PREVIEW_CLAIM.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

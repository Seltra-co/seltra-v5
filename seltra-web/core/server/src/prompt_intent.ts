export type PromptIntent = { name: string; intent: string };

function cleanLine(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max)
    : "";
}

export function deterministicPromptIntent(prompt: string): PromptIntent {
  const normalized = cleanLine(prompt, 4000);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const subject = words.slice(0, 5).join(" ") || "your idea";
  const name = `${subject.slice(0, 1).toUpperCase()}${subject.slice(1)}`.slice(0, 48);
  return { name, intent: "" };
}

export async function resolvePromptIntent(input: {
  prompt: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PromptIntent> {
  const fallback = deterministicPromptIntent(input.prompt);
  if (!input.apiKey?.trim() || !input.model.trim() || !input.baseUrl.trim()) return fallback;
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        max_tokens: 96,
        messages: [
          { role: "system", content: 'Return only JSON with "name" (short project title, <=48 chars) and "intent" (one plain-language sentence describing the requested project, <=180 chars). Do not add markdown.' },
          { role: "user", content: cleanLine(input.prompt, 4000) },
        ],
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 1_500),
    });
    if (!response.ok) return fallback;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return fallback;
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
    const name = cleanLine(parsed.name, 48);
    const intent = cleanLine(parsed.intent, 180);
    return name && intent ? { name, intent } : fallback;
  } catch {
    return fallback;
  }
}

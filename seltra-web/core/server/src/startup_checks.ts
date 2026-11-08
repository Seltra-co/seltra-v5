import { lookup as dnsLookup } from "node:dns/promises";

type Lookup = typeof dnsLookup;

export function classifyModelStartupFailure(error: unknown): string {
  let current = error as { code?: unknown; name?: unknown; status?: unknown; cause?: unknown } | undefined;
  let status: number | undefined;
  const codes: string[] = [];
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current.status === "number") status = current.status;
    if (typeof current.code === "string") codes.push(current.code.toUpperCase());
    if (typeof current.name === "string") codes.push(current.name.toUpperCase());
    current = current.cause as typeof current;
  }
  if (codes.some((code) => ["ENOTFOUND", "EAI_AGAIN", "ENODATA", "EAI_FAIL"].includes(code))) return "MODEL_DNS_FAILURE";
  if (codes.some((code) => ["TIMEOUTERROR", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code))) return "MODEL_TIMEOUT";
  if (status === 401) return "MODEL_PROVIDER_401";
  if (status === 403) return "MODEL_PROVIDER_403";
  if (status !== undefined && status >= 500) return "MODEL_PROVIDER_5XX";
  return "MODEL_PROVIDER_CHECK_FAILED";
}

export async function assertCorePublicUrlResolvable(
  publicUrl: string | undefined,
  lookup: Lookup = dnsLookup,
): Promise<void> {
  if (!publicUrl) {
    throw new Error("CORE_PUBLIC_URL is required for sandbox callbacks.");
  }
  let hostname: string;
  try {
    const parsed = new URL(publicUrl);
    if (parsed.protocol !== "https:") throw new Error("HTTPS is required");
    hostname = parsed.hostname;
  } catch {
    throw new Error("CORE_PUBLIC_URL must be a valid HTTPS callback URL.");
  }
  try {
    await lookup(hostname);
  } catch {
    throw new Error(
      "CORE_PUBLIC_URL does not resolve. Configure a stable named tunnel hostname before starting Core.",
    );
  }
}

export async function assertModelProviderReachable(input: {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  callbackUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!input.apiKey?.trim() || !input.model.trim()) {
    throw new Error("The model provider startup check requires a model and API key.");
  }
  let modelUrl: URL;
  try {
    modelUrl = new URL(input.baseUrl);
  } catch {
    throw new Error("MODEL_BASE_URL must point to the configured model provider.");
  }
  if (input.callbackUrl) {
    try {
      if (modelUrl.hostname === new URL(input.callbackUrl).hostname) {
        throw new Error(
          "MODEL_BASE_URL must use the provider endpoint; CORE_PUBLIC_URL is reserved for sandbox callbacks.",
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("MODEL_BASE_URL")) throw error;
    }
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: "user", content: "Reply with OK." }],
          stream: true,
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (cause) {
    const error = new Error(
      `Model provider startup check failed for ${input.provider}; Core cannot reach the configured provider.`,
    ) as Error & { code: string; cause?: unknown };
    error.code = classifyModelStartupFailure(cause);
    error.cause = cause;
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const error = new Error(
      `Model provider startup check failed for ${input.provider} (HTTP ${response.status}).`,
    ) as Error & { code: string; status: number };
    error.code = `MODEL_PROVIDER_HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(
      `Model provider startup check failed for ${input.provider}; no model response was returned.`,
    );
  }
  try {
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) throw new Error("MODEL_STREAM_EMPTY");
  } catch {
    throw new Error(`Model provider startup check failed for ${input.provider}; no model response was streamed.`);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

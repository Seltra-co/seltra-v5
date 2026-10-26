import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";
import { cloudflareRunProbeRequest } from "./cloudflare-run-probe.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const envPath = path.resolve(
  process.env.DYAD_WEB_ENV_FILE || path.join(root, ".env.web"),
);
const env = { ...parseDotenv(await fs.readFile(envPath)), ...process.env };
const accountId = env.MODEL_ACCOUNT_ID;
const apiKey = env.MODEL_API_KEY;
const baseUrl = (
  env.MODEL_BASE_URL ||
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
)
  .replaceAll("${MODEL_ACCOUNT_ID}", accountId || "")
  .replace(/\/+$/, "");
if (!accountId || !apiKey)
  throw new Error(
    "Model probe requires MODEL_ACCOUNT_ID and MODEL_API_KEY in .env.web.",
  );

const headers = {
  authorization: `Bearer ${apiKey}`,
  "content-type": "application/json",
  accept: "application/json",
};
let catalogResponse;
try {
  catalogResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?task=${encodeURIComponent("Text Generation")}&per_page=100`,
    {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
} catch {
  throw new Error(
    "Cloudflare model catalog is unreachable. Check network access, MODEL_API_KEY, and MODEL_ACCOUNT_ID.",
  );
}
if (!catalogResponse.ok)
  throw new Error(
    `Cloudflare catalog returned HTTP ${catalogResponse.status}; verify MODEL_API_KEY and MODEL_ACCOUNT_ID.`,
  );
const catalogPayload = await catalogResponse.json();
const models = (
  Array.isArray(catalogPayload.result) ? catalogPayload.result : []
)
  .filter(
    (item) =>
      String(typeof item.task === "string" ? item.task : item.task?.name)
        .toLowerCase()
        .replaceAll("-", " ") === "text generation",
  )
  .map((item) => item.name || item.id)
  .filter((slug) => typeof slug === "string");

async function probe(url, body, timeoutMs = 45_000) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let streams = false;
    let providerError;
    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const first = await Promise.race([
        reader.read(),
        new Promise((resolve) =>
          setTimeout(() => resolve({ done: true }), 10_000),
        ),
      ]);
      streams = !first.done && first.value?.byteLength > 0;
      await reader.cancel().catch(() => undefined);
    } else {
      const text = await response.text().catch(() => "");
      try {
        const payload = JSON.parse(text);
        const error = payload?.error ?? payload?.errors?.[0];
        providerError = {
          code: error?.code,
          message:
            typeof error?.message === "string"
              ? error.message
                  .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
                  .slice(0, 220)
              : undefined,
        };
      } catch {
        providerError = { message: text.slice(0, 220) };
      }
    }
    return { status: response.status, streams, ...(providerError ? { providerError } : {}) };
  } catch (error) {
    return {
      status: error?.name === "TimeoutError" ? "TIMEOUT" : "ERROR",
      streams: false,
    };
  }
}

async function probeToolCalling(slug) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: slug,
        messages: [
          {
            role: "user",
            content: "Call create_file with path probe.txt and contents ok.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_file",
              description: "Create one file.",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  contents: { type: "string" },
                },
                required: ["path", "contents"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: "auto",
        max_tokens: 128,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const responseError = await response.text().catch(() => "");
      const error = providerErrorDetails(responseError);
      return { status: response.status, supported: false, providerError: error };
    }
    const payload = await response.json();
    return {
      status: response.status,
      supported: Boolean(payload?.choices?.[0]?.message?.tool_calls?.length),
    };
  } catch (error) {
    return {
      status: error?.name === "TimeoutError" ? "TIMEOUT" : "ERROR",
      supported: false,
    };
  }
}

function providerErrorDetails(body) {
  try {
    const payload = JSON.parse(body);
    const error = payload?.error ?? payload?.errors?.[0];
    return {
      code: error?.code,
      message:
        typeof error?.message === "string"
          ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 220)
          : undefined,
    };
  } catch {
    return { message: body.slice(0, 220) };
  }
}

const configured = [
  env.AI_MODEL_DEFAULT,
  env.AI_MODEL_REASONING,
  env.AI_MODEL_FAST,
].filter(Boolean);
const requestedModelIndex = process.argv.indexOf("--models");
const requestedModels =
  requestedModelIndex >= 0
    ? (process.argv[requestedModelIndex + 1] || "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
    : [];
const runContextProbe = process.argv.includes("--context");
const outputTokenArgument = process.argv.indexOf("--max-tokens");
const probeOutputTokens =
  outputTokenArgument >= 0
    ? Number(process.argv[outputTokenArgument + 1]) || 8
    : 8;
const uniqueModels = [...new Set(models)];
const probeModel = async (slug) => {
  const compat = await probe(`${baseUrl}/chat/completions`, {
    model: slug,
    messages: [{ role: "user", content: "Reply with ok." }],
    stream: true,
    max_tokens: probeOutputTokens,
  });
  let run = { status: "N/A", streams: true };
  if (slug.startsWith("@cf/")) {
    const runRequest = cloudflareRunProbeRequest(accountId, slug);
    runRequest.body.max_tokens = probeOutputTokens;
    run = await probe(runRequest.url, runRequest.body);
  }
  const toolCall = await probeToolCalling(slug);
  return {
    slug,
    catalog: uniqueModels.includes(slug)
      ? "yes"
      : slug.startsWith("@cf/")
        ? "no"
        : "third-party",
    compat,
    run,
    toolCall,
  };
};
const configuredModels = [...new Set(configured)];
const modelsToProbe = requestedModels.length ? requestedModels : configuredModels;
const rows = await Promise.all(modelsToProbe.map(probeModel));
const configuredPasses = (row) =>
  row.compat.status >= 200 &&
  row.compat.status < 300 &&
  (row.run.status === "N/A" ||
    (row.run.status >= 200 && row.run.status < 300)) &&
  row.compat.streams &&
  row.run.streams;
// Avoid making inference requests to the whole model catalog at every app
// launch. Only probe alternatives when a configured Builder/Planner/Fast model
// fails, so the diagnostics can still name working replacements.
if (!requestedModels.length && rows.some((row) => !configuredPasses(row))) {
  const alternatives = uniqueModels.filter(
    (slug) => !configuredModels.includes(slug),
  );
  for (
    let start = 0;
    start < alternatives.length && rows.filter(configuredPasses).length < 3;
    start += 4
  ) {
    rows.push(
      ...(await Promise.all(
        alternatives.slice(start, start + 4).map(probeModel),
      )),
    );
  }
}
console.log(
  "slug | catalog | chat status/stream | run status/stream | tool-call status/support",
);
for (const row of rows)
  console.log(
    `${row.slug} | ${row.catalog} | chat ${formatProbe(row.compat)} | run ${formatProbe(row.run)} | tools ${row.toolCall.status}/${row.toolCall.supported ? "yes" : row.toolCall.providerError?.code ?? "no"}`,
  );

function formatProbe(result) {
  const detail = result.providerError
    ? ` code=${result.providerError.code ?? "?"} ${result.providerError.message ?? ""}`
    : "";
  return `${result.status}/${result.streams}${detail}`;
}

const working = rows.filter(configuredPasses).map((row) => row.slug);
const unusable = modelsToProbe.filter((slug) => !working.includes(slug));
if (unusable.length)
  throw new Error(
    `Requested text models failed the dual-path streaming probe: ${unusable.join(", ")}. Working alternatives: ${working.slice(0, 10).join(", ") || "none"}.`,
  );
console.log(
  "Configured Builder, Planner, and Fast models passed both streaming paths.",
);

if (runContextProbe) {
  const approximatePrompt = " probe".repeat(20_000);
  for (const slug of configuredModels) {
    let status = "ERROR";
    let reportedLimit = "not reported";
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: slug,
          messages: [{ role: "user", content: approximatePrompt }],
          stream: true,
          max_tokens: 8,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      status = String(response.status);
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
        reportedLimit = "accepted";
      } else {
        const safeBody = await response.text();
        const limit = safeBody.match(
          /(?:maximum context length|context window)[^\d]{0,40}([\d,]+)/i,
        )?.[1];
        if (limit) reportedLimit = `${limit.replaceAll(",", "")} tokens`;
      }
    } catch (error) {
      status = error?.name === "TimeoutError" ? "TIMEOUT" : "ERROR";
    }
    console.log(
      `${slug} | ~20,000-token input probe | HTTP ${status} | limit ${reportedLimit}`,
    );
  }
}

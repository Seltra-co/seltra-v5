//core/src/pro/main/ipc/handlers/local_agent/tools/repair_app.ts
import { z } from "zod";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import { engineFetch } from "./engine_fetch";
import { runningApps } from "@/ipc/utils/process_manager";
import { getLogs } from "@/lib/log_store";
import { formatLogsForAI } from "@/shared/format_logs";
import { isPlaywrightAvailable } from "@/web/playwright_health";
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlContent } from "./types";

const repairAppSchema = z.object({
  path: z
    .string()
    .max(512)
    .optional()
    .describe(
      "Optional same-origin route to inspect, such as /checkout. Do not include a host or credentials.",
    ),
});

export type BrowserEvidence = {
  screenshot: Buffer;
  url: string;
  errors: string[];
  consoleErrors: string[];
  failedRequests: string[];
  ignoredNoise: string[];
};

/** Keep in sync with the dashboard preview console filter. */
export function isIgnoredBrowserNoise(message: string, baseUrl?: string): boolean {
  if (/\[vite\]\s+failed to connect to websocket|\[vite\].*websocket|websocket.*handshake|failed to connect to websocket/i.test(message)) return true;
  if (/\[dyad-screenshot\]/i.test(message)) return true;
  if (/favicon\.ico(?:\b|\?|$)/i.test(message) && /(?:404|not found|failed)/i.test(message)) return true;
  if (/ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/i.test(message)) return true;
  if (/websocket|wss?:\/\//i.test(message)) {
    try {
      const base = baseUrl ? new URL(baseUrl) : undefined;
      const candidate = message.match(/wss?:\/\/[^\s'"<>]+/i)?.[0];
      const socket = candidate ? new URL(candidate) : undefined;
      if (socket && ["ws:", "wss:"].includes(socket.protocol) && base && (socket.hostname === base.hostname || socket.hostname === "localhost" || socket.hostname === "127.0.0.1")) return true;
      if (base && message.toLowerCase().includes(base.hostname.toLowerCase())) return true;
      if (/(?:localhost|127\.0\.0\.1):\d+/i.test(message)) return true;
      if (socket && /^(localhost|127\.0\.0\.1)$/.test(socket.hostname)) return true;
    } catch { /* classify as real if a malformed URL cannot be checked */ }
  }
  return false;
}

export async function captureBrowserEvidence(
  ctx: AgentContext,
  routePath?: string,
): Promise<BrowserEvidence | null> {
  const runtime = runningApps.get(ctx.appId);
  const baseUrl =
    runtime?.cloudPreviewUrl ?? runtime?.proxyUrl ?? runtime?.originalUrl;
  if (!runtime || !baseUrl) return null;
  const target = new URL(baseUrl);
  if (routePath) {
    if (!routePath.startsWith("/") || routePath.startsWith("//"))
      throw new Error(
        "path must be a same-origin path beginning with a single slash.",
      );
    target.pathname = routePath;
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const authToken =
      runtime.mode === "cloud" ? runtime.cloudPreviewAuthToken : undefined;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      ...(authToken
        ? { extraHTTPHeaders: { Authorization: `Bearer ${authToken}` } }
        : {}),
    });
    const page = await context.newPage();
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const ignoredNoise: string[] = [];
    const keepOrIgnore = (entry: string): boolean => {
      if (!isIgnoredBrowserNoise(entry, baseUrl)) return true;
      ignoredNoise.push(entry);
      return false;
    };
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error") {
        errors.push(`console.error: ${text}`);
        if (keepOrIgnore(text)) consoleErrors.push(text);
      } else if (message.type() === "warning" && isIgnoredBrowserNoise(text, baseUrl)) {
        ignoredNoise.push(text);
      }
    });
    page.on("pageerror", (error) => {
      errors.push(`uncaught: ${error.message}`);
      consoleErrors.push(`uncaught: ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      const failure = `${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`;
      errors.push(`request failed: ${failure}`);
      if (keepOrIgnore(failure)) failedRequests.push(failure);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        const failure = `HTTP ${response.status()}: ${response.request().method()} ${response.url()}`;
        errors.push(
          failure,
        );
        if (keepOrIgnore(failure)) failedRequests.push(failure);
      }
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
        break;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`navigation: ${message}`);
        if (keepOrIgnore(`navigation: ${message}`)) failedRequests.push(`navigation: ${message}`);
        if (attempt === 1 || !/timeout/i.test(message)) break;
      }
    }
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
      timeout: 10_000,
    });
    return {
      screenshot,
      url: target.toString(),
      errors: [...new Set(errors)].slice(0, 40),
      consoleErrors: [...new Set(consoleErrors)].slice(0, 40),
      failedRequests: [...new Set(failedRequests)].slice(0, 40),
      ignoredNoise: [...new Set(ignoredNoise)].slice(0, 40),
    };
  } finally {
    await browser.close();
  }
}

async function inspectWithVision(
  ctx: AgentContext,
  evidence: BrowserEvidence,
  logs: string,
): Promise<string> {
  const dataUrl = `data:image/png;base64,${evidence.screenshot.toString("base64")}`;
  const response = await engineFetch(ctx, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "seltra-vision",
      max_tokens: 1400,
      messages: [
        {
          role: "system",
          content:
            "You are Seltra's browser repair diagnostician. Read the screenshot and browser evidence. Identify only concrete, evidence-supported defects, then give the smallest likely code fix and a verification step. Distinguish app-code failures from infrastructure/provider failures. Do not claim you changed code.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Preview: ${evidence.url}\nBrowser errors:\n${evidence.errors.join("\n") || "none captured"}\nRecent app logs:\n${logs.slice(-12_000) || "none captured"}`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    timeoutMs: 90_000,
  });
  if (!response.ok)
    throw new Error(
      `Vision diagnostics failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === "object" && part && "text" in part
          ? String(part.text)
          : "",
      )
      .join("\n");
  return "Vision model returned no textual diagnosis.";
}

export const repairAppTool: ToolDefinition<z.infer<typeof repairAppSchema>> = {
  name: "repair_app",
  description: `Use this for the mandatory browser QA pass on every newly generated app or major user flow, and whenever the preview shows a runtime error, blank page, failed request, or broken UI. Capture browser console, uncaught page errors, failed network requests, HTTP 5xx responses, recent app logs, and a preview screenshot. Treat uncaught exceptions and first-party 5xx responses as defects even when the production build passed. Return the concrete root cause and a smallest-code-change repair brief. Then apply the code fix with the normal file tools and verify it; do not stop after reporting diagnostics. Vision inspection is optional and may be unavailable when no Seltra engine is configured; the captured browser and app errors must still be included.`,
  inputSchema: repairAppSchema,
  defaultConsent: "always",
  modifiesState: false,
  getConsentPreview: (args) =>
    `Inspect app errors${args.path ? ` at ${args.path}` : ""}`,
  execute: async (args, ctx: AgentContext) => {
    ctx.onXmlStream(
      '<dyad-status title="Capturing browser errors and preview"></dyad-status>',
    );
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, ctx.chatId),
      with: { app: true },
    });
    if (!chat?.app) throw new Error("Chat or app not found.");
    const cutoff = Date.now() - 10 * 60_000;
    const appLogs = getLogs(chat.app.id).filter(
      (entry) => entry.timestamp >= cutoff,
    );
    const relevantLogs = appLogs
      .filter((entry) => entry.level === "error" || entry.level === "warn")
      .slice(-80);
    const formattedLogs = relevantLogs.length
      ? formatLogsForAI(relevantLogs, relevantLogs.length)
      : "No recent warning or error logs were captured.";
    let browserEvidence: BrowserEvidence | null = null;
    let captureIssue = "";
    if (!isPlaywrightAvailable()) {
      captureIssue =
        "Browser QA unavailable in this environment because Playwright Chromium is not installed or failed its startup check.";
    } else {
      try {
        browserEvidence = await captureBrowserEvidence(ctx, args.path);
        if (!browserEvidence)
          captureIssue = "No running preview URL is available for this app.";
      } catch (error) {
        captureIssue = error instanceof Error ? error.message : String(error);
      }
    }

    let visualDiagnosis =
      "Vision inspection unavailable: no screenshot was captured.";
    if (browserEvidence) {
      try {
        visualDiagnosis = await inspectWithVision(
          ctx,
          browserEvidence,
          formattedLogs,
        );
      } catch (error) {
        visualDiagnosis = `Vision inspection failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const browserErrors = browserEvidence?.errors.length
      ? browserEvidence.errors.join("\n")
      : "No browser console, page, or failed-request errors captured.";
    const result = [
      `Captured diagnostics for ${browserEvidence?.url ?? "the current app"}.`,
      captureIssue ? `Capture status: ${captureIssue}` : "",
      `Browser errors:\n${browserErrors}`,
      `Recent app logs:\n${formattedLogs}`,
      `Vision diagnosis:\n${visualDiagnosis}`,
      "Repair protocol: fix only the supported root cause, then rerun the relevant typecheck/build or browser check. Stop after two unsuccessful repair passes or when the same failure repeats; report remaining infrastructure issues clearly.",
    ]
      .filter(Boolean)
      .join("\n\n");
    ctx.onXmlComplete(
      `<dyad-status title="Repair diagnostics ready">\n${escapeXmlContent(result)}\n</dyad-status>`,
    );
    return result;
  },
};

import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const envFile = process.env.DYAD_WEB_ENV_FILE || path.join(root, ".env.web");
const config = { ...parse(await readFile(envFile)), ...process.env };
const frontendEnvFile = path.join(root, "..", "frontend", ".env.local");
const frontendConfig = await readFile(frontendEnvFile, "utf8").then(parse).catch(() => ({}));
const frontendOrigin = process.env.SELTRA_FRONTEND_URL || "http://localhost:3000";
const coreOrigin = process.env.SELTRA_CORE_URL || frontendConfig.NEXT_PUBLIC_CORE_URL || "http://localhost:8080";
const accessToken = process.env.SELTRA_ACCESS_TOKEN;
const prompt = process.env.SELTRA_REPRO_PROMPT || "Build a small product landing page with a hero, product cards, and contact section.";
const timeoutMs = Number(process.env.SELTRA_REPRO_TIMEOUT_MS || 240_000);
const idleWaitMs = Number(process.env.SELTRA_REPRO_IDLE_WAIT_MS || 600_000);
const shouldWaitForIdle = process.env.SELTRA_REPRO_WAIT_10_MIN !== "0";
const required = ["SELTRA_ACCESS_TOKEN", "SANDBOX_GATEWAY_URL", "SANDBOX_GATEWAY_SIGNING_SECRET"];
const missing = required.filter((name) => !(name === "SELTRA_ACCESS_TOKEN" ? accessToken : config[name])?.trim?.());
if (missing.length) throw new Error(`Missing required environment variable names: ${missing.join(", ")}`);

function safePrefix(value, limit = 200) {
  let output = String(value ?? "");
  for (const [name, secret] of Object.entries({ ...config, SELTRA_ACCESS_TOKEN: accessToken })) {
    if (/secret|token|key|password|credential|database_url|private/i.test(name) && typeof secret === "string" && secret.length >= 4) output = output.split(secret).join("[redacted]");
  }
  return output.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/((?:token|secret|password|authorization|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .slice(0, limit);
}
function statusLine(step, status, body = "") {
  console.log(JSON.stringify({ step, status, bodyPrefix: safePrefix(body) }));
}
async function waitFor(check, label, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not happen within ${timeout}ms.`);
}
function signedHeaders(method, pathname) {
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString("base64url");
  const signature = createHmac("sha256", config.SANDBOX_GATEWAY_SIGNING_SECRET)
    .update([method.toUpperCase(), pathname, timestamp, nonce].join("\n")).digest("hex");
  return { "x-sandbox-timestamp": timestamp, "x-sandbox-nonce": nonce, "x-sandbox-signature": signature };
}
async function gatewayRequest(pathname, method = "GET", body, caller = "browser_repro") {
  return fetch(`${config.SANDBOX_GATEWAY_URL.replace(/\/$/, "")}${pathname}`, {
    method,
    headers: { ...signedHeaders(method, pathname), "x-seltra-caller": caller, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(210_000),
  });
}
async function gatewaySnapshot(workspaceKey) {
  const response = await gatewayRequest(`/v1/workspaces/${workspaceKey}/diag`);
  const data = await response.json().catch(() => ({}));
  const instanceHistory = data.instanceHistory ?? [];
  return { status: response.status, running: data.running ?? null, instanceId: data.instanceId ?? null, createCount: data.createRequestCount ?? null, starts: instanceHistory.filter((entry) => entry.event === "started").length, instanceHistory, code: data.code ?? null };
}
async function previewGet(requestContext, workspaceKey, appId) {
  const url = `http://ws-${workspaceKey}-app-${appId}.localhost:8080/?__seltra_plan=free`;
  const startedAt = Date.now();
  try {
    const response = await requestContext.get(url, { timeout: 20_000, maxRedirects: 5 });
    const body = await response.text();
    statusLine("browser_preview_get", response.status(), body);
    return { url, status: response.status(), bodyPrefix: safePrefix(body), latencyMs: Date.now() - startedAt };
  } catch (error) {
    const line = { step: "browser_preview_get", status: 0, bodyPrefix: safePrefix(error instanceof Error ? error.message : error), latencyMs: Date.now() - startedAt };
    console.log(JSON.stringify(line));
    return { url, ...line };
  }
}

export async function runBrowserPath() {
  console.log(JSON.stringify({ step: "configuration", frontendHost: new URL(frontendOrigin).hostname, coreHost: new URL(coreOrigin).hostname, sandboxGatewayHost: new URL(config.SANDBOX_GATEWAY_URL).hostname, waitForTenMinIdle: shouldWaitForIdle, environmentNames: ["SELTRA_ACCESS_TOKEN", "SELTRA_REPRO_PROMPT", "SELTRA_REPRO_TIMEOUT_MS", "SELTRA_REPRO_WAIT_10_MIN"] }));
  const browser = await chromium.launch({ headless: process.env.SELTRA_REPRO_HEADLESS !== "0" });
  const context = await browser.newContext();
  const page = await context.newPage();
  const observations = { projectId: null, workspaceId: null, workspaceKey: null, appId: null, ticketStatuses: [], wsOpen: false, runtimeSessionId: null, appStartStatus: null, createAppStatus: null, coreToken: null, blueprintApproved: false, buildCompletion: false, previewUrl: null };
  const responseTasks = [];
  const wsTasks = [];
  page.on("response", (response) => {
    const task = (async () => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith("/api/v5/")) return;
      const pathName = url.pathname;
      if (pathName.endsWith("/core-workspace") && response.request().method() === "POST") {
        const payload = await response.json().catch(() => null);
        observations.projectId = payload?.store?.id ?? observations.projectId;
      }
      if (pathName.endsWith("/builder/session") && response.request().method() === "POST") {
        const payload = await response.json().catch(() => null);
        observations.workspaceId = payload?.workspaceId ?? observations.workspaceId;
        observations.workspaceKey = payload?.coreWorkspaceKey ?? observations.workspaceKey;
        observations.coreToken = payload?.coreToken ?? observations.coreToken;
      }
      if (pathName.endsWith("/builder/ws-ticket")) observations.ticketStatuses.push(response.status());
      statusLine(pathName.split("/").slice(-2).join("/"), response.status());
    })();
    responseTasks.push(task);
  });
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    if (!url.pathname.endsWith("/api/events")) return;
    socket.on("framesent", () => undefined);
    socket.on("framereceived", (frame) => {
      try {
        const raw = typeof frame.payload === "string" ? frame.payload : Buffer.isBuffer(frame.payload) ? frame.payload.toString("utf8") : "";
        const parsed = JSON.parse(raw);
        if (parsed.channel === "web:session") {
          observations.wsOpen = true;
          observations.runtimeSessionId = parsed.payload?.id ?? observations.runtimeSessionId;
        }
        if (parsed.channel === "distributed-machine:snapshot" && parsed.payload?.machineId === "chat_stream") {
          const outcome = parsed.payload?.encodedState?.lastCompletion?.outcome;
          if (outcome) {
            observations.buildCompletion = outcome;
            observations.buildOutcome = outcome;
          }
        }
      } catch {}
    });
    socket.on("close", () => undefined);
    wsTasks.push(Promise.resolve());
  });
  page.on("response", async (response) => {
    try {
      const url = new URL(response.url());
      if (!url.pathname.startsWith("/api/rpc/")) return;
      const channel = decodeURIComponent(url.pathname.split("/").at(-1) || "");
      if (channel === "run-app") observations.appStartStatus = response.status();
      if (channel === "create-app") {
        observations.createAppStatus = response.status();
        const payload = await response.json().catch(() => null);
        const result = payload?.result?.value ?? payload?.result ?? payload?.value ?? payload;
        observations.appId = result?.app?.id ?? result?.appId ?? observations.appId;
      }
    } catch {}
  });

  try {
    await context.addInitScript((token) => { localStorage.setItem("seltra:token", token); }, accessToken);
    await page.goto(`${frontendOrigin}/dashboard`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const composer = page.getByRole("textbox", { name: "Describe the store you want to build" });
    await composer.waitFor({ state: "visible", timeout: timeoutMs });
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const approve = page.getByRole("button", { name: /Approve and build/i });
    const questionnaire = page.getByRole("region", { name: "Build questionnaire" });
    const blueprintDeadline = Date.now() + timeoutMs;
    while (Date.now() < blueprintDeadline && !(await approve.isVisible().catch(() => false))) {
      if (await questionnaire.isVisible().catch(() => false)) {
        await questionnaire.getByRole("button", { name: "Skip all" }).click();
      } else await page.waitForTimeout(500);
    }
    await approve.waitFor({ state: "visible", timeout: Math.max(1, blueprintDeadline - Date.now()) });
    await Promise.allSettled(responseTasks);
    if (!observations.projectId || !observations.workspaceKey) throw new Error("Page flow did not create a project and Core session.");
    const workspaceKey = observations.workspaceKey;
    const beforeBuild = await gatewaySnapshot(workspaceKey);
    console.log(JSON.stringify({ step: "before_approve", projectId: observations.projectId, workspaceId: observations.workspaceId, instances: beforeBuild }));
    await approve.click();
    observations.blueprintApproved = true;
    await waitFor(() => observations.buildCompletion === "completed", "verified build completion");
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")].some((frame) => (frame.getAttribute("src") || "").includes("ws-") && (frame.getAttribute("src") || "").includes("-app-")), undefined, { timeout: timeoutMs });
    observations.previewUrl = await page.locator("iframe").evaluateAll((frames) => frames.map((frame) => frame.getAttribute("src") || "").find((src) => src.includes("ws-") && src.includes("-app-")) || null);
    const appMatch = observations.previewUrl?.match(/-app-(\d+)/);
    observations.appId ??= appMatch ? Number(appMatch[1]) : null;
    if (!observations.appId) throw new Error("The dashboard did not expose an app preview URL after approval/build.");
    const afterBuild = await gatewaySnapshot(workspaceKey);
    console.log(JSON.stringify({ step: "after_build", projectId: observations.projectId, workspaceId: observations.workspaceId, appId: observations.appId, createAppStatus: observations.createAppStatus, appStartStatus: observations.appStartStatus, wsTicketStatuses: observations.ticketStatuses, wsOpen: observations.wsOpen, runtimeSessionId: observations.runtimeSessionId, instances: afterBuild }));

    const first = await previewGet(context.request, workspaceKey, observations.appId);
    const stopPath = `/v1/workspaces/${workspaceKey}/destroy`;
    const stop = await gatewayRequest(stopPath, "POST", {});
    statusLine("force_stop", stop.status, await stop.text());
    const afterStop = await previewGet(context.request, workspaceKey, observations.appId);
    const afterStopSnapshot = await gatewaySnapshot(workspaceKey);
    if (observations.coreToken && observations.runtimeSessionId) {
      const response = await context.request.post(`${coreOrigin.replace(/\/$/, "")}/api/rpc/run-app`, {
        headers: { authorization: `Bearer ${observations.coreToken}`, "content-type": "application/json", "x-runtime-session": observations.runtimeSessionId },
        data: { args: [{ appId: observations.appId }], undefinedArgs: [] }, timeout: 30_000,
      }).catch(() => null);
      statusLine("restart_after_stop", response?.status() ?? 0, response ? await response.text() : "request_failed");
    }
    const afterReplace = await previewGet(context.request, workspaceKey, observations.appId);
    const afterReplaceSnapshot = await gatewaySnapshot(workspaceKey);
    let afterIdle;
    if (shouldWaitForIdle) {
      console.log(JSON.stringify({ step: "idle_wait_started", waitMs: idleWaitMs }));
      await new Promise((resolve) => setTimeout(resolve, idleWaitMs));
      afterIdle = await previewGet(context.request, workspaceKey, observations.appId);
      afterIdle.instance = await gatewaySnapshot(workspaceKey);
    } else {
      afterIdle = { skipped: true, overrideEnvName: "SELTRA_REPRO_WAIT_10_MIN=0" };
      console.log(JSON.stringify({ step: "after_10_min_idle", skipped: true, overrideEnvName: "SELTRA_REPRO_WAIT_10_MIN" }));
    }
    console.log(JSON.stringify({ step: "repro_complete", first, afterStop, afterStopSnapshot, afterReplace, afterReplaceSnapshot, afterIdle }));
    return { observations, beforeBuild, afterBuild, first, afterStop, afterStopSnapshot, afterReplace, afterReplaceSnapshot, afterIdle };
  } finally {
    await Promise.allSettled(responseTasks);
    await Promise.allSettled(wsTasks);
    await context.close();
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBrowserPath().catch((error) => {
    console.error(JSON.stringify({ event: "browser_path_repro_failed", error: safePrefix(error instanceof Error ? error.stack ?? error.message : error, 4000), requiredEnvNames: ["SELTRA_ACCESS_TOKEN", "SELTRA_REPRO_PROMPT", "SELTRA_REPRO_WAIT_10_MIN"] }));
    process.exitCode = 1;
  });
}

// seltra-web/edge/sandbox-gateway/src/index.js
import { DurableObject } from "cloudflare:workers";
import { sandboxId, signRequest, verifyRequest } from "../auth.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
export const MAX_CONTROL_BODY = 24 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 256 * 1024;
export const PORT_READY_TIMEOUT_MS = 60_000;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const CREATE_LIMIT_PER_HOUR = 3;
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const CREATE_INTENTS = new Set(["user_send", "user_approve", "preview_open", "restore", "e2e"]);
const ALLOWED_RUNTIME_ENV = new Set([
  "NODE_ENV", "DYAD_WEB_RUNTIME", "DYAD_WEB_RUNTIME_ENTRY", "DYAD_WORKSPACE_ID",
  "DYAD_USER_DATA", "DYAD_APPS_DIR", "DYAD_TMP_DIR", "RUNTIME_RPC_HOST",
  "RUNTIME_RPC_PORT", "RUNTIME_RPC_SECRET", "RUNTIME_SECRETS_KEY",
  "WORKSPACE_MODEL_TOKEN", "SELTRA_ENGINE_API_KEY", "SELTRA_ENGINE_CREDIT_IDENTITY",
  "MODEL_GATEWAY_URL", "VITE_SELTRA_API_URL", "VITE_SELTRA_STORE_SLUG",
  "PREVIEW_BASE_DOMAIN", "PREVIEW_PUBLIC_SCHEME", "PREVIEW_PUBLIC_PORT",
  "SELTRA_GATEWAY_SELF_TEST",
]);

function json(value, status = 200) {
  return Response.json(value, { status, headers: JSON_HEADERS });
}

function runtimeTrace(request) {
  const traceId = request.headers.get("x-seltra-run-id");
  const caller = request.headers.get("x-seltra-caller");
  return {
    ...(traceId && /^[a-f0-9-]{36}$/i.test(traceId) ? { traceId } : {}),
    caller: caller && /^[a-z0-9_-]{1,40}$/i.test(caller) ? caller : "gateway_request",
  };
}

async function readBodyLimited(request, limit = MAX_CONTROL_BODY) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }

  // Clone before reading so proxy requests, including streaming response and
  // WebSocket routes, never depend on a disturbed incoming Request body.
  const bodyRequest = request.clone();
  if (!bodyRequest.body) return new Uint8Array();
  const reader = bodyRequest.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await Promise.all([
          reader.cancel().catch(() => undefined),
          request.body?.cancel().catch(() => undefined),
        ]);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  await request.body?.cancel().catch(() => undefined);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function proxyHeaders(source, { runtime = false } = {}) {
  const headers = new Headers(source);
  for (const name of [
    "x-sandbox-signature", "x-sandbox-timestamp", "x-sandbox-nonce",
    "content-length", "host", "cf-connecting-ip", "cf-ray", "cf-visitor",
  ]) headers.delete(name);
  if (!runtime) {
    headers.delete("authorization");
    headers.delete("x-runtime-session");
  }
  return headers;
}

function proxyRequest(target, source, body, options = {}) {
  const method = source.method.toUpperCase();
  const headers = proxyHeaders(source.headers, options);
  if (options.previewHost) headers.set("x-seltra-preview-host", options.previewHost);
  if (options.websocketUpgrade) {
    for (const name of ["upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol"]) {
      const value = source.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
  }
  return new Request(target, {
    method,
    headers,
    ...(["GET", "HEAD"].includes(method) ? {} : { body }),
  });
}

function validateWorkspaceKey(value) {
  return typeof value === "string" && /^[a-f0-9]{12,128}$/i.test(value);
}

async function waitForPort(container, port, timeoutMs = PORT_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let delay = 250;
  while (Date.now() < deadline) {
    try {
      const response = await container.getTcpPort(port).fetch("http://container/__ready", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      await response.body?.cancel();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(2000, Math.ceil(delay * 1.5));
  }
  throw new Error("Runtime bootstrap did not report ready within 60 seconds.");
}

export class WorkspaceSandbox extends DurableObject {
  constructor(ctx, env, readyTimeoutMs = PORT_READY_TIMEOUT_MS) {
    super(ctx, env);
    this.readyTimeoutMs = readyTimeoutMs;
    this.monitoring = undefined;
    this.containerStart = undefined;
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(async () => {
        await ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
        this.observeContainer();
      });
    }
  }

  async onStart(instance, reason = "workspace_create") {
    const startedAt = Date.now();
    await this.ctx.storage.put("containerStartedAt", startedAt);
    const requestedAt = await this.ctx.storage.get("containerCreateRequestedAt");
    const lifecycle = await this.ctx.storage.get("lifecycleContext") ?? { caller: "unknown" };
    const instanceId = this.ctx.id.toString();
    const workspaceKey = await this.ctx.storage.get("workspaceKey") ?? null;
    const history = await this.ctx.storage.get("instanceHistory") ?? [];
    if (reason === "workspace_create") history.push({ event: "created", instanceId, workspaceKey, reason, ...lifecycle, at: new Date(startedAt).toISOString() });
    history.push({ event: "started", instanceId, workspaceKey, reason, ...lifecycle, at: new Date(startedAt).toISOString() });
    await this.ctx.storage.put("instanceHistory", history.slice(-40));
    console.info(JSON.stringify({ event: "sandbox_container_created", workspaceKey, instanceId, createRequestCount: await this.ctx.storage.get("createRequestCount") ?? 1, instance, reason, ...lifecycle, elapsedMs: Number.isFinite(requestedAt) ? startedAt - requestedAt : 0 }));
  }
  async onStop(exitCode, reason) {
    const startedAt = await this.ctx.storage.get("containerStartedAt");
    const lifecycle = await this.ctx.storage.get("lifecycleContext") ?? { caller: "unknown" };
    const instanceId = this.ctx.id.toString();
    const workspaceKey = await this.ctx.storage.get("workspaceKey") ?? null;
    const history = await this.ctx.storage.get("instanceHistory") ?? [];
    history.push({ event: "stopped", instanceId, workspaceKey, exitCode, reason, ...lifecycle, at: new Date().toISOString() });
    await this.ctx.storage.put("instanceHistory", history.slice(-40));
    console.info(JSON.stringify({ event: "sandbox_container_stopped", workspaceKey, instanceId, exitCode, reason, ...lifecycle, elapsedMs: Number.isFinite(startedAt) ? Date.now() - startedAt : null }));
    await this.ctx.storage.put("lastExit", { exitCode, reason, at: new Date().toISOString() });
  }
  async onError(code) {
    console.error(JSON.stringify({ event: "sandbox_container_error", code }));
    await this.ctx.storage.put("lastErrorCode", code);
  }

  observeContainer() {
    const container = this.ctx.container;
    if (!container || this.monitoring) return;
    this.monitoring = container.monitor().then(() => this.onStop(0, "exit")).catch((error) => {
      const exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : null;
      this.onStop(exitCode, "error");
    }).finally(() => { this.monitoring = undefined; });
    this.ctx.waitUntil(this.monitoring);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const container = this.ctx.container;
    if (!container) return json({ code: "CONTAINER_UNAVAILABLE" }, 503);
    const bytes = await readBodyLimited(request);
    if (!bytes) return json({ code: "BODY_TOO_LARGE" }, 413);

    if (url.pathname === "/__nonce" && request.method === "POST") {
      const { nonce, timestamp } = JSON.parse(new TextDecoder().decode(bytes));
      const now = Date.now();
      if (typeof nonce !== "string" || !Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 60_000) return json({ code: "AUTH_INVALID" }, 401);
      const key = `nonce:${nonce}`;
      const fresh = await this.ctx.storage.transaction(async (txn) => {
        if (await txn.get(key)) return false;
        await txn.put(key, true, { expirationTtl: 120 });
        return true;
      });
      if (!fresh) return json({ code: "AUTH_REPLAY" }, 401);
      return json({ ok: true });
    }

    if (url.pathname === "/__create" && request.method === "POST") {
      const input = JSON.parse(new TextDecoder().decode(bytes));
      const caller = runtimeTrace(request).caller;
      if (!validateWorkspaceKey(input.workspaceKey) || !input.env || typeof input.env !== "object" || Array.isArray(input.env)) return json({ code: "REQUEST_INVALID" }, 400);
      if (!CREATE_INTENTS.has(input.intent) || (input.intent !== "e2e" && (typeof input.projectId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.projectId)))) {
        console.warn(JSON.stringify({ event: "sandbox_create_rejected", workspaceKey: input.workspaceKey, projectId: typeof input.projectId === "string" ? input.projectId : null, intent: typeof input.intent === "string" ? input.intent : null, caller, reason: "intent_or_active_project_required" }));
        return json({ code: "CREATE_INTENT_REQUIRED" }, 403);
      }
      if (input.env.DYAD_WORKSPACE_ID !== input.workspaceKey) return json({ code: "RUNTIME_ENV_INVALID" }, 400);
      const env = Object.fromEntries(Object.entries(input.env).filter(([name, value]) => ALLOWED_RUNTIME_ENV.has(name) && typeof value === "string"));
      if (Object.keys(env).length !== Object.keys(input.env).length || env.DYAD_WORKSPACE_ID !== input.workspaceKey) return json({ code: "RUNTIME_ENV_INVALID" }, 400);
      const lifecycle = { ...runtimeTrace(request), intent: input.intent, projectId: input.projectId ?? "e2e" };
      const createRequestCount = await this.ctx.storage.transaction(async (txn) => {
        const currentKey = await txn.get("workspaceKey");
        const previous = currentKey === input.workspaceKey ? await txn.get("createRequestCount") ?? 0 : 0;
        const next = previous + 1;
        await txn.put("workspaceKey", input.workspaceKey);
        await txn.put("createRequestCount", next);
        const history = await txn.get("instanceHistory") ?? [];
        history.push({ event: "create_requested", instanceId: this.ctx.id.toString(), workspaceKey: input.workspaceKey, cause: "create", ...lifecycle, createRequestCount: next, at: new Date().toISOString() });
        await txn.put("instanceHistory", history.slice(-40));
        return next;
      });
      const createStartedAt = Date.now();
      console.info(JSON.stringify({ event: "sandbox_create_requested", workspaceKey: input.workspaceKey, createRequestCount, containerRunning: Boolean(container.running), ...lifecycle, at: new Date().toISOString() }));
      await this.ctx.storage.put("workspaceKey", input.workspaceKey);
      await this.ctx.storage.put("runtimeEnv", env);
      await this.ctx.storage.put("lifecycleContext", lifecycle);
      if (!container.running && !this.containerStart) {
        this.containerStart = (async () => {
          try {
            const cap = this.env.REGISTRY.get(this.env.REGISTRY.idFromName("project-create-cap"));
            const capResponse = await cap.fetch("https://registry/__allow-create", { method: "POST", headers: { "content-type": "application/json", "x-seltra-caller": lifecycle.caller, "x-seltra-intent": lifecycle.intent }, body: JSON.stringify({ projectId: lifecycle.projectId, workspaceKey: input.workspaceKey, at: createStartedAt }) });
            if (!capResponse.ok) return capResponse;
            await this.ctx.storage.put("containerCreateRequestedAt", createStartedAt);
            await container.start({ image: container.images.base, env, enableInternet: true, instance: "standard-2" });
            await this.onStart("standard-2", "workspace_create");
            this.observeContainer();
            await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
            await this.ctx.storage.delete("lastExit");
            await this.ctx.storage.delete("lastErrorCode");
            return null;
          } catch {
            await this.onError("CONTAINER_NOT_STARTED");
            // Retain any instance and its diagnostics. Retries must never stop
            // and replace a workspace container behind another caller.
            return json({ code: "CONTAINER_NOT_STARTED" }, 503);
          }
        })().finally(() => { this.containerStart = undefined; });
      }
      if (this.containerStart) {
        const startFailure = await this.containerStart;
        if (startFailure instanceof Response) return startFailure;
      }
      try {
        await waitForPort(container, 8788, this.readyTimeoutMs);
      } catch {
        let status = null;
        try {
          const diagnostic = await container.getTcpPort(8788).fetch("http://container/__boot-status", { signal: AbortSignal.timeout(2500) });
          if (diagnostic.ok) status = await diagnostic.json();
        } catch {}
        const reason = !container.running ? "CONTAINER_EXITED" : status?.exitCode !== null && status?.exitCode !== undefined ? "RUNTIME_CRASHED" : status ? "RUNTIME_TIMEOUT" : "PORT_NOT_LISTENING";
        await this.onError(reason);
        console.error(JSON.stringify({ event: "sandbox_runtime_start_failed", workspaceKey: input.workspaceKey, createRequestCount, code: reason, timeoutMs: PORT_READY_TIMEOUT_MS, elapsedMs: Date.now() - createStartedAt, instance: "standard-2", sleepAfterMs: INACTIVITY_TIMEOUT_MS, bootStatus: status, retainedRunningContainer: Boolean(container.running) }));
        return json({ code: reason, diagnostics: status }, 503);
      }
      console.info(JSON.stringify({ event: "sandbox_runtime_ready", workspaceKey: input.workspaceKey, createRequestCount, elapsedMs: Date.now() - createStartedAt }));
      return json({ sandboxId: sandboxId(input.workspaceKey), ready: true });
    }

    if (url.pathname === "/__destroy" && request.method === "POST") {
      const workspaceKey = await this.ctx.storage.get("workspaceKey") ?? null;
      const lifecycle = runtimeTrace(request);
      const reason = request.headers.get("x-sandbox-destroy-reason");
      if (!new Set(["delete", "idle", "destroy"]).has(reason)) {
        console.warn(JSON.stringify({ event: "sandbox_destroy_rejected", workspaceKey, reason: reason ?? null, caller: lifecycle.caller, rejection: "named_reason_required" }));
        return json({ code: "DESTROY_REASON_REQUIRED" }, 400);
      }
      console.info(JSON.stringify({ event: "sandbox_destroy_requested", workspaceKey, reason, containerRunning: Boolean(container.running), ...lifecycle, at: new Date().toISOString() }));
      if (container.running) await container.destroy();
      await this.monitoring?.catch(() => {});
      const history = await this.ctx.storage.get("instanceHistory") ?? [];
      const createRequestCount = await this.ctx.storage.get("createRequestCount") ?? 0;
      const lastExit = await this.ctx.storage.get("lastExit") ?? null;
      const stopRecord = { event: "stopped", instanceId: this.ctx.id.toString(), workspaceKey, reason, ...lifecycle, at: new Date().toISOString() };
      await this.ctx.storage.deleteAll();
      // Preserve bounded lifecycle evidence after deleting workspace state for later diagnostics.
      const nextHistory = workspaceKey
        ? [...history, stopRecord]
        : history;
      await this.ctx.storage.put("instanceHistory", nextHistory.slice(-40));
      await this.ctx.storage.put("createRequestCount", createRequestCount);
      if (lastExit) await this.ctx.storage.put("lastExit", lastExit);
      return json({ destroyed: true });
    }

    if (url.pathname === "/__diag" && request.method === "GET") {
      const instanceHistory = await this.ctx.storage.get("instanceHistory") ?? [];
      let bootStatus = null;
      let diagnosticCode = "CONTAINER_NOT_STARTED";
      if (container.running) {
        try {
          const response = await container.getTcpPort(8788).fetch("http://container/__boot-status", { signal: AbortSignal.timeout(3000) });
          if (response.ok) { bootStatus = await response.json(); diagnosticCode = bootStatus.runtimeHealthy ? "READY" : "RUNTIME_NOT_READY"; }
          else diagnosticCode = "BOOT_STATUS_HTTP_ERROR";
        } catch { diagnosticCode = "BOOT_STATUS_UNAVAILABLE"; }
      }
      return json({ code: diagnosticCode, running: Boolean(container.running), instanceId: this.ctx.id.toString(), instanceHistory, lastExit: await this.ctx.storage.get("lastExit") ?? null, lastErrorCode: await this.ctx.storage.get("lastErrorCode") ?? null, bootStatus });
    }

    if (url.pathname === "/__exec" && request.method === "POST") {
      if (!container.running) return json({ code: "SANDBOX_NOT_RUNNING" }, 409);
      const input = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(input.argv) || !input.argv.length || input.argv.some((part) => typeof part !== "string" || part.length > 8192) || input.argv.length > 128) return json({ code: "COMMAND_INVALID" }, 400);
      const cwd = typeof input.cwd === "string" && input.cwd.startsWith("/workspace/") ? input.cwd : "/workspace";
      const proc = await container.exec(input.argv, { cwd, stdout: "pipe", stderr: "combined" });
      const output = await proc.output();
      return json({ exitCode: output.exitCode, stdout: new TextDecoder().decode(output.stdout).slice(0, MAX_COMMAND_OUTPUT), stderr: new TextDecoder().decode(output.stderr).slice(0, MAX_COMMAND_OUTPUT) });
    }

    if (url.pathname === "/__files" && request.method === "PUT") {
      if (!container.running) return json({ code: "SANDBOX_NOT_RUNNING" }, 409);
      const input = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(input.files) || input.files.length > 5000 || input.files.some((file) => !file || typeof file.path !== "string" || !file.path || file.path.startsWith("/") || file.path.split(/[\\/]/).includes("..") || typeof file.base64 !== "string")) return json({ code: "FILES_INVALID" }, 400);
      const payload = JSON.stringify(input.files);
      const script = "const fs=require('node:fs'),path=require('node:path'),root='/workspace';let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{for(const f of JSON.parse(s)){const p=path.resolve(root,f.path);if(!p.startsWith(root+path.sep))process.exit(3);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(f.base64,'base64'))}});";
      const stdin = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } });
      const proc = await container.exec(["node", "-e", script], { cwd: "/workspace", stdin, stdout: "ignore" });
      const exitCode = await proc.exitCode;
      if (exitCode !== 0) return json({ code: "FILES_WRITE_FAILED" }, 500);
      return json({ written: input.files.length });
    }

    if (url.pathname === "/__files" && request.method === "POST") {
      if (!container.running) return json({ code: "SANDBOX_NOT_RUNNING" }, 409);
      const input = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(input.paths) || input.paths.length > 200 || input.paths.some((file) => typeof file !== "string" || !file || file.startsWith("/") || file.split(/[\\/]/).includes(".."))) return json({ code: "FILES_INVALID" }, 400);
      const script = "const fs=require('node:fs'),path=require('node:path'),root='/workspace';let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const out=[];for(const f of JSON.parse(s)){const p=path.resolve(root,f);if(!p.startsWith(root+path.sep))process.exit(3);if(fs.existsSync(p)&&fs.statSync(p).isFile())out.push({path:f,base64:fs.readFileSync(p).toString('base64')})}process.stdout.write(JSON.stringify(out))});";
      const stdin = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(input.paths))); controller.close(); } });
      const proc = await container.exec(["node", "-e", script], { cwd: "/workspace", stdin, stdout: "pipe" });
      const output = await proc.output();
      if (output.exitCode !== 0 || output.stdout.byteLength > MAX_CONTROL_BODY) return json({ code: "FILES_READ_FAILED" }, 500);
      return new Response(output.stdout, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/__files" && request.method === "GET") {
      if (!container.running) return json({ code: "SANDBOX_NOT_RUNNING" }, 409);
      if (url.searchParams.get("list") === "1") {
        const script = "const fs=require('node:fs'),path=require('node:path'),root='/workspace',out=[];function walk(d,r=''){for(const n of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,n.name),q=r?`${r}/${n.name}`:n.name;if(n.isDirectory())walk(p,q);else if(n.isFile())out.push(q)}}walk(root);process.stdout.write(JSON.stringify({files:out}))";
        const proc = await container.exec(["node", "-e", script], { cwd: "/workspace", stdout: "pipe" });
        const output = await proc.output();
        if (output.exitCode !== 0 || output.stdout.byteLength > MAX_CONTROL_BODY) return json({ code: "FILES_LIST_FAILED" }, 500);
        return new Response(output.stdout, { headers: JSON_HEADERS });
      }
      const paths = url.searchParams.getAll("path");
      if (!paths.length || paths.length > 5000 || paths.some((file) => !file || file.startsWith("/") || file.split(/[\\/]/).includes(".."))) return json({ code: "FILES_INVALID" }, 400);
      const script = "const fs=require('node:fs'),path=require('node:path'),root='/workspace';let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const out=[];for(const f of JSON.parse(s)){const p=path.resolve(root,f);if(!p.startsWith(root+path.sep))process.exit(3);if(fs.existsSync(p)&&fs.statSync(p).isFile())out.push({path:f,base64:fs.readFileSync(p).toString('base64')})}process.stdout.write(JSON.stringify(out))});";
      const stdin = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(paths))); controller.close(); } });
      const proc = await container.exec(["node", "-e", script], { cwd: "/workspace", stdin, stdout: "pipe" });
      const output = await proc.output();
      if (output.exitCode !== 0 || output.stdout.byteLength > MAX_CONTROL_BODY) return json({ code: "FILES_READ_FAILED" }, 500);
      return new Response(output.stdout, { headers: JSON_HEADERS });
    }

    if (url.pathname.startsWith("/__runtime/") && container.running) {
      const runtimePath = url.pathname.slice("/__runtime".length) + url.search;
      return container.getTcpPort(8787).fetch(proxyRequest(`http://container${runtimePath}`, request, bytes, { runtime: true }));
    }
    if (url.pathname.startsWith("/__preview/") && container.running) {
      const rest = url.pathname.slice("/__preview/".length);
      const [appId, ...suffix] = rest.split("/");
      if (!/^\d+$/.test(appId)) return json({ code: "PREVIEW_INVALID" }, 400);
      const env = await this.ctx.storage.get("runtimeEnv");
      const targetResponse = await container.getTcpPort(8787).fetch(`http://container/internal/preview-target/${appId}`, { headers: { authorization: `Bearer ${env?.RUNTIME_RPC_SECRET ?? ""}` } });
      if (!targetResponse.ok) return new Response("Preview not found", { status: 404 });
      const target = await targetResponse.json();
      const validPreviewHost = target.previewHost === "localhost" || target.previewHost === `app-${appId}.localhost`;
      if (target.appId !== Number(appId) || target.host !== "127.0.0.1" || !validPreviewHost || !Number.isInteger(target.port) || target.port < 1024 || target.port > 65535) return json({ code: "PREVIEW_INVALID" }, 502);
      const previewPath = "/" + suffix.join("/") + new URL(request.url).search;
      // Container fetch owns Host; attach the preview authority before constructing its immutable request.
      const previewRequest = proxyRequest(`http://container${previewPath}`, request, bytes, {
        previewHost: `${target.previewHost}:${target.port}`,
        websocketUpgrade: request.headers.get("upgrade")?.toLowerCase() === "websocket",
      });
      return container.getTcpPort(target.port).fetch(previewRequest);
    }
    if (url.pathname.startsWith("/__preview-diagnostic/") && container.running) {
      const rest = url.pathname.slice("/__preview-diagnostic/".length);
      const [appId, ...suffix] = rest.split("/");
      const env = await this.ctx.storage.get("runtimeEnv");
      if (env?.SELTRA_GATEWAY_SELF_TEST !== "1" || !/^\d+$/.test(appId)) return json({ code: "NOT_FOUND" }, 404);
      const targetResponse = await container.getTcpPort(8787).fetch(`http://container/internal/preview-target/${appId}`, { headers: { authorization: `Bearer ${env.RUNTIME_RPC_SECRET ?? ""}` } });
      if (!targetResponse.ok) return json({ targetStatus: targetResponse.status, mapping: null });
      const target = await targetResponse.json();
      return json({ targetStatus: targetResponse.status, mapping: { host: target.host, hostname: target.previewHost, port: target.port, path: `/${suffix.join("/")}` } });
    }
    return json({ code: "NOT_FOUND" }, 404);
  }
}

export class WorkspaceRegistry extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/__allow-create") {
      const { projectId, workspaceKey, at } = await request.json();
      if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || !validateWorkspaceKey(workspaceKey) || !Number.isSafeInteger(at)) return json({ code: "REQUEST_INVALID" }, 400);
      const result = await this.ctx.storage.transaction(async (txn) => {
        const key = `createTimestamps:${projectId}`;
        const prior = await txn.get(key) ?? [];
        const recent = prior.filter((timestamp) => Number.isSafeInteger(timestamp) && at - timestamp < CREATE_WINDOW_MS);
        if (recent.length >= CREATE_LIMIT_PER_HOUR) return { allowed: false, count: recent.length };
        recent.push(at);
        await txn.put(key, recent);
        return { allowed: true, count: recent.length };
      });
      if (!result.allowed) {
        console.warn(JSON.stringify({ event: "sandbox_create_rejected", projectId, workspaceKey, intent: request.headers.get("x-seltra-intent") ?? null, caller: runtimeTrace(request).caller, reason: "project_create_cap", limit: CREATE_LIMIT_PER_HOUR, windowMs: CREATE_WINDOW_MS }));
        return json({ code: "PROJECT_CREATE_LIMIT", count: result.count }, 429);
      }
      return json(result);
    }
    if (request.method === "POST" && url.pathname === "/__touch") {
      const { workspaceKey } = await request.json();
      if (!validateWorkspaceKey(workspaceKey)) return json({ code: "WORKSPACE_INVALID" }, 400);
      const record = await this.ctx.storage.get(workspaceKey) ?? { createdAt: Date.now() };
      await this.ctx.storage.put(workspaceKey, { ...record, lastSeenAt: Date.now() });
      return json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__remove") {
      const { workspaceKey } = await request.json();
      if (!validateWorkspaceKey(workspaceKey)) return json({ code: "WORKSPACE_INVALID" }, 400);
      await this.ctx.storage.delete(workspaceKey);
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/__list") {
      const records = await this.ctx.storage.list();
      return json({ workspaces: [...records].map(([workspaceKey, value]) => ({ workspaceKey, ...value })) });
    }
    return json({ code: "NOT_FOUND" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") return json({ ok: true, provider: "cloudflare-containers" });
    const match = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/(create|exec|files|destroy|runtime|preview|preview-diagnostic)(?:\/(.*))?$/i);
    const diagnostic = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/diag$/i);
    if (url.pathname === "/v1/workspaces" && request.method === "GET") {
      const body = await readBodyLimited(request);
      if (!body) return json({ code: "BODY_TOO_LARGE" }, 413);
      const auth = await authenticate(request, env, body);
      if (!auth.ok) return json({ code: "AUTH_INVALID" }, 401);
      const replay = await consumeNonce(env, auth.nonce, Number(request.headers.get("x-sandbox-timestamp")));
      if (!replay.ok) return replay.response;
      const registry = env.REGISTRY.get(env.REGISTRY.idFromName("workspace-registry"));
      return registry.fetch("https://registry/__list");
    }
    if (!match && !diagnostic) return json({ code: "NOT_FOUND" }, 404);
    return handleSignedWorkspaceRequest(request, env, url, match, diagnostic);
  },
};

async function handleSignedWorkspaceRequest(request, env, url, match = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/(create|exec|files|destroy|runtime|preview|preview-diagnostic)(?:\/(.*))?$/i), diagnostic = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/diag$/i)) {
  const body = await readBodyLimited(request);
  if (!body) return json({ code: "BODY_TOO_LARGE" }, 413);
  const auth = await authenticate(request, env, body);
  if (!auth.ok) return json({ code: "AUTH_INVALID" }, 401);
  const replay = await consumeNonce(env, auth.nonce, Number(request.headers.get("x-sandbox-timestamp")));
  if (!replay.ok) return replay.response;
  const workspaceKey = match?.[1] ?? diagnostic?.[1];
  if (!workspaceKey) return json({ code: "NOT_FOUND" }, 404);
  const operation = match?.[2] ?? "diag";
  if (operation === "destroy" && !new Set(["delete", "idle", "destroy"]).has(request.headers.get("x-sandbox-destroy-reason"))) {
    console.warn(JSON.stringify({ event: "sandbox_destroy_rejected", workspaceKey, caller: runtimeTrace(request).caller, reason: request.headers.get("x-sandbox-destroy-reason"), rejection: "named_reason_required" }));
    return json({ code: "DESTROY_REASON_REQUIRED" }, 400);
  }
  const doId = env.SANDBOXES.idFromName(workspaceKey);
  const stub = env.SANDBOXES.get(doId);
  const registry = env.REGISTRY.get(env.REGISTRY.idFromName("workspace-registry"));
  const internalPath = operation === "create" ? "/__create" : operation === "exec" ? "/__exec" : operation === "files" ? "/__files" : operation === "destroy" ? "/__destroy" : operation === "runtime" ? `/__runtime/${match[3] ?? ""}` : operation === "preview" ? `/__preview/${match[3] ?? ""}` : operation === "preview-diagnostic" ? `/__preview-diagnostic/${match[3] ?? ""}` : "/__diag";
  const headers = proxyHeaders(request.headers, { runtime: operation === "runtime" });
  const internal = new Request(`https://sandbox${internalPath}${url.search}`, {
    method: request.method,
    headers,
    ...(["GET", "HEAD"].includes(request.method.toUpperCase()) ? {} : { body }),
  });
  const response = await stub.fetch(internal);
  if (response.ok && operation !== "diag" && operation !== "preview-diagnostic") {
    const registryPath = operation === "destroy" ? "/__remove" : "/__touch";
    await registry.fetch(`https://registry${registryPath}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceKey }),
    });
  }
  return response;
}

async function authenticate(request, env, body) {
  if (!env.SANDBOX_GATEWAY_SIGNING_SECRET) return { ok: false };
  const auth = await verifyRequest(env.SANDBOX_GATEWAY_SIGNING_SECRET, request, body);
  return auth.ok ? auth : { ok: false };
}

async function consumeNonce(env, nonce, timestamp) {
  const stub = env.SANDBOXES.get(env.SANDBOXES.idFromName("seltra-gateway-auth-replay"));
  const response = await stub.fetch("https://sandbox/__nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce, timestamp }) });
  return response.ok ? { ok: true } : { ok: false, response };
}

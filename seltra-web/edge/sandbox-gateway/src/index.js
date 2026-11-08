import { DurableObject } from "cloudflare:workers";
import { sandboxId, signRequest, verifyRequest } from "../auth.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
export const MAX_CONTROL_BODY = 24 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 256 * 1024;
const PORT_READY_TIMEOUT_MS = 60_000;
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const ALLOWED_RUNTIME_ENV = new Set([
  "NODE_ENV", "DYAD_WEB_RUNTIME", "DYAD_WEB_RUNTIME_ENTRY", "DYAD_WORKSPACE_ID",
  "DYAD_USER_DATA", "DYAD_APPS_DIR", "DYAD_TMP_DIR", "RUNTIME_RPC_HOST",
  "RUNTIME_RPC_PORT", "RUNTIME_RPC_SECRET", "RUNTIME_SECRETS_KEY",
  "WORKSPACE_MODEL_TOKEN", "SELTRA_ENGINE_API_KEY", "SELTRA_ENGINE_CREDIT_IDENTITY",
  "MODEL_GATEWAY_URL", "VITE_SELTRA_API_URL", "VITE_SELTRA_STORE_SLUG",
  "SELTRA_GATEWAY_SELF_TEST",
]);

function json(value, status = 200) {
  return Response.json(value, { status, headers: JSON_HEADERS });
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

function proxyRequest(target, source, body, options) {
  const method = source.method.toUpperCase();
  return new Request(target, {
    method,
    headers: proxyHeaders(source.headers, options),
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
    console.info(JSON.stringify({ event: "sandbox_container_created", workspaceKey: await this.ctx.storage.get("workspaceKey") ?? null, createRequestCount: await this.ctx.storage.get("createRequestCount") ?? 1, instance, reason, elapsedMs: 0 }));
  }
  async onStop(exitCode, reason) {
    const startedAt = await this.ctx.storage.get("containerStartedAt");
    console.info(JSON.stringify({ event: "sandbox_container_stopped", workspaceKey: await this.ctx.storage.get("workspaceKey") ?? null, exitCode, reason, elapsedMs: Number.isFinite(startedAt) ? Date.now() - startedAt : null }));
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
      if (!validateWorkspaceKey(input.workspaceKey) || !input.env || typeof input.env !== "object" || Array.isArray(input.env)) return json({ code: "REQUEST_INVALID" }, 400);
      const env = Object.fromEntries(Object.entries(input.env).filter(([name, value]) => ALLOWED_RUNTIME_ENV.has(name) && typeof value === "string"));
      if (Object.keys(env).length !== Object.keys(input.env).length || env.DYAD_WORKSPACE_ID !== input.workspaceKey) return json({ code: "RUNTIME_ENV_INVALID" }, 400);
      const createRequestCount = await this.ctx.storage.transaction(async (txn) => {
        const currentKey = await txn.get("workspaceKey");
        const previous = currentKey === input.workspaceKey ? await txn.get("createRequestCount") ?? 0 : 0;
        const next = previous + 1;
        await txn.put("workspaceKey", input.workspaceKey);
        await txn.put("createRequestCount", next);
        return next;
      });
      const createStartedAt = Date.now();
      console.info(JSON.stringify({ event: "sandbox_create_requested", workspaceKey: input.workspaceKey, createRequestCount, containerRunning: Boolean(container.running), at: new Date().toISOString() }));
      await this.ctx.storage.put("workspaceKey", input.workspaceKey);
      await this.ctx.storage.put("runtimeEnv", env);
      if (!container.running) {
        try {
          container.start({ image: container.images.base, env, enableInternet: true, instance: "standard-2" });
          await this.onStart("standard-2", "workspace_create");
          this.observeContainer();
          await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
          await this.ctx.storage.delete("lastExit");
          await this.ctx.storage.delete("lastErrorCode");
        } catch {
          await this.onError("CONTAINER_NOT_STARTED");
          if (container.running) await container.destroy().catch(() => {});
          await this.ctx.storage.deleteAll();
          return json({ code: "CONTAINER_NOT_STARTED" }, 503);
        }
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
      console.info(JSON.stringify({ event: "sandbox_destroy_requested", workspaceKey, reason: request.headers.get("x-sandbox-destroy-reason") ?? "gateway_destroy_rpc", containerRunning: Boolean(container.running), at: new Date().toISOString() }));
      if (container.running) await container.destroy();
      await this.monitoring?.catch(() => {});
      await this.ctx.storage.deleteAll();
      return json({ destroyed: true });
    }

    if (url.pathname === "/__diag" && request.method === "GET") {
      let bootStatus = null;
      let diagnosticCode = "CONTAINER_NOT_STARTED";
      if (container.running) {
        try {
          const response = await container.getTcpPort(8788).fetch("http://container/__boot-status", { signal: AbortSignal.timeout(3000) });
          if (response.ok) { bootStatus = await response.json(); diagnosticCode = bootStatus.runtimeHealthy ? "READY" : "RUNTIME_NOT_READY"; }
          else diagnosticCode = "BOOT_STATUS_HTTP_ERROR";
        } catch { diagnosticCode = "BOOT_STATUS_UNAVAILABLE"; }
      }
      return json({ code: diagnosticCode, running: Boolean(container.running), lastExit: await this.ctx.storage.get("lastExit") ?? null, lastErrorCode: await this.ctx.storage.get("lastErrorCode") ?? null, bootStatus });
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
      if (target.appId !== Number(appId) || target.host !== "127.0.0.1" || !Number.isInteger(target.port) || target.port < 1024 || target.port > 65535) return json({ code: "PREVIEW_INVALID" }, 502);
      const previewPath = "/" + suffix.join("/") + new URL(request.url).search;
      return container.getTcpPort(target.port).fetch(proxyRequest(`http://container${previewPath}`, request, bytes));
    }
    return json({ code: "NOT_FOUND" }, 404);
  }
}

export class WorkspaceRegistry extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
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
    if (url.pathname === "/v1/self-test" && request.method === "POST") {
      const auth = await authenticate(request, env, new Uint8Array());
      if (!auth.ok) return json({ code: "AUTH_INVALID" }, 401);
      const replay = await consumeNonce(env, auth.nonce, Number(request.headers.get("x-sandbox-timestamp")));
      if (!replay.ok) return replay.response;
      const random = (size) => {
        const bytes = crypto.getRandomValues(new Uint8Array(size));
        return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      };
      const workspaceKey = random(16);
      const testId = env.SANDBOXES.idFromName(await sandboxId(workspaceKey));
      const stub = env.SANDBOXES.get(testId);
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      const runtimeEnv = {
        NODE_ENV: "production", DYAD_WEB_RUNTIME: "1", DYAD_WEB_RUNTIME_ENTRY: "1",
        DYAD_WORKSPACE_ID: workspaceKey, DYAD_USER_DATA: "/workspace/userData",
        DYAD_APPS_DIR: "/workspace/apps", DYAD_TMP_DIR: "/workspace/tmp",
        RUNTIME_RPC_HOST: "0.0.0.0", RUNTIME_RPC_PORT: "8787",
        RUNTIME_RPC_SECRET: random(32), RUNTIME_SECRETS_KEY: btoa(String.fromCharCode(...keyBytes)),
        SELTRA_GATEWAY_SELF_TEST: "1",
      };
      let created = false;
      try {
        const create = await stub.fetch("https://sandbox/__create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceKey, env: runtimeEnv }) });
        if (!create.ok) return json({ ok: false, phase: "create", code: (await create.json().catch(() => ({}))).code ?? "CREATE_FAILED" }, 503);
        created = true;
        const exec = await stub.fetch("https://sandbox/__exec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ argv: ["node", "-e", "process.stdout.write('sandbox-ok')"], cwd: "/workspace" }) });
        const result = await exec.json().catch(() => ({}));
        if (!exec.ok || result.exitCode !== 0 || result.stdout !== "sandbox-ok")
          return json({ ok: false, phase: "exec", code: "SELF_TEST_EXEC_FAILED" }, 503);

        const rpcPath = `/v1/workspaces/${workspaceKey}/runtime/rpc/__gateway-self-test`;
        const timestamp = String(Date.now());
        const nonce = random(18);
        const signature = await signRequest(env.SANDBOX_GATEWAY_SIGNING_SECRET, "POST", rpcPath, timestamp, nonce);
        const probe = { args: [{ probe: "gateway-runtime-rpc", nonce: random(8) }] };
        const rpcRequest = new Request(new URL(rpcPath, url.origin), {
          method: "POST",
          headers: {
            authorization: `Bearer ${runtimeEnv.RUNTIME_RPC_SECRET}`,
            "content-type": "application/json",
            "x-sandbox-timestamp": timestamp,
            "x-sandbox-nonce": nonce,
            "x-sandbox-signature": signature,
          },
          body: JSON.stringify(probe),
        });
        const rpcResponse = await handleSignedWorkspaceRequest(rpcRequest, env, new URL(rpcRequest.url));
        const rpcResult = await rpcResponse.json().catch(() => null);
        const ok = rpcResponse.status === 200 && rpcResult?.ok === true && rpcResult?.result?.echo?.args?.[0]?.probe === "gateway-runtime-rpc";
        if (!ok) return json({ ok: false, phase: "runtime-rpc", code: "SELF_TEST_RPC_FAILED" }, 503);

        const scaffoldCheck = await stub.fetch("https://sandbox/__exec", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            argv: ["node", "-e", "const fs=require('node:fs');const p='/opt/dyad/scaffold';if(!fs.statSync(p).isDirectory())process.exit(2);const entries=fs.readdirSync(p);if(!entries.length)process.exit(3);process.stdout.write(JSON.stringify({entryCount:entries.length}))"],
            cwd: "/workspace",
          }),
        });
        const scaffoldResult = await scaffoldCheck.json().catch(() => ({}));
        let scaffoldEntryCount = 0;
        try { scaffoldEntryCount = JSON.parse(scaffoldResult.stdout ?? "null")?.entryCount ?? 0; } catch {}
        if (!scaffoldCheck.ok || scaffoldResult.exitCode !== 0 || !Number.isInteger(scaffoldEntryCount) || scaffoldEntryCount < 1)
          return json({ ok: false, phase: "scaffold", code: "SELF_TEST_SCAFFOLD_FAILED" }, 503);

        const createAppPath = `/v1/workspaces/${workspaceKey}/runtime/rpc/__gateway-create-app-self-test`;
        const createTimestamp = String(Date.now());
        const createNonce = random(18);
        const createSignature = await signRequest(env.SANDBOX_GATEWAY_SIGNING_SECRET, "POST", createAppPath, createTimestamp, createNonce);
        const createProbe = { args: [{ name: `Gateway Scaffold Smoke ${random(6)}`, initialChatMode: "local-agent" }] };
        const createRequest = new Request(new URL(createAppPath, url.origin), {
          method: "POST",
          headers: {
            authorization: `Bearer ${runtimeEnv.RUNTIME_RPC_SECRET}`,
            "content-type": "application/json",
            "x-sandbox-timestamp": createTimestamp,
            "x-sandbox-nonce": createNonce,
            "x-sandbox-signature": createSignature,
          },
          body: JSON.stringify(createProbe),
        });
        const createResponse = await handleSignedWorkspaceRequest(createRequest, env, new URL(createRequest.url));
        const createResult = await createResponse.json().catch(() => null);
        const createAppOk = createResponse.status === 200 && createResult?.ok === true && Number.isInteger(createResult?.result?.appId) && Number.isInteger(createResult?.result?.chatId) && createResult?.result?.scaffoldEntryCount > 0;
        return json({ ok: createAppOk, phase: "create-app", code: createAppOk ? "SELF_TEST_PASSED" : "SELF_TEST_CREATE_APP_FAILED" }, createAppOk ? 200 : 503);
      } finally {
        if (created) await stub.fetch("https://sandbox/__destroy", { method: "POST" }).catch(() => {});
      }
    }
    const match = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/(create|exec|files|destroy|runtime|preview)(?:\/(.*))?$/i);
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

async function handleSignedWorkspaceRequest(request, env, url, match = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/(create|exec|files|destroy|runtime|preview)(?:\/(.*))?$/i), diagnostic = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/diag$/i)) {
  const body = await readBodyLimited(request);
  if (!body) return json({ code: "BODY_TOO_LARGE" }, 413);
  const auth = await authenticate(request, env, body);
  if (!auth.ok) return json({ code: "AUTH_INVALID" }, 401);
  const replay = await consumeNonce(env, auth.nonce, Number(request.headers.get("x-sandbox-timestamp")));
  if (!replay.ok) return replay.response;
  const workspaceKey = match?.[1] ?? diagnostic?.[1];
  if (!workspaceKey) return json({ code: "NOT_FOUND" }, 404);
  const operation = match?.[2] ?? "diag";
  const doId = env.SANDBOXES.idFromName(await sandboxId(workspaceKey));
  const stub = env.SANDBOXES.get(doId);
  const registry = env.REGISTRY.get(env.REGISTRY.idFromName("workspace-registry"));
  const internalPath = operation === "create" ? "/__create" : operation === "exec" ? "/__exec" : operation === "files" ? "/__files" : operation === "destroy" ? "/__destroy" : operation === "runtime" ? `/__runtime/${match[3] ?? ""}` : operation === "preview" ? `/__preview/${match[3] ?? ""}` : "/__diag";
  const headers = proxyHeaders(request.headers, { runtime: operation === "runtime" });
  const internal = new Request(`https://sandbox${internalPath}${url.search}`, {
    method: request.method,
    headers,
    ...(["GET", "HEAD"].includes(request.method.toUpperCase()) ? {} : { body }),
  });
  const response = await stub.fetch(internal);
  if (response.ok && operation !== "diag") {
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

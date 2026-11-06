import { DurableObject } from "cloudflare:workers";
import { sandboxId, verifyRequest } from "../auth.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_CONTROL_BODY = 24 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 256 * 1024;
const PORT_READY_TIMEOUT_MS = 180_000;
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const ALLOWED_RUNTIME_ENV = new Set([
  "NODE_ENV", "DYAD_WEB_RUNTIME", "DYAD_WEB_RUNTIME_ENTRY", "DYAD_WORKSPACE_ID",
  "DYAD_USER_DATA", "DYAD_APPS_DIR", "DYAD_TMP_DIR", "RUNTIME_RPC_HOST",
  "RUNTIME_RPC_PORT", "RUNTIME_RPC_SECRET", "RUNTIME_SECRETS_KEY",
  "WORKSPACE_MODEL_TOKEN", "SELTRA_ENGINE_API_KEY", "SELTRA_ENGINE_CREDIT_IDENTITY",
  "MODEL_GATEWAY_URL", "VITE_SELTRA_API_URL", "VITE_SELTRA_STORE_SLUG",
]);

function json(value, status = 200) {
  return Response.json(value, { status, headers: JSON_HEADERS });
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
  throw new Error("Runtime bootstrap did not report ready within 180 seconds.");
}

export class WorkspaceSandbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.monitoring = undefined;
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(async () => {
        await ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
        this.observeContainer();
      });
    }
  }

  onStart(instance) { console.info(JSON.stringify({ event: "sandbox_container_started", instance })); }
  async onStop(exitCode, reason) {
    console.info(JSON.stringify({ event: "sandbox_container_stopped", exitCode, reason }));
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
    const bytes = new Uint8Array(await request.arrayBuffer());

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
      await this.ctx.storage.put("workspaceKey", input.workspaceKey);
      await this.ctx.storage.put("runtimeEnv", env);
      if (!container.running) {
        try {
          container.start({ image: container.images.base, env, enableInternet: true, instance: "standard-2" });
          this.onStart("standard-2");
          this.observeContainer();
          await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
          await this.ctx.storage.delete("lastExit");
          await this.ctx.storage.delete("lastErrorCode");
        } catch {
          await this.onError("CONTAINER_NOT_STARTED");
          await this.ctx.storage.deleteAll();
          return json({ code: "CONTAINER_NOT_STARTED" }, 503);
        }
      }
      try {
        await waitForPort(container, 8788);
      } catch {
        let status = null;
        try {
          const diagnostic = await container.getTcpPort(8788).fetch("http://container/__boot-status", { signal: AbortSignal.timeout(2500) });
          if (diagnostic.ok) status = await diagnostic.json();
        } catch {}
        const reason = !container.running ? "CONTAINER_EXITED" : status?.exitCode !== null && status?.exitCode !== undefined ? "RUNTIME_CRASHED" : status ? "RUNTIME_TIMEOUT" : "PORT_NOT_LISTENING";
        await this.onError(reason);
        console.error(JSON.stringify({ event: "sandbox_runtime_start_failed", code: reason, timeoutMs: PORT_READY_TIMEOUT_MS, instance: "standard-2", sleepAfterMs: INACTIVITY_TIMEOUT_MS, bootStatus: status }));
        await container.destroy().catch(() => {});
        await this.monitoring?.catch(() => {});
        await this.ctx.storage.deleteAll();
        return json({ code: reason, diagnostics: status }, 503);
      }
      return json({ sandboxId: sandboxId(input.workspaceKey), ready: true });
    }

    if (url.pathname === "/__destroy" && request.method === "POST") {
      await container.destroy();
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
      return container.getTcpPort(8787).fetch(new Request(`http://container${runtimePath}`, request));
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
      return container.getTcpPort(target.port).fetch(new Request(`http://container${previewPath}`, request));
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
      const testId = env.SANDBOXES.idFromName("seltra-gateway-self-test");
      const stub = env.SANDBOXES.get(testId);
      const random = (size) => {
        const bytes = crypto.getRandomValues(new Uint8Array(size));
        return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      };
      const workspaceKey = random(16);
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      const runtimeEnv = {
        NODE_ENV: "production", DYAD_WEB_RUNTIME: "1", DYAD_WEB_RUNTIME_ENTRY: "1",
        DYAD_WORKSPACE_ID: workspaceKey, DYAD_USER_DATA: "/workspace/userData",
        DYAD_APPS_DIR: "/workspace/apps", DYAD_TMP_DIR: "/workspace/tmp",
        RUNTIME_RPC_HOST: "0.0.0.0", RUNTIME_RPC_PORT: "8787",
        RUNTIME_RPC_SECRET: random(32), RUNTIME_SECRETS_KEY: btoa(String.fromCharCode(...keyBytes)),
      };
      let created = false;
      try {
        const create = await stub.fetch("https://sandbox/__create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceKey, env: runtimeEnv }) });
        if (!create.ok) return json({ ok: false, phase: "create", code: (await create.json().catch(() => ({}))).code ?? "CREATE_FAILED" }, 503);
        created = true;
        const exec = await stub.fetch("https://sandbox/__exec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ argv: ["node", "-e", "process.stdout.write('sandbox-ok')"], cwd: "/workspace" }) });
        const result = await exec.json().catch(() => ({}));
        const ok = exec.ok && result.exitCode === 0 && result.stdout === "sandbox-ok";
        return json({ ok, phase: "exec", code: ok ? "SELF_TEST_PASSED" : "SELF_TEST_EXEC_FAILED" }, ok ? 200 : 503);
      } finally {
        if (created) await stub.fetch("https://sandbox/__destroy", { method: "POST" }).catch(() => {});
      }
    }
    const match = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/(create|exec|files|destroy|runtime|preview)(?:\/(.*))?$/i);
    const diagnostic = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{12,128})\/diag$/i);
    if (!match && !diagnostic) return json({ code: "NOT_FOUND" }, 404);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_CONTROL_BODY) return json({ code: "BODY_TOO_LARGE" }, 413);
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_CONTROL_BODY) return json({ code: "BODY_TOO_LARGE" }, 413);
    const auth = await authenticate(request, env, body);
    if (!auth.ok) return json({ code: "AUTH_INVALID" }, 401);
    const replay = await consumeNonce(env, auth.nonce, Number(request.headers.get("x-sandbox-timestamp")));
    if (!replay.ok) return replay.response;
    const workspaceKey = match?.[1] ?? diagnostic[1];
    const operation = match?.[2] ?? "diag";
    const doId = env.SANDBOXES.idFromName(await sandboxId(workspaceKey));
    const stub = env.SANDBOXES.get(doId);
    const internalPath = operation === "create" ? "/__create" : operation === "exec" ? "/__exec" : operation === "files" ? "/__files" : operation === "destroy" ? "/__destroy" : operation === "runtime" ? `/__runtime/${match[3] ?? ""}` : operation === "preview" ? `/__preview/${match[3] ?? ""}` : "/__diag";
    const internal = new Request(`https://sandbox${internalPath}${url.search}`, { method: request.method, headers: request.headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : body });
    return stub.fetch(internal);
  },
};

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

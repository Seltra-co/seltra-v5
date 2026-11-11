import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { signRequest } from "../auth.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const secret = "gateway-proxy-test-signing-secret-never-deployed";
const workspaceKey = "0123456789abcdef";

async function loadWorkerModule() {
  const sourcePath = path.join(root, "src/index.js");
  const authUrl = pathToFileURL(path.join(root, "auth.mjs")).href;
  const source = (await readFile(sourcePath, "utf8"))
    .replace(
      'import { DurableObject } from "cloudflare:workers";',
      "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
    )
    .replace(
      'import { sandboxId, signRequest, verifyRequest } from "../auth.mjs";',
      `import { sandboxId, signRequest, verifyRequest } from "${authUrl}";`,
    );
  assert.ok(!source.includes('from "cloudflare:workers"'));
  const encoded = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

async function createHarness() {
  const worker = await loadWorkerModule();
  const upstreamRequests = [];
  let upgradeResponse;
  const container = {
    running: false,
    images: { base: "test-image" },
    async start() { this.running = true; },
    async destroy() { this.running = false; },
    getTcpPort(port) {
      assert.ok(port === 8787 || port === 43127);
      return {
        async fetch(request) {
          const requestUrl = new URL(typeof request === "string" ? request : request.url);
          const body = request instanceof Request ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array();
          upstreamRequests.push({
            method: request instanceof Request ? request.method : "GET",
            port,
            url: requestUrl,
            headers: request instanceof Request ? request.headers : new Headers(),
            body,
          });
          if (requestUrl.pathname === "/internal/preview-target/7") return Response.json({ appId: 7, host: "127.0.0.1", previewHost: "app-7.localhost", port: 43127 });
          if (port === 43127 && request instanceof Request && request.headers.get("upgrade")?.toLowerCase() === "websocket") return upgradeResponse;
          if (port === 43127) return new Response("preview-mapped-ok", { status: 200 });
          return Response.json({ ok: true, result: { apps: [] } });
        },
      };
    },
  };
  const values = new Map();
  let transactionTail = Promise.resolve();
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async deleteAll() { values.clear(); },
    async delete(key) { values.delete(key); },
    transaction(callback) {
      const transaction = transactionTail.then(() => callback({ get: storage.get, put: storage.put }));
      transactionTail = transaction.catch(() => undefined);
      return transaction;
    },
  };
  const context = {
    id: { toString: () => "test-workspace-instance" },
    container,
    storage,
    blockConcurrencyWhile(callback) { return callback(); },
    waitUntil() {},
  };
  const sandboxEnv = {};
  const sandbox = new worker.WorkspaceSandbox(context, sandboxEnv);
  container.running = true;
  const replayNamespace = {
    async fetch() {
      return Response.json({ ok: true });
    },
  };
  const workspaceRecords = new Map();
  const projectCreateTimes = new Map();
  const registryNamespace = {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/__allow-create') {
        const { projectId, at } = await request.json();
        const recent = (projectCreateTimes.get(projectId) ?? []).filter((timestamp) => at - timestamp < 60 * 60 * 1000);
        if (recent.length >= 3) return Response.json({ code: 'PROJECT_CREATE_LIMIT' }, { status: 429 });
        projectCreateTimes.set(projectId, [...recent, at]);
        return Response.json({ allowed: true });
      }
      if (url.pathname === '/__list') return Response.json({ workspaces: [...workspaceRecords].map(([workspaceKey, value]) => ({ workspaceKey, ...value })) });
      const { workspaceKey } = await request.json();
      if (url.pathname === '/__remove') workspaceRecords.delete(workspaceKey);
      else workspaceRecords.set(workspaceKey, { ...(workspaceRecords.get(workspaceKey) ?? { createdAt: Date.now() }), lastSeenAt: Date.now() });
      return Response.json({ ok: true });
    },
  };
  const env = {
    SANDBOX_GATEWAY_SIGNING_SECRET: secret,
    SANDBOXES: {
      idFromName(name) { return name; },
      get(id) { return id === "seltra-gateway-auth-replay" ? replayNamespace : sandbox; },
    },
    REGISTRY: { idFromName(name) { return name; }, get() { return registryNamespace; } },
  };
  Object.assign(sandboxEnv, env);
  return { worker, env, upstreamRequests, container, workspaceRecords, projectCreateTimes, storage, setUpgradeResponse(value) { upgradeResponse = value; } };
}

async function signedRequest(pathname, { body, signingSecret = secret, headers = {}, method = "POST" } = {}) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const signature = await signRequest(signingSecret, method, pathname, timestamp, nonce);
  return new Request(`https://gateway.test${pathname}`, {
    method,
    headers: {
      ...headers,
      "x-sandbox-timestamp": timestamp,
      "x-sandbox-nonce": nonce,
      "x-sandbox-signature": signature,
    },
    ...(body === undefined ? {} : { body }),
  });
}

const runtimePath = `/v1/workspaces/${workspaceKey}/runtime/rpc/list-apps`;

test("signed preview diagnostics return the registered gateway mapping only for self-test workspaces", async () => {
  const { worker, env, storage, upstreamRequests, workspaceRecords } = await createHarness();
  await storage.put("runtimeEnv", { SELTRA_GATEWAY_SELF_TEST: "1", RUNTIME_RPC_SECRET: "runtime-secret-for-test" });
  const pathname = `/v1/workspaces/${workspaceKey}/preview-diagnostic/7/`;
  const response = await worker.default.fetch(await signedRequest(pathname, { method: "GET" }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    targetStatus: 200,
    mapping: { host: "127.0.0.1", hostname: "app-7.localhost", port: 43127, path: "/" },
  });
  assert.equal(upstreamRequests[0].url.pathname, "/internal/preview-target/7");
  assert.equal(workspaceRecords.has(workspaceKey), false);
});

test("preview route forwards the registered preview hostname to its mapped proxy port", async () => {
  const { worker, env, upstreamRequests } = await createHarness();
  const pathname = `/v1/workspaces/${workspaceKey}/preview/7/`;
  const response = await worker.default.fetch(await signedRequest(pathname, { method: "GET" }), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "preview-mapped-ok");
  assert.equal(upstreamRequests[1].port, 43127);
  assert.equal(upstreamRequests[1].headers.has("host"), false);
  assert.equal(upstreamRequests[1].headers.get("x-seltra-preview-host"), "app-7.localhost:43127");
});

test("preview WebSocket upgrade forwards protocol headers and preserves the 101 webSocket", async () => {
  const { worker, env, upstreamRequests, setUpgradeResponse } = await createHarness();
  const socket = { marker: "upgraded-socket" };
  setUpgradeResponse({ status: 101, ok: false, webSocket: socket });
  const pathname = `/v1/workspaces/${workspaceKey}/preview/7/@vite/client`;
  const response = await worker.default.fetch(await signedRequest(pathname, {
    method: "GET",
    headers: {
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      "sec-websocket-protocol": "vite-hmr",
    },
  }), env);

  assert.equal(response.status, 101);
  assert.equal(response.webSocket, socket);
  const forwarded = upstreamRequests.at(-1);
  assert.equal(forwarded.port, 43127);
  for (const [name, value] of Object.entries({
    upgrade: "websocket",
    connection: "Upgrade",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    "sec-websocket-version": "13",
    "sec-websocket-protocol": "vite-hmr",
  })) assert.equal(forwarded.headers.get(name), value);
});

test("signed runtime RPC POST forwards identical JSON bytes and runtime headers", async () => {
  const { worker, env, upstreamRequests } = await createHarness();
  const payload = Buffer.from(JSON.stringify({ args: [], marker: "body-forwarded" }));
  const request = await signedRequest(runtimePath, {
    body: payload,
    headers: {
      authorization: "Bearer runtime-secret-for-test",
      "content-type": "application/json",
      "x-runtime-session": "runtime-session-test",
    },
  });

  const response = await worker.default.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].method, "POST");
  assert.equal(upstreamRequests[0].url.pathname, "/rpc/list-apps");
  assert.deepEqual(Buffer.from(upstreamRequests[0].body), payload);
  assert.equal(upstreamRequests[0].headers.get("authorization"), "Bearer runtime-secret-for-test");
  assert.equal(upstreamRequests[0].headers.get("x-runtime-session"), "runtime-session-test");
  assert.equal(upstreamRequests[0].headers.has("x-sandbox-signature"), false);
  assert.equal(upstreamRequests[0].headers.has("x-sandbox-timestamp"), false);
  assert.equal(upstreamRequests[0].headers.has("x-sandbox-nonce"), false);
});

test("signed runtime RPC POST forwards an empty body", async () => {
  const { worker, env, upstreamRequests } = await createHarness();
  const request = await signedRequest(runtimePath, {
    headers: { authorization: "Bearer runtime-secret-for-test" },
  });

  const response = await worker.default.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].body.byteLength, 0);
});

test("runtime WebSocket upgrade headers pass through without a request body", async () => {
  const { worker, env, upstreamRequests } = await createHarness();
  const request = await signedRequest(`/v1/workspaces/${workspaceKey}/runtime/events`, {
    method: "GET",
    headers: {
      authorization: "Bearer runtime-secret-for-test",
      connection: "Upgrade",
      upgrade: "websocket",
    },
  });

  const response = await worker.default.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].method, "GET");
  assert.equal(upstreamRequests[0].url.pathname, "/events");
  assert.equal(upstreamRequests[0].headers.get("connection"), "Upgrade");
  assert.equal(upstreamRequests[0].headers.get("upgrade"), "websocket");
  assert.equal(upstreamRequests[0].body.byteLength, 0);
});

test("bad signatures return 401 without calling the runtime", async () => {
  const { worker, env, upstreamRequests } = await createHarness();
  const request = await signedRequest(runtimePath, {
    body: "{}",
    signingSecret: "wrong-signing-secret-that-is-never-deployed",
    headers: { authorization: "Bearer runtime-secret-for-test" },
  });

  const response = await worker.default.fetch(request, env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: "AUTH_INVALID" });
  assert.equal(upstreamRequests.length, 0);
});

test("readiness timeout retains the same container and workspace state", async () => {
  const worker = await loadWorkerModule();
  assert.equal(worker.PORT_READY_TIMEOUT_MS, 60_000);
  const values = new Map();
  let starts = 0;
  let transactionTail = Promise.resolve();
  let destroys = 0;
  const container = {
    running: false,
    images: { base: "test-image" },
    async start() { await new Promise((resolve) => setTimeout(resolve, 1)); starts++; this.running = true; },
    monitor() { return new Promise(() => {}); },
    async destroy() { destroys++; this.running = false; },
    async setInactivityTimeout() {},
    getTcpPort(port) {
      assert.equal(port, 8788);
      return { async fetch(request) {
        assert.equal(starts, 1, "readiness polling must start only after container.start resolves");
        if (new URL(typeof request === "string" ? request : request.url).pathname === "/__boot-status") return Response.json({ runtimeHealthy: false });
        return new Response(null, { status: 503 });
      } };
    },
  };
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async deleteAll() { values.clear(); },
    transaction(callback) {
      const transaction = transactionTail.then(() => callback({ get: storage.get, put: storage.put }));
      transactionTail = transaction.catch(() => undefined);
      return transaction;
    },
  };
  const context = { id: { toString: () => "test-workspace-instance" }, container, storage, waitUntil() {} };
  const sandboxEnv = {};
  const sandbox = new worker.WorkspaceSandbox(context, sandboxEnv, 5);
  const replayNamespace = { async fetch() { return Response.json({ ok: true }); } };
  const env = {
    SANDBOX_GATEWAY_SIGNING_SECRET: secret,
    SANDBOXES: { idFromName(name) { return name; }, get(name) { return name === "seltra-gateway-auth-replay" ? { async fetch() { return Response.json({ ok: true }); } } : sandbox; } },
    REGISTRY: { idFromName(name) { return name; }, get() { return { async fetch() { return Response.json({ ok: true }); } }; } },
  };
  Object.assign(sandboxEnv, env);
  const createPath = `/v1/workspaces/${workspaceKey}/create`;
  const request = await signedRequest(createPath, { body: JSON.stringify({ workspaceKey, projectId: "project-1", intent: "user_send", env: { DYAD_WORKSPACE_ID: workspaceKey } }) });
  const response = await worker.default.fetch(request, env);

  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "RUNTIME_TIMEOUT");
  assert.equal(starts, 1);
  assert.equal(destroys, 0);
  assert.equal(container.running, true);
  assert.equal(await storage.get("workspaceKey"), workspaceKey);
  assert.equal(await storage.get("createRequestCount"), 1);
  assert.equal(await storage.get("lastErrorCode"), "RUNTIME_TIMEOUT");
});

test("concurrent creates and retries use one canonical workspace identity and one container start", async () => {
  const worker = await loadWorkerModule();
  const values = new Map();
  let starts = 0;
  let transactionTail = Promise.resolve();
  const container = {
    running: false,
    images: { base: "test-image" },
    async start() { starts++; await new Promise((resolve) => setTimeout(resolve, 10)); this.running = true; },
    monitor() { return new Promise(() => {}); },
    async setInactivityTimeout() {},
    async setInactivityTimeout(milliseconds) { assert.equal(milliseconds, 10 * 60 * 1000); },
    getTcpPort(port) { assert.equal(port, 8788); return { async fetch() { return Response.json({ ok: true }); } }; },
  };
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async deleteAll() { values.clear(); },
    transaction(callback) {
      const transaction = transactionTail.then(() => callback({ get: storage.get, put: storage.put }));
      transactionTail = transaction.catch(() => undefined);
      return transaction;
    },
  };
  const sandboxEnv = {};
  const sandbox = new worker.WorkspaceSandbox({ id: { toString: () => "one-instance" }, container, storage, waitUntil() {} }, sandboxEnv);
  const names = [];
  const env = {
    SANDBOX_GATEWAY_SIGNING_SECRET: secret,
    SANDBOXES: { idFromName(name) { names.push(name); return name; }, get(name) { return name === "seltra-gateway-auth-replay" ? { async fetch() { return Response.json({ ok: true }); } } : sandbox; } },
    REGISTRY: { idFromName(name) { return name; }, get() { return { async fetch() { return Response.json({ ok: true }); } }; } },
  };
  Object.assign(sandboxEnv, env);
  const pathname = `/v1/workspaces/${workspaceKey}/create`;
  const create = async (index) => worker.default.fetch(await signedRequest(pathname, {
    body: JSON.stringify({ workspaceKey, projectId: "project-1", intent: "user_send", env: { DYAD_WORKSPACE_ID: workspaceKey } }),
    headers: { "x-seltra-caller": `caller_${index}` },
  }), env);
  const responses = await Promise.all(Array.from({ length: 10 }, (_, index) => create(index)));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal((await create(10)).status, 200);
  assert.equal((await create(11)).status, 200);
  assert.equal(starts, 1);
  assert.deepEqual(names.filter((name) => name === workspaceKey), Array(12).fill(workspaceKey));
  assert.equal(await storage.get("createRequestCount"), 12);
  const history = await storage.get("instanceHistory");
  assert.equal(history.filter((entry) => entry.event === "create_requested").length, 12);
  assert.ok(history.some((entry) => entry.caller === "caller_0"));
  assert.ok(history.some((entry) => entry.caller === "caller_11"));
  const restartedSandbox = new worker.WorkspaceSandbox({ id: { toString: () => "one-instance" }, container, storage, blockConcurrencyWhile(callback) { return callback(); }, waitUntil() {} }, {});
  env.SANDBOXES.get = (name) => name === "seltra-gateway-auth-replay" ? { async fetch() { return Response.json({ ok: true }); } } : restartedSandbox;
  assert.equal((await create(12)).status, 200);
  assert.equal(starts, 1, "a Core restart and user retry must reuse the one running instance");
  assert.equal(await storage.get("createRequestCount"), 13);
});

test("create rejects missing intent or active project identity and caps project starts at three per hour", async () => {
  const { worker, env, container, projectCreateTimes } = await createHarness();
  container.running = false;
  const pathname = `/v1/workspaces/${workspaceKey}/create`;
  const missingIntent = await signedRequest(pathname, { body: JSON.stringify({ workspaceKey, projectId: "project-1", env: { DYAD_WORKSPACE_ID: workspaceKey } }) });
  assert.equal((await worker.default.fetch(missingIntent, env)).status, 403);
  projectCreateTimes.set("project-1", [Date.now(), Date.now(), Date.now()]);
  const capped = await signedRequest(pathname, { body: JSON.stringify({ workspaceKey, projectId: "project-1", intent: "user_approve", env: { DYAD_WORKSPACE_ID: workspaceKey } }) });
  assert.equal((await worker.default.fetch(capped, env)).status, 429);
  assert.equal(container.running, false);
});

test("project create cap is shared across different workspace identities", async () => {
  const worker = await loadWorkerModule();
  const values = new Map();
  let transactionTail = Promise.resolve();
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    transaction(callback) {
      const transaction = transactionTail.then(() => callback({ get: storage.get, put: storage.put }));
      transactionTail = transaction.catch(() => undefined);
      return transaction;
    },
  };
  const registry = new worker.WorkspaceRegistry({ storage }, {});
  for (const key of [workspaceKey, '1123456789abcdef', '2123456789abcdef']) {
    const response = await registry.fetch(new Request('https://registry/__allow-create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'project-1', workspaceKey: key, at: Date.now() }) }));
    assert.equal(response.status, 200);
  }
  const fourth = await registry.fetch(new Request('https://registry/__allow-create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'project-1', workspaceKey: '3123456789abcdef', at: Date.now() }) }));
  assert.equal(fourth.status, 429);
});

test("signed workspace destroy is idempotent and diag reports stopped", async () => {
  const { worker, env, container, workspaceRecords, storage } = await createHarness();
  await storage.put("workspaceKey", workspaceKey);
  await storage.put("createRequestCount", 2);
  workspaceRecords.set(workspaceKey, { createdAt: Date.now(), lastSeenAt: Date.now() });
  container.running = true;

  const unnamedDestroy = await signedRequest(`/v1/workspaces/${workspaceKey}/destroy`, { body: "{}" });
  assert.equal((await worker.default.fetch(unnamedDestroy, env)).status, 400);
  assert.equal(container.running, true);

  for (let i = 0; i < 2; i++) {
    const destroy = await signedRequest(`/v1/workspaces/${workspaceKey}/destroy`, { body: "{}", headers: { "x-sandbox-destroy-reason": "delete" } });
    assert.equal((await worker.default.fetch(destroy, env)).status, 200);
  }
  const diag = await signedRequest(`/v1/workspaces/${workspaceKey}/diag`, { method: "GET" });
  const diagnostic = await worker.default.fetch(diag, env);
  assert.equal(diagnostic.status, 200);
  const diagnosticBody = await diagnostic.json();
  assert.equal(diagnosticBody.running, false);
  assert.equal(diagnosticBody.instanceId, "test-workspace-instance");
  assert.ok(diagnosticBody.instanceHistory.some((entry) => entry.event === "stopped" && entry.reason === "delete"));
  assert.equal(workspaceRecords.has(workspaceKey), false);
});

test("oversized streamed bodies return BODY_TOO_LARGE without reaching runtime", async () => {
  const { worker, env, upstreamRequests } = await createHarness();
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const signature = await signRequest(secret, "POST", runtimePath, timestamp, nonce);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(24 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const request = new Request(`https://gateway.test${runtimePath}`, {
    method: "POST",
    headers: {
      "x-sandbox-timestamp": timestamp,
      "x-sandbox-nonce": nonce,
      "x-sandbox-signature": signature,
    },
    body: stream,
    duplex: "half",
  });

  const response = await worker.default.fetch(request, env);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { code: "BODY_TOO_LARGE" });
  assert.equal(upstreamRequests.length, 0);
});

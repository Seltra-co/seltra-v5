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
  const container = {
    running: false,
    getTcpPort(port) {
      assert.equal(port, 8787);
      return {
        async fetch(request) {
          const body = new Uint8Array(await request.arrayBuffer());
          upstreamRequests.push({
            method: request.method,
            url: new URL(request.url),
            headers: request.headers,
            body,
          });
          return Response.json({ ok: true, result: { apps: [] } });
        },
      };
    },
  };
  const context = {
    container,
    storage: {},
  };
  const sandbox = new worker.WorkspaceSandbox(context, {});
  container.running = true;
  const replayNamespace = {
    async fetch() {
      return Response.json({ ok: true });
    },
  };
  const env = {
    SANDBOX_GATEWAY_SIGNING_SECRET: secret,
    SANDBOXES: {
      idFromName(name) { return name; },
      get(id) { return id === "seltra-gateway-auth-replay" ? replayNamespace : sandbox; },
    },
  };
  return { worker, env, upstreamRequests };
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

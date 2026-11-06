import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const children = new Set();
afterEach(() => { for (const child of children) child.kill("SIGTERM"); children.clear(); });

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function launch(fixture) {
  const port = await freePort();
  const rpcPort = await freePort();
  const child = spawn(process.execPath, [path.join(root, "image/bootstrap.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), RUNTIME_RPC_PORT: String(rpcPort), SANDBOX_RUNTIME_ENTRY: path.join(here, "fixtures", fixture), RUNTIME_RPC_SECRET: "test-only-secret", RUNTIME_SECRETS_KEY: "test-only-key" },
    stdio: "ignore",
  });
  children.add(child);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(`${base}/__boot-status`); return { child, base }; } catch { await delay(20); }
  }
  throw new Error("bootstrap listener did not start");
}

test("bootstrap waits for the real runtime RPC listener and reports names only", async () => {
  const { base } = await launch("runtime-ok.mjs");
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await fetch(`${base}/__ready`)).ok) { ready = true; break; }
    await delay(20);
  }
  assert.equal(ready, true);
  const status = await (await fetch(`${base}/__boot-status`)).json();
  assert.equal(status.phase, "ready");
  assert.equal(status.runtimeHealthy, true);
  assert.ok(status.logTail.some((line) => line.includes("fixture runtime started")));
  assert.ok(!JSON.stringify(status).includes("test-only-secret"));
  assert.ok(Array.isArray(status.envNamesMissing));
});

test("bootstrap stays available and reports a runtime crash", async () => {
  const { base } = await launch("runtime-crash.mjs");
  let status;
  for (let attempt = 0; attempt < 100; attempt++) {
    status = await (await fetch(`${base}/__boot-status`)).json();
    if (status.exitCode !== null) break;
    await delay(20);
  }
  assert.equal(status.phase, "runtime-exited");
  assert.equal(status.exitCode, 17);
  assert.equal((await fetch(`${base}/__ready`)).status, 503);
  assert.ok(status.logTail.some((line) => line.includes("fixture runtime failed")));
});

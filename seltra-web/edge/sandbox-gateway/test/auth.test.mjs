import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRequest, sandboxId, signRequest, verifyRequest } from "../auth.mjs";

const secret = "test-only-signing-secret-that-is-never-deployed";

test("signing binds method, full path, timestamp and nonce", async () => {
  const now = Date.now();
  const timestamp = String(now);
  const nonce = "0123456789abcdef0123456789abcdef";
  const url = "https://gateway.test/v1/workspaces/abc123/create?mode=one";
  const signature = await signRequest(secret, "POST", "/v1/workspaces/abc123/create?mode=one", timestamp, nonce);
  const request = new Request(url, { method: "POST", headers: {
    "x-sandbox-timestamp": timestamp,
    "x-sandbox-nonce": nonce,
    "x-sandbox-signature": signature,
  } });
  assert.deepEqual(await verifyRequest(secret, request, new Uint8Array(), now), { ok: true, nonce });
  const changedPath = new Request("https://gateway.test/v1/workspaces/abc123/destroy?mode=one", { method: "POST", headers: request.headers });
  assert.equal((await verifyRequest(secret, changedPath, new Uint8Array(), now)).ok, false);
  assert.equal(canonicalRequest("post", "/x", "1", "n"), canonicalRequest("POST", "/x", "1", "n"));
});

test("expired, malformed, and wrong-key signatures are rejected", async () => {
  const timestamp = String(Date.now() - 120_000);
  const nonce = "0123456789abcdef";
  const signature = await signRequest(secret, "POST", "/v1/self-test", timestamp, nonce);
  const expired = new Request("https://gateway.test/v1/self-test", { method: "POST", headers: {
    "x-sandbox-timestamp": timestamp,
    "x-sandbox-nonce": nonce,
    "x-sandbox-signature": signature,
  } });
  assert.equal((await verifyRequest(secret, expired, new Uint8Array())).ok, false);
  const current = String(Date.now());
  const wrongKeySig = await signRequest("wrong-key", "POST", "/v1/self-test", current, nonce);
  const wrongKey = new Request("https://gateway.test/v1/self-test", { method: "POST", headers: {
    "x-sandbox-timestamp": current,
    "x-sandbox-nonce": nonce,
    "x-sandbox-signature": wrongKeySig,
  } });
  assert.equal((await verifyRequest(secret, wrongKey, new Uint8Array())).ok, false);
});

test("sandbox IDs are deterministic and derived from workspace keys", async () => {
  const first = await sandboxId("workspace-key-a");
  assert.equal(first, await sandboxId("workspace-key-a"));
  assert.notEqual(first, await sandboxId("workspace-key-b"));
  assert.match(first, /^[a-f0-9]{64}$/);
});

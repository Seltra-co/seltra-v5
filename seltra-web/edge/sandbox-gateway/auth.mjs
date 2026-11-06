const encoder = new TextEncoder();

export async function sandboxId(workspaceKey) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(workspaceKey)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalRequest(method, pathname, timestamp, nonce) {
  return [method.toUpperCase(), pathname, timestamp, nonce].join("\n");
}

export async function signRequest(secret, method, pathname, timestamp, nonce) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalRequest(method, pathname, timestamp, nonce)));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyRequest(secret, request, _body, now = Date.now()) {
  const timestamp = request.headers.get("x-sandbox-timestamp") ?? "";
  const nonce = request.headers.get("x-sandbox-nonce") ?? "";
  const signature = request.headers.get("x-sandbox-signature") ?? "";
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > 60_000) return { ok: false, nonce: "" };
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return { ok: false, nonce: "" };
  const expected = await signRequest(secret, request.method, new URL(request.url).pathname + new URL(request.url).search, timestamp, nonce);
  let difference = expected.length ^ signature.length;
  for (let i = 0; i < Math.min(expected.length, signature.length); i++) difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return { ok: difference === 0, nonce };
}

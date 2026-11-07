import { createHmac, randomBytes } from "node:crypto";

const gateway = "https://seltra-sandbox-gateway-dev.williamofosuparwar.workers.dev";
const secret = process.env.SIGNING_SECRET;
if (!secret || secret.length < 32) throw new Error("Dev signing secret is unavailable or invalid.");
function headers(method, pathname) {
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString("base64url");
  const signature = createHmac("sha256", secret).update([method, pathname, timestamp, nonce].join("\n")).digest("hex");
  return { "x-sandbox-timestamp": timestamp, "x-sandbox-nonce": nonce, "x-sandbox-signature": signature };
}
async function request(path, method, body, extraHeaders = {}) {
  return fetch(`${gateway}${path}`, {
    method,
    headers: { ...headers(method, path), ...(body ? { "content-type": "application/json" } : {}), ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(210_000),
  });
}
const deadline = Date.now() + 10 * 60_000;
let lastError;
for (let attempt = 1; Date.now() < deadline; attempt++) {
const workspaceKey = randomBytes(16).toString("hex");
const route = (suffix) => `/v1/workspaces/${workspaceKey}/${suffix}`;
try {
  const env = {
    NODE_ENV: "production", DYAD_WEB_RUNTIME: "1", DYAD_WEB_RUNTIME_ENTRY: "1",
    DYAD_WORKSPACE_ID: workspaceKey, DYAD_USER_DATA: "/workspace/userData",
    DYAD_APPS_DIR: "/workspace/apps", DYAD_TMP_DIR: "/workspace/tmp",
    RUNTIME_RPC_HOST: "0.0.0.0", RUNTIME_RPC_PORT: "8787",
    RUNTIME_RPC_SECRET: randomBytes(32).toString("hex"), RUNTIME_SECRETS_KEY: randomBytes(32).toString("base64"),
    SELTRA_GATEWAY_SELF_TEST: "1",
  };
  const create = await request(route("create"), "POST", { workspaceKey, env });
  if (!create.ok) throw new Error(`create failed (${create.status})`);
  const exec = await request(route("exec"), "POST", { argv: ["node", "-e", "process.stdout.write('sandbox-exec-ok')"], cwd: "/workspace" });
  const result = await exec.json().catch(() => ({}));
  if (!exec.ok || result.exitCode !== 0 || result.stdout !== "sandbox-exec-ok") throw new Error(`exec failed (${exec.status}, exit ${result.exitCode ?? "unknown"})`);
  const rpcPath = route("runtime/rpc/__gateway-self-test");
  const rpcProbe = { args: [{ probe: "gateway-runtime-rpc", value: randomBytes(8).toString("hex") }] };
  const rpc = await request(rpcPath, "POST", rpcProbe, {
    authorization: `Bearer ${env.RUNTIME_RPC_SECRET}`,
    "x-runtime-session": "ci-gateway-self-test",
  });
  const rpcBody = await rpc.json().catch(() => null);
  if (!rpc.ok || rpcBody?.ok !== true || JSON.stringify(rpcBody?.result?.echo) !== JSON.stringify(rpcProbe))
    throw new Error(`runtime RPC body probe failed (${rpc.status})`);
  const diagPath = route("diag");
  const diag = await request(diagPath, "GET");
  const diagBody = await diag.json().catch(() => ({}));
  if (!diag.ok || diagBody.code !== "READY" || diagBody.bootStatus?.arch !== "x64") throw new Error(`diagnostic readiness failed (${diag.status}, ${diagBody.code ?? "unknown"})`);
  // The newly created workspace has no generated app registered yet. This confirms
  // signed preview routing reaches the live sandbox and returns the expected 404.
  const previewPath = route("preview/1/");
  const preview = await request(previewPath, "GET");
  if (preview.status !== 404) throw new Error(`empty-project preview probe returned ${preview.status}, expected 404`);
  console.log(JSON.stringify({ attempt, create: "passed", exec: "passed", runtimeRpcBody: "passed", diagnostics: "passed", previewRoute: "reachable-empty-project-404", destroy: "pending" }));
  lastError = undefined;
  break;
} catch (error) {
  lastError = error;
  try {
    const diagnostic = await request(route("diag"), "GET");
    console.error(JSON.stringify({ diagnosticStatus: diagnostic.status, diagnostic: await diagnostic.json() }));
  } catch {
    console.error(JSON.stringify({ diagnosticStatus: "unavailable" }));
  }
} finally {
  const destroy = await request(route("destroy"), "POST", {});
  if (!destroy.ok) throw new Error(`destroy failed (${destroy.status})`);
  console.log(JSON.stringify({ attempt, destroy: "passed" }));
}
if (lastError) {
  if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, deadline - Date.now())));
}
}
if (lastError) throw lastError;

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
let appSmokeReached = false;
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
  const scaffold = await request(route("exec"), "POST", {
    argv: ["node", "-e", "const fs=require('node:fs');const p='/opt/dyad/scaffold';if(!fs.statSync(p).isDirectory())process.exit(2);const entries=fs.readdirSync(p);if(!entries.length)process.exit(3);process.stdout.write(JSON.stringify({entryCount:entries.length}))"],
    cwd: "/workspace",
  });
  const scaffoldBody = await scaffold.json().catch(() => ({}));
  let scaffoldResult;
  try { scaffoldResult = JSON.parse(scaffoldBody.stdout ?? "null"); } catch {}
  if (!scaffold.ok || scaffoldBody.exitCode !== 0 || !Number.isInteger(scaffoldResult?.entryCount) || scaffoldResult.entryCount < 1)
    throw new Error(`workspace scaffold check failed (${scaffold.status})`);
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
  const createAppPath = route("runtime/rpc/__gateway-create-app-self-test");
  const createAppProbe = {
    args: [{ name: `Gateway Scaffold Smoke ${randomBytes(6).toString("hex")}`, initialChatMode: "local-agent" }],
  };
  const createApp = await request(createAppPath, "POST", createAppProbe, {
    authorization: `Bearer ${env.RUNTIME_RPC_SECRET}`,
    "x-runtime-session": "ci-gateway-create-app-self-test",
  });
  const createAppBody = await createApp.json().catch(() => null);
  if (!createApp.ok || createAppBody?.ok !== true || !Number.isInteger(createAppBody?.result?.appId) || !Number.isInteger(createAppBody?.result?.chatId) || !Number.isInteger(createAppBody?.result?.scaffoldEntryCount) || createAppBody.result.scaffoldEntryCount < 1)
    throw new Error(`runtime create-app probe failed (${createApp.status}, ${createAppBody?.error?.code ?? "unknown"})`);
  appSmokeReached = true;
  const appId = createAppBody.result.appId;
  const runApp = await request(route("runtime/rpc/run-app"), "POST", {
    args: [{ appId }],
  }, {
    authorization: `Bearer ${env.RUNTIME_RPC_SECRET}`,
    "x-runtime-session": "ci-gateway-preview-smoke",
  });
  const runAppBody = await runApp.json().catch(() => null);
  if (!runApp.ok || runAppBody?.ok !== true)
    throw new Error(`runtime run-app probe failed (${runApp.status}, ${runAppBody?.error?.code ?? "unknown"})`);
  const diagPath = route("diag");
  const diag = await request(diagPath, "GET");
  const diagBody = await diag.json().catch(() => ({}));
  if (!diag.ok || diagBody.code !== "READY" || diagBody.bootStatus?.arch !== "x64") throw new Error(`diagnostic readiness failed (${diag.status}, ${diagBody.code ?? "unknown"})`);
  const previewPath = route(`preview/${appId}/`);
  const previewDeadline = Date.now() + 45_000;
  let previewStatus = 0;
  while (Date.now() < previewDeadline) {
    const preview = await request(previewPath, "GET");
    previewStatus = preview.status;
    if (preview.status === 200) break;
    if (![404, 502, 503].includes(preview.status))
      throw new Error(`preview route returned unexpected status ${preview.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (previewStatus !== 200) throw new Error(`app preview did not become ready (last status ${previewStatus})`);
  console.log(JSON.stringify({ attempt, create: "passed", scaffold: "present", scaffoldEntryCount: scaffoldResult.entryCount, exec: "passed", runtimeRpcBody: "passed", createApp: "passed", appProcess: "started", previewRoute: "200", diagnostics: "passed", destroy: "pending" }));
  lastError = undefined;
  break;
} catch (error) {
  lastError = error;
  try {
    const diagnostic = await request(route("diag"), "GET");
    const diagnosticBody = await diagnostic.json().catch(() => ({}));
    console.error(JSON.stringify({ diagnosticStatus: diagnostic.status, diagnosticCode: diagnosticBody.code ?? "unknown" }));
  } catch {
    console.error(JSON.stringify({ diagnosticStatus: "unavailable" }));
  }
} finally {
  const destroy = await request(route("destroy"), "POST", {});
  if (!destroy.ok) throw new Error(`destroy failed (${destroy.status})`);
  console.log(JSON.stringify({ attempt, destroy: "passed" }));
}
if (lastError) {
  if (appSmokeReached) break;
  if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, deadline - Date.now())));
}
}
if (lastError) throw lastError;

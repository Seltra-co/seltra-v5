import { createHmac, randomBytes } from "node:crypto";
import WebSocket from "ws";

const gateway = (process.env.SANDBOX_GATEWAY_URL || "https://seltra-sandbox-gateway-dev.williamofosuparwar.workers.dev").replace(/\/$/, "");
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
async function openRuntimeSession(path, runtimeSecret) {
  const socket = new WebSocket(`${gateway}${path}`, {
    headers: { ...headers("GET", path), authorization: `Bearer ${runtimeSecret}` },
  });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("runtime events session timed out")), 20_000);
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
      socket.on("message", (data) => {
        let frame;
        try { frame = JSON.parse(data.toString()); } catch { return; }
        if (frame.channel !== "web:session" || typeof frame.payload?.id !== "string") return;
        clearTimeout(timer);
        resolve({ id: frame.payload.id, socket, openedAt: Date.now() });
      });
    });
  } catch (error) {
    socket.close();
    throw error;
  }
}
function safeResponseHeaders(headers) {
  const allowed = ["content-type", "server", "location", "cf-ray", "x-powered-by"];
  return Object.fromEntries(allowed.flatMap((name) => headers.has(name) ? [[name, headers.get(name)]] : []));
}
function safeText(value, additionalSecrets = [], limit = 500) {
  let output = String(value ?? "");
  for (const secretValue of [...Object.values(process.env), ...additionalSecrets]) {
    if (typeof secretValue === "string" && secretValue.length >= 8) output = output.split(secretValue).join("[redacted]");
  }
  return output.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").slice(0, limit);
}
async function diagnosePreview(workspaceKey, appId, runtimeSecret, previewPath) {
  const script = [
    ";(async()=>{",
    "const {spawnSync}=require('node:child_process')",
    "const appId=Number(process.argv[1])",
    "const scrub=s=>{let v=String(s??'');for(const x of Object.values(process.env)){if(typeof x==='string'&&x.length>=8)v=v.split(x).join('[redacted]')}return v.replace(/Bearer\\s+[^\\s\"']+/gi,'Bearer [redacted]').replace(/((?:token|secret|password|authorization|api[_-]?key)\\s*[=:]\\s*)[^\\s,;]+/gi,'$1[redacted]')}",
    "const trim=(s,n=500)=>scrub(s).slice(0,n)",
    "const auth={authorization:'Bearer '+process.argv[2]}",
    "const [diagRes,mapRes]=await Promise.all([fetch('http://127.0.0.1:8787/internal/diagnostics/app/'+appId,{headers:auth}),fetch('http://127.0.0.1:8787/internal/preview-target/'+appId,{headers:auth})])",
    "const diagnostics=await diagRes.json().catch(()=>null)",
    "const runtimeMapping=await mapRes.json().catch(()=>null)",
    "let listeners=spawnSync('ss',['-ltnp'],{encoding:'utf8'});if(listeners.status!==0)listeners=spawnSync('netstat',['-ltnp'],{encoding:'utf8'})",
    "const lines=String(listeners.stdout||'').split(/\\r?\\n/).slice(1).filter(Boolean)",
    "const ports=[...new Set(lines.map(line=>{const cols=line.trim().split(/\\s+/);const addr=cols[3]||cols[1]||'';const p=Number(addr.slice(addr.lastIndexOf(':')+1));return Number.isInteger(p)&&p>0&&p<65536?p:null}).filter(Boolean))]",
    "const portChecks=ports.map(port=>{const r=spawnSync('curl',['-sS','-i','--max-time','3','http://127.0.0.1:'+port+'/'],{encoding:'utf8',maxBuffer:65536});const raw=String(r.stdout||'')+'\\n'+String(r.stderr||'');const split=raw.indexOf('\\r\\n\\r\\n');const headers=split>=0?raw.slice(0,split):raw;const body=split>=0?raw.slice(split+4):'';const safeHeaders=headers.split(/\\r?\\n/).filter((line,i)=>i===0||/^(content-type|server|allow|vary):/i.test(line)).map(line=>trim(line,300));return {port,status:(headers.match(/HTTP\\/[^ ]+ ([0-9]{3})/)||[])[1]||'ERR',headers:safeHeaders,bodyFirst500:trim(body,500),error:trim(r.error?.message||'')}})",
    "process.stdout.write(JSON.stringify({diagnosticsStatus:diagRes.status,diagnostics,runtimeMappingStatus:mapRes.status,runtimeMapping,listening:trim(listeners.stdout||listeners.stderr||'',4000),portChecks}))",
    "})().catch(error=>{process.stderr.write(String(error?.stack||error))})",
  ].join(";");
  const exec = await request(`/v1/workspaces/${workspaceKey}/exec`, "POST", {
    argv: ["node", "-e", script, String(appId), runtimeSecret], cwd: "/workspace",
  });
  const execBody = await exec.json().catch(() => ({}));
  let container = null;
  try { container = JSON.parse(execBody.stdout ?? "null"); } catch {}
  const mappingResponse = await request(`/v1/workspaces/${workspaceKey}/preview-diagnostic/${appId}/`, "GET");
  const gatewayMapping = await mappingResponse.json().catch(() => null);
  const failingPreview = await request(previewPath, "GET");
  const previewBody = await failingPreview.text().catch(() => "");
  return {
    execStatus: exec.status,
    execExitCode: execBody.exitCode ?? null,
    execOutput: safeText(execBody.stdout ?? "", [runtimeSecret], 5000),
    execError: safeText(execBody.stderr ?? "", [runtimeSecret], 2500),
    container,
    gatewayMappingStatus: mappingResponse.status,
    gatewayMapping,
    failingPreview: {
      status: failingPreview.status,
      headers: safeResponseHeaders(failingPreview.headers),
      bodyFirst500: safeText(previewBody, [runtimeSecret]),
    },
  };
}
const deadline = Date.now() + 10 * 60_000;
let lastError;
for (let attempt = 1; Date.now() < deadline; attempt++) {
const workspaceKey = randomBytes(16).toString("hex");
const route = (suffix) => `/v1/workspaces/${workspaceKey}/${suffix}`;
let appSmokeReached = false;
let diagnosticAppId;
let diagnosticRuntimeSecret;
let runtimeSession;
try {
  const env = {
    NODE_ENV: "production", DYAD_WEB_RUNTIME: "1", DYAD_WEB_RUNTIME_ENTRY: "1",
    DYAD_WORKSPACE_ID: workspaceKey, DYAD_USER_DATA: "/workspace/userData",
    DYAD_APPS_DIR: "/workspace/apps", DYAD_TMP_DIR: "/workspace/tmp",
    RUNTIME_RPC_HOST: "0.0.0.0", RUNTIME_RPC_PORT: "8787",
    RUNTIME_RPC_SECRET: randomBytes(32).toString("hex"), RUNTIME_SECRETS_KEY: randomBytes(32).toString("base64"),
    SELTRA_GATEWAY_SELF_TEST: "1",
  };
  const create = await request(route("create"), "POST", { workspaceKey, projectId: `dev-smoke-${workspaceKey}`, intent: "e2e", env });
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
  diagnosticAppId = appId;
  diagnosticRuntimeSecret = env.RUNTIME_RPC_SECRET;
  runtimeSession = await openRuntimeSession(route("runtime/events"), env.RUNTIME_RPC_SECRET);
  const runApp = await request(route("runtime/rpc/run-app"), "POST", {
    args: [{ appId }], undefinedArgs: [],
  }, {
    authorization: `Bearer ${env.RUNTIME_RPC_SECRET}`,
    "x-runtime-session": runtimeSession.id,
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
  let previewHtml = "";
  while (Date.now() < previewDeadline) {
    const preview = await request(previewPath, "GET");
    previewStatus = preview.status;
    if (preview.status === 200) { previewHtml = await preview.text(); break; }
    if (![404, 502, 503].includes(preview.status))
      throw new Error(`preview route returned unexpected status ${preview.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (previewStatus !== 200) throw new Error(`app preview did not become ready (last status ${previewStatus})`);
  if (!/id=["']root["']/.test(previewHtml)) throw new Error("app preview returned 200 without the app root element");
  const previewDiagnostics = await diagnosePreview(workspaceKey, appId, diagnosticRuntimeSecret, previewPath);
  console.log(JSON.stringify({ attempt, create: "passed", scaffold: "present", scaffoldEntryCount: scaffoldResult.entryCount, exec: "passed", runtimeRpcBody: "passed", createApp: "passed", appProcess: "started", previewRoute: String(previewStatus), appRoot: "present", runtimeEventsHeldThroughPreview: true, runtimeEventsSessionMs: Date.now() - runtimeSession.openedAt, diagnostics: { devUrlDetected: previewDiagnostics.container?.diagnostics?.devUrlDetected ?? null, mappingRegistered: previewDiagnostics.container?.diagnostics?.mappingRegistered ?? null, skipReason: previewDiagnostics.container?.diagnostics?.skipReason ?? null, previewMapping: previewDiagnostics.container?.diagnostics?.previewMapping ?? null, loopbackProbeAttempts: previewDiagnostics.container?.diagnostics?.loopbackProbeAttempts ?? [], runtimeMappingStatus: previewDiagnostics.container?.runtimeMappingStatus ?? null, runtimeMapping: previewDiagnostics.container?.runtimeMapping ?? null, gatewayMappingStatus: previewDiagnostics.gatewayMappingStatus, gatewayMapping: previewDiagnostics.gatewayMapping, previewThroughGatewayStatus: previewDiagnostics.failingPreview.status }, destroy: "pending" }));
  lastError = undefined;
  break;
} catch (error) {
  lastError = error;
  if (appSmokeReached && diagnosticAppId) {
    try {
      console.error(JSON.stringify({ event: "preview_failure_diagnostic", attempt, details: await diagnosePreview(workspaceKey, diagnosticAppId, diagnosticRuntimeSecret, route(`preview/${diagnosticAppId}/`)) }));
    } catch (diagnosticError) {
      console.error(JSON.stringify({ event: "preview_failure_diagnostic", attempt, errorClass: diagnosticError instanceof Error ? diagnosticError.name : "UNKNOWN", error: safeText(diagnosticError instanceof Error ? diagnosticError.message : "") }));
    }
  }
  try {
    const diagnostic = await request(route("diag"), "GET");
    const diagnosticBody = await diagnostic.json().catch(() => ({}));
    console.error(JSON.stringify({ diagnosticStatus: diagnostic.status, diagnosticCode: diagnosticBody.code ?? "unknown" }));
  } catch {
    console.error(JSON.stringify({ diagnosticStatus: "unavailable" }));
  }
} finally {
  const destroy = await request(route("destroy"), "POST", {}, { "x-sandbox-destroy-reason": "destroy" });
  runtimeSession?.socket.close();
  if (!destroy.ok) throw new Error(`destroy failed (${destroy.status})`);
  console.log(JSON.stringify({ attempt, destroy: "passed" }));
}
if (lastError) {
  if (appSmokeReached) break;
  if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, deadline - Date.now())));
}
}
if (lastError) throw lastError;

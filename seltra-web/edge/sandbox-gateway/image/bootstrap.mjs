import http from "node:http";
import { spawn } from "node:child_process";

const runtimePort = Number(process.env.RUNTIME_RPC_PORT || 8787);
const runtimeEntry = process.env.SANDBOX_RUNTIME_ENTRY || "/opt/dyad/runtime_main.js";
const bootStartedAt = new Date().toISOString();
const logs = [];
let phase = "starting-runtime";
let exitCode = null;
let exitSignal = null;
let lastError = null;
let child;
const requiredEnvNames = ["DYAD_WORKSPACE_ID", "DYAD_USER_DATA", "DYAD_APPS_DIR", "DYAD_TMP_DIR", "RUNTIME_RPC_HOST", "RUNTIME_RPC_PORT", "RUNTIME_RPC_SECRET", "RUNTIME_SECRETS_KEY"];

function safeLine(value) {
  return String(value)
    .replace(/(["']?(?:token|secret|password|credential|api[_-]?key|signature|authorization)["']?\s*[:=]\s*["']?)([^"'\s,;}]+)/ig, "$1[redacted]")
    .replace(/(?:postgres|mysql|https?):\/\/[^\s/:@]+:[^\s/@]+@/ig, "[redacted]@")
    .replace(/\b(?:sk-|ghp_|gho_|github_pat_|cf_)[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/Bearer\s+\S+/ig, "Bearer [redacted]").slice(0, 1000);
}
function record(chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (!line) continue;
    logs.push(safeLine(line));
    if (logs.length > 160) logs.shift();
    if (/error|fatal|failed|exception/i.test(line)) lastError = safeLine(line);
  }
}
function status() {
  const report = process.report?.getReport?.();
  return {
    phase, bootStartedAt, uptimeSeconds: Math.floor(process.uptime()),
    childPid: child?.pid ?? null, exitCode, exitSignal, lastError,
    runtimePort, runtimeHealthy: phase === "ready",
    node: process.version, platform: process.platform, arch: process.arch,
    glibc: report?.header?.glibcVersionRuntime ?? null,
    memory: process.memoryUsage(), logTail: logs.slice(-80),
    envNamesPresent: requiredEnvNames.filter((key) => Boolean(process.env[key])).sort(),
    envNamesMissing: requiredEnvNames.filter((key) => !process.env[key]).sort(),
  };
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/__boot-status") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(status()));
    return;
  }
  if (request.url === "/__ready") {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ready: false, code: "RUNTIME_EXITED" }));
      return;
    }
    try {
      const probe = await fetch(`http://127.0.0.1:${runtimePort}/`, { signal: AbortSignal.timeout(1200) });
      await probe.body?.cancel();
      if ([401, 404, 426, 200].includes(probe.status)) {
        phase = "ready";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ready: true }));
        return;
      }
    } catch {}
    phase = "waiting-runtime";
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ready: false, code: "RUNTIME_NOT_READY" }));
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(Number(process.env.PORT || 8788), "0.0.0.0", () => {
  child = spawn("node", [runtimeEntry], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.on("error", (error) => { phase = "spawn-error"; lastError = safeLine(error.message); });
  child.on("exit", (code, signal) => { exitCode = code; exitSignal = signal; phase = "runtime-exited"; });
});

import type { WorkspaceRuntime } from "../workspace_supervisor.js";
import { request as httpRequest } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function callSnapshotUserData(runtime: WorkspaceRuntime): Promise<{ backupPath: string; apps: Array<{ coreAppId: number; name: string; relPath: string }> }> {
  const result = await callRuntime(runtime, "/internal/publish/snapshot-user-data", {}) as { backupPath: string; apps: Array<{ coreAppId: number; name: string; relPath: string }> };
  if (!runtime.signGatewayRequest) return result;
  const relative = result.backupPath.replaceAll("\\", "/").replace(/^\/workspace\//, "");
  if (!relative.startsWith("tmp/") || relative.split("/").includes("..")) throw Object.assign(new Error("Workspace snapshot returned an unsafe remote path."), { code: "PUBLISH_RPC_FAILED" });
  const gatewayBase = runtime.baseUrl.replace(/\/runtime$/, "");
  const route = `/v1/workspaces/${runtime.workspaceKey}/files`;
  const response = await fetch(`${gatewayBase}${route}`, {
    method: "POST",
    headers: { ...runtime.signGatewayRequest("POST", route), "content-type": "application/json" },
    body: JSON.stringify({ paths: [relative] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Object.assign(new Error("Workspace snapshot download failed."), { code: "PUBLISH_RPC_FAILED" });
  const files = await response.json() as Array<{ path: string; base64: string }>;
  if (files.length !== 1 || files[0].path !== relative || typeof files[0].base64 !== "string") throw Object.assign(new Error("Workspace snapshot download returned invalid data."), { code: "PUBLISH_RPC_FAILED" });
  const localRoot = path.resolve(process.env.WORKSPACE_ROOT || path.join(os.tmpdir(), "seltra-workspaces"), "ws", runtime.workspaceKey, "tmp");
  await fs.mkdir(localRoot, { recursive: true });
  const localPath = path.join(localRoot, path.basename(relative));
  await fs.writeFile(localPath, Buffer.from(files[0].base64, "base64"));
  return { ...result, backupPath: localPath };
}

export async function callCommitWorkingTree(runtime: WorkspaceRuntime, input: { appId: number; author: { name: string; email: string }; turnId?: string; state: "complete" | "interrupted"; allowEmpty?: boolean }): Promise<{ appId: number; relPath: string; sha: string; changed: boolean }> {
  return callRuntime(runtime, "/internal/publish/commit-working-tree", input);
}

async function callRuntime<T>(runtime: WorkspaceRuntime, endpoint: string, body: unknown): Promise<T> {
  const url = new URL(runtime.baseUrl + endpoint);
  const payload = Buffer.from(JSON.stringify(body));
  if (runtime.signGatewayRequest) {
    if (url.protocol !== "https:") throw Object.assign(new Error("Cloudflare workspace RPC endpoint must use HTTPS."), { code: "PUBLISH_RPC_FAILED" });
    const requestPath = url.pathname + url.search;
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${runtime.rpcSecret}`, "content-type": "application/json", ...runtime.signGatewayRequest("POST", requestPath) }, body: payload, signal: AbortSignal.timeout(120_000) });
    const text = await response.text();
    if (text.length > 1024 * 1024) throw Object.assign(new Error("Workspace RPC response exceeded its size limit."), { code: "PUBLISH_RPC_FAILED" });
    const parsed = JSON.parse(text) as { ok?: boolean; result?: T; error?: { code?: string } };
    if (!response.ok || !parsed?.ok) throw Object.assign(new Error("Workspace durability RPC failed."), { code: parsed?.error?.code || "PUBLISH_RPC_FAILED" });
    return parsed.result as T;
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw Object.assign(new Error("Workspace RPC endpoint is not loopback."), { code: "PUBLISH_RPC_FAILED" });
  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(url, {
      method: "POST",
      headers: { authorization: `Bearer ${runtime.rpcSecret}`, "content-type": "application/json", "content-length": payload.length },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 1024 * 1024) { request.destroy(new Error("Workspace RPC response exceeded its size limit.")); return; } chunks.push(chunk); });
      response.on("end", () => resolve({ status: response.statusCode || 500, body: Buffer.concat(chunks).toString("utf8") }));
    });
    const timeout = setTimeout(() => request.destroy(new Error("Workspace RPC timed out.")), 120_000);
    timeout.unref();
    request.on("close", () => clearTimeout(timeout));
    request.on("error", reject);
    request.end(payload);
  });
  const parsed = JSON.parse(result.body) as { ok?: boolean; result?: T; error?: { code?: string } };
  if (result.status < 200 || result.status >= 300 || !parsed?.ok) throw Object.assign(new Error("Workspace durability RPC failed."), { code: parsed?.error?.code || "PUBLISH_RPC_FAILED" });
  return parsed.result as T;
}

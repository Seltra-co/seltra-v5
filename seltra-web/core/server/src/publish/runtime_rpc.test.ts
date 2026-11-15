import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRuntime } from "../workspace_supervisor.js";
import { callSnapshotUserData } from "./runtime_rpc.js";

describe("callSnapshotUserData", () => {
  it("downloads the remote backup from the gateway origin", async () => {
    const workspaceKey = "a".repeat(12);
    const workspacesRoot = await mkdtemp(path.join(os.tmpdir(), "seltra-runtime-rpc-test-"));
    const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = workspacesRoot;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/internal/publish/snapshot-user-data")) {
        return Response.json({
          ok: true,
          result: { backupPath: "/workspace/tmp/snapshot.sqlite", apps: [] },
        });
      }
      if (url === `https://gateway.example/v1/workspaces/${workspaceKey}/files`) {
        return Response.json([{
          path: "tmp/snapshot.sqlite",
          base64: Buffer.from("sqlite-backup").toString("base64"),
        }]);
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch);

    const runtime: WorkspaceRuntime = {
      workspaceId: "tenant-1",
      workspaceKey,
      storeSlug: "store-1",
      userId: "user-1",
      baseUrl: `https://gateway.example/v1/workspaces/${workspaceKey}/runtime`,
      rpcSecret: "rpc-secret",
      runtimeSecretsKey: "secrets-key",
      modelToken: "model-token",
      child: {} as ChildProcess,
      executionName: "test-workspace",
      touchedAt: Date.now(),
      signGatewayRequest: () => ({ "x-sandbox-signature": "signed" }),
    };

    try {
      const result = await callSnapshotUserData(runtime);

      expect(requests.map(({ url }) => url)).toEqual([
        `https://gateway.example/v1/workspaces/${workspaceKey}/runtime/internal/publish/snapshot-user-data`,
        `https://gateway.example/v1/workspaces/${workspaceKey}/files`,
      ]);
      expect(requests[1].init?.body).toBe(JSON.stringify({ paths: ["tmp/snapshot.sqlite"] }));
      await expect(readFile(result.backupPath, "utf8")).resolves.toBe("sqlite-backup");
    } finally {
      vi.unstubAllGlobals();
      if (originalWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
      await rm(workspacesRoot, { recursive: true, force: true });
    }
  });
});

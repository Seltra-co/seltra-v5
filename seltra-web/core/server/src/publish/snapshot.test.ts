import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedPublishConfig } from "../config.js";
import type { WorkspaceRuntime } from "../workspace_supervisor.js";
import { GithubPublisher } from "./github.js";
import { R2ObjectStore } from "./r2.js";
import { WorkspaceDurability } from "./snapshot.js";

describe("WorkspaceDurability", () => {
  it("journals persistence before sync verification and records sync failure", async () => {
    const config: ResolvedPublishConfig = {
      enabled: false,
      persistenceEnabled: true,
      restoreEnabled: true,
      deployMode: "team",
      githubPrivateKeyValid: false,
      vercelDeployTimeoutMinutes: 15,
      publishMaxConcurrent: 1,
      r2Endpoint: "https://r2.example.test",
      r2AccountId: "account",
      r2AccessKeyId: "key",
      r2SecretAccessKey: "secret",
      workspacesBucket: "workspaces",
      masterKey: Buffer.alloc(32),
      rootDomain: "seltra.co",
      protectedSlugs: new Set(),
      repoPrefix: "app-",
      snapshotIdleSeconds: 300,
      snapshotIntervalMinutes: 10,
      shutdownPersistSeconds: 25,
      configurationErrors: [],
    };
    const requests: Array<{ route: string; payload: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const route = String(input);
      requests.push({
        route,
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Response.json({
        status: route.endsWith("/begin") ? "PERSISTING" : "DEGRADED",
      });
    };
    const syncAndVerify = vi.fn(async () => {
      expect(requests).toHaveLength(1);
      expect(requests[0].route).toContain("/workspace-persistence/begin");
      return { filesCount: 0, verified: false };
    });
    const runtime: WorkspaceRuntime = {
      workspaceId: "tenant-1",
      workspaceKey: "workspace-1",
      storeSlug: "store-1",
      userId: "user-1",
      baseUrl: "http://127.0.0.1:8081",
      rpcSecret: "rpc-secret",
      runtimeSecretsKey: "secrets-key",
      modelToken: "model-token",
      child: {} as ChildProcess,
      executionName: "test-workspace",
      touchedAt: Date.now(),
      syncAndVerify,
    };
    const durability = new WorkspaceDurability(
      config,
      new R2ObjectStore({
        endpoint: "https://r2.example.test",
        accountId: "account",
        accessKeyId: "key",
        secretAccessKey: "secret",
      }),
      new GithubPublisher({
        org: "seltra-test",
        appId: "1",
        installationId: "1",
        privateKeyPem: "unused",
        repoPrefix: "app-",
      }),
      "http://backend.test",
      "service-secret",
      fetcher,
    );

    try {
      await expect(
        durability.persist(runtime, "manual", "turn-1"),
      ).rejects.toMatchObject({ code: "SOURCE_NOT_SAVED" });
      expect(syncAndVerify).toHaveBeenCalledOnce();
      expect(requests.map(({ route }) => route.split("/").pop())).toEqual([
        "begin",
        "transition",
      ]);
      expect(requests[1].payload).toMatchObject({
        status: "DEGRADED",
        errorCode: "WORKSPACE_SYNC_UNVERIFIED",
      });
    } finally {
      durability.close();
    }
  });
});

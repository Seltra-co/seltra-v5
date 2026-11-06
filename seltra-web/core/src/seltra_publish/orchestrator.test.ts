import { describe, expect, it, vi } from "vitest";
import { PublishOrchestrator } from "../../server/src/publish/orchestrator";

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }

describe("publish queue recovery", () => {
  it("resumes an expired ACTIVATING deployment after Core restart without regressing status", async () => {
    const job = {
      id: "dep_12345678", slug: "shop", kind: "ROLLBACK", status: "ACTIVATING", lastEventSeq: 5, attemptCount: 2,
      rollbackSourceId: "dep_old", leaseToken: "lease-new",
      rollbackTarget: { id: "dep_old", vercelOrigin: "shop-old.vercel.app", vercelDeploymentId: "dpl_12345678" },
      tenantApp: { coreAppId: 7, tenant: { id: "tenant-1", ownerId: "user-1", coreWorkspaceKey: "workspace-1", slug: "shop", owner: { email: "owner@example.test", plan: "free" } } },
    };
    let claimed = false;
    let complete!: () => void;
    const finished = new Promise<void>((resolve) => { complete = resolve; });
    const progress: Array<{ status: string; seq: number; workerId: string; leaseToken: string }> = [];
    const routes = new Map<string, Buffer>();
    const previousRoute = { slug: "shop", tenantId: "tenant-1", appId: "app-1", origin: "shop-previous.vercel.app", deploymentId: "dep_previous", vercelDeploymentId: "dpl_previous1", sha: "b".repeat(40), updatedAt: new Date().toISOString() };
    const alreadyActivatedRoute = { ...previousRoute, origin: "shop-old.vercel.app", deploymentId: job.id, vercelDeploymentId: "dpl_12345678" };
    routes.set("routes/shop.json", Buffer.from(JSON.stringify(alreadyActivatedRoute)));
    routes.set("routes/shop.prev.json", Buffer.from(JSON.stringify(previousRoute)));
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/publish/queue/claim")) {
        if (claimed) return json({ job: null });
        claimed = true;
        return json({ job });
      }
      if (url.pathname.endsWith("/publish/queue/renew")) return json({ renewed: true });
      if (url.pathname.endsWith("/publish/reconciliation/projects")) return json([]);
      if (url.pathname.endsWith("/publish/progress")) {
        const body = JSON.parse(String(init?.body));
        progress.push(body);
        return json({ ignored: false });
      }
      if (url.pathname.endsWith("/publish/repository-info")) return json({ tenantAppId: "app-1", tenantId: "tenant-1", coreAppId: 7, name: "Shop", slug: "shop" });
      if (url.pathname.endsWith("/publish/finish")) { complete(); return json({ outcome: "LIVE" }); }
      if (url.hostname === "shop-old.vercel.app") return new Response("<!doctype html>" + "x".repeat(256), { headers: { "content-type": "text/html" } });
      if (url.hostname === "shop.seltra.co") return new Response("live", { headers: { "x-seltra-deployment": job.id } });
      return json({});
    };
    const store = {
      async get(_bucket: string, key: string) { const value = routes.get(key); if (!value) throw new Error("missing"); return value; },
      async put(_bucket: string, key: string, value: Buffer) { routes.set(key, value); },
      async delete(_bucket: string, key: string) { routes.delete(key); },
    };
    const vercel = { async getDeployment() { return { id: "dpl_12345678", url: "shop-old.vercel.app", readyState: "READY", gitSource: { sha: "a".repeat(40) } }; }, async listProjectDeployments() { return []; } };
    const config = { enabled: true, persistenceEnabled: true, publishMaxConcurrent: 2, rootDomain: "seltra.co", routesBucket: "routes", vercelDeployTimeoutMinutes: 20 } as any;
    const orchestrator = new PublishOrchestrator(config, store as any, undefined, vercel as any, {} as any, "https://backend.invalid", "service-secret-test", fetcher);
    orchestrator.startQueueWorker(async () => { throw new Error("rollback recovery must not require a workspace runtime"); });
    try {
      await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error("queue recovery timed out")), 3_000))]);
    } finally { orchestrator.stopQueueWorker(); }
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((event) => event.status === "ACTIVATING")).toBe(true);
    expect(progress.every((event) => event.workerId && event.leaseToken === "lease-new")).toBe(true);
    expect(JSON.parse(routes.get("routes/shop.json")!.toString("utf8"))).toMatchObject({ deploymentId: job.id, vercelDeploymentId: "dpl_12345678" });
    expect(JSON.parse(routes.get("routes/shop.prev.json")!.toString("utf8"))).toMatchObject({ deploymentId: "dep_previous", vercelDeploymentId: "dpl_previous1" });
  });

  it("records and cancels an unexpected in-progress deployment without touching the live route", async () => {
    let recordStatus = "";
    let complete!: () => void;
    const finished = new Promise<void>((resolve) => { complete = resolve; });
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/publish/queue/claim")) return json({ job: null });
      if (url.pathname.endsWith("/publish/reconciliation/projects")) return json([{ projectId: "prj_1", slug: "shop", knownDeploymentIds: [] }]);
      if (url.pathname.endsWith("/publish/reconciliation/unexpected")) {
        const body = JSON.parse(String(init?.body));
        recordStatus = body.reconciliationStatus;
        if (recordStatus === "CANCELED") complete();
        return json({ firstSeen: recordStatus === "DETECTED", reconciliationStatus: recordStatus });
      }
      return json({});
    };
    const store = { async get() { throw new Error("no published route"); }, async put() {}, async delete() {} };
    const vercel = {
      async listProjectDeployments() { return [{ id: "dpl_unexpected", url: null, readyState: "BUILDING", target: "production", meta: {} }]; },
      async cancelDeployment() { return { id: "dpl_unexpected", url: null, readyState: "CANCELED" }; },
      async getDeployment() { throw new Error("should not need a follow-up lookup after successful cancel"); },
    };
    const config = { enabled: true, persistenceEnabled: true, publishMaxConcurrent: 2, rootDomain: "seltra.co", routesBucket: "routes" } as any;
    const orchestrator = new PublishOrchestrator(config, store as any, undefined, vercel as any, {} as any, "https://backend.invalid", "service-secret-test", fetcher);
    orchestrator.startQueueWorker(async () => { throw new Error("no publish jobs expected"); });
    try { await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error("reconciliation timed out")), 3_000))]); }
    finally { orchestrator.stopQueueWorker(); }
    expect(recordStatus).toBe("CANCELED");
  });
});

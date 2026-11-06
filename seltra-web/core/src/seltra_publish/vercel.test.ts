import { describe, expect, it, vi } from "vitest";
import { VercelPublisher } from "../../server/src/publish/vercel";

const sha = "a".repeat(40);
function response(body: unknown, status = 200, headers?: HeadersInit) { return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }); }
function publisher(fetcher: typeof fetch, sleep: (ms: number) => Promise<void> = vi.fn(async () => undefined)) { return new VercelPublisher({ vercelToken: "synthetic-vercel-token", vercelTeamId: "team_test" }, fetcher, sleep); }

describe("Vercel publishing provider", () => {
  it("creates a private-source project once and reuses the existing matching project", async () => {
    const requests: Array<{ url: string; method: string; body?: any }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); requests.push({ url, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/v9/projects/")) return requests.filter((request) => request.method === "GET").length === 1 ? response(undefined, 404) : response({ id: "prj_123", name: "app-tenantapp", link: { type: "github", repoId: "12345" }, framework: "vite" });
      return response({ id: "prj_123", name: "app-tenantapp", link: { type: "github", repoId: "12345" }, framework: "vite" }, 200);
    };
    const client = publisher(fetcher);
    const input = { tenantAppId: "tenantapp", repoFullName: "Seltra-Cloud/app-tenantapp", repoId: "12345" };
    const project = await client.ensureProject(input);
    const reused = await client.ensureProject(input);
    expect(project.id).toBe("prj_123");
    expect(reused.id).toBe(project.id);
    expect(requests[1].body).toMatchObject({ name: "app-tenantapp", gitRepository: { repo: "Seltra-Cloud/app-tenantapp", type: "github" } });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(requests[0].url).toContain("teamId=team_test");
  });

  it("synchronizes only production public build variables", async () => {
    const requests: Array<{ method: string; url: string; body?: any }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return requests.at(-1)!.method === "GET" ? response({ envs: [] }) : response({ created: true }, 200);
    };
    await publisher(fetcher).setPublicEnvironment("prj_123", { apiUrl: "https://api.example.test/api/v5", storeSlug: "shop" });
    expect(requests[1].body).toEqual([{ key: "VITE_SELTRA_API_URL", value: "https://api.example.test/api/v5", type: "plain", target: ["production"] }]);
    expect(requests[2].body).toEqual([{ key: "VITE_SELTRA_STORE_SLUG", value: "shop", type: "plain", target: ["production"] }]);
    await expect(publisher(fetcher).setPublicEnvironment("prj_123", { apiUrl: "http://localhost", storeSlug: "shop" })).rejects.toMatchObject({ code: "VERCEL_ENV_INVALID" });
  });

  it("pins deployment to the exact private GitHub SHA and records Seltra metadata", async () => {
    const requests: Array<{ url: string; method: string; body?: any }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); requests.push({ url, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/v6/deployments")) return response({ deployments: [] });
      return response({ id: "dpl_12345678", url: "app-tenantapp.vercel.app", readyState: "INITIALIZING", gitSource: { sha }, meta: { seltraSourceSha: sha } });
    };
    const result = await publisher(fetcher).createDeployment({ project: { id: "prj_1", name: "app-tenantapp" }, repoId: "12345", sourceSha: sha, seltraDeploymentId: "dep_123456", tenantAppId: "tenantapp" });
    expect(result.id).toBe("dpl_12345678");
    expect(requests[1].body).toMatchObject({ project: "prj_1", target: "production", gitSource: { type: "github", repoId: "12345", ref: "main", sha }, meta: { seltraDeploymentId: "dep_123456", seltraSourceSha: sha } });
  });

  it("rejects mismatched or missing source SHA", async () => {
    const fetcher: typeof fetch = async (input) => String(input).includes("/v6/deployments") ? response({ deployments: [] }) : response({ id: "dpl_12345678", url: "app.vercel.app", readyState: "INITIALIZING", gitSource: { sha: "b".repeat(40) } });
    await expect(publisher(fetcher).createDeployment({ project: { id: "prj", name: "app" }, repoId: "123", sourceSha: sha, seltraDeploymentId: "dep_123456", tenantAppId: "ta" })).rejects.toMatchObject({ code: "SHA_MISMATCH" });
  });

  it("fails closed when an existing project is not linked to the expected repository", async () => {
    const fetcher: typeof fetch = async () => response({ id: "prj_123", name: "app-tenantapp", framework: "vite" });
    await expect(publisher(fetcher).ensureProject({ tenantAppId: "tenantapp", repoFullName: "Seltra-Cloud/app-tenantapp", repoId: "12345" })).rejects.toMatchObject({ code: "VERCEL_PROJECT_REPOSITORY_MISMATCH" });
  });

  it("lists production deployments, including not-yet-assigned URLs for reconciliation", async () => {
    let requested = "";
    const fetcher: typeof fetch = async (input) => { requested = String(input); return response({ deployments: [{ id: "dpl_12345678", url: null, readyState: "BUILDING", target: "production", meta: {} }] }); };
    const rows = await publisher(fetcher).listProjectDeployments("prj_123", 100);
    expect(requested).toContain("/v7/deployments?");
    expect(requested).toContain("target=production");
    expect(rows).toMatchObject([{ id: "dpl_12345678", url: null, readyState: "BUILDING", target: "production" }]);
  });

  it("cancels an in-progress unexpected production deployment by ID", async () => {
    let request: { url: string; method: string } | undefined;
    const fetcher: typeof fetch = async (input, init) => { request = { url: String(input), method: init?.method || "GET" }; return response({ id: "dpl_12345678", url: "app.vercel.app", readyState: "CANCELED" }); };
    const result = await publisher(fetcher).cancelDeployment("dpl_12345678");
    expect(request?.url).toContain("/v12/deployments/dpl_12345678/cancel");
    expect(request?.method).toBe("PATCH");
    expect(result.readyState).toBe("CANCELED");
  });

  it("retries 429 using Retry-After and maps a ready deployment only at its pinned SHA", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fetcher: typeof fetch = async () => ++calls === 1 ? response({ error: "rate limited" }, 429, { "retry-after": "2" }) : response({ id: "dpl_12345678", url: "app.vercel.app", readyState: "READY", gitSource: { sha } });
    const client = publisher(fetcher, async (ms) => { delays.push(ms); });
    await expect(client.waitUntilReady("dpl_12345678", sha, 1000)).resolves.toMatchObject({ readyState: "READY" });
    expect(delays).toContain(2000);
  });

  it("redacts secret-looking build log text", async () => {
    const fetcher: typeof fetch = async () => response([{ text: "Build failed token=synthetic-secret Bearer ghp_abcdefghijklmnopqrstuvwxyz123456" }]);
    await expect(publisher(fetcher).getBuildLogTail("dpl_12345678")).resolves.not.toContain("synthetic-secret");
  });
});

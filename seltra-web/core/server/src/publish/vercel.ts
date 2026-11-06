import type { ResolvedPublishConfig } from "../config.js";

export type VercelProject = { id: string; name: string; link?: { type?: string; repoId?: string | number }; framework?: string | null };
export type VercelDeployment = { id: string; url: string | null; readyState: string; target?: string | null; readyStateReason?: string; errorCode?: string; errorMessage?: string; gitSource?: { sha?: string }; meta?: Record<string, string> };
export type VercelPublicEnv = { apiUrl: string; storeSlug: string };

const VERCEL_API = "https://api.vercel.com";
const PUBLIC_ENV_NAMES = new Set(["VITE_SELTRA_API_URL", "VITE_SELTRA_STORE_SLUG"]);

export class VercelPublisher {
  constructor(private readonly config: Pick<ResolvedPublishConfig, "vercelToken" | "vercelTeamId">, private readonly fetcher: typeof fetch = fetch, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  async ensureProject(input: { tenantAppId: string; repoFullName: string; repoId: string }): Promise<VercelProject> {
    const name = projectName(input.tenantAppId);
    let response = await this.request(`/v9/projects/${encodeURIComponent(name)}`, { allowNotFound: true });
    if (response === null) {
      try {
        response = await this.request("/v11/projects", { method: "POST", body: {
          name, framework: "vite", gitRepository: { repo: input.repoFullName, type: "github" },
        } });
      } catch (error) {
        if (!(error instanceof VercelApiError) || error.status !== 409) throw error;
        response = await this.request(`/v9/projects/${encodeURIComponent(name)}`);
      }
    }
    const project = parseProject(response);
    if (project.name !== name) throw vercelError("VERCEL_PROJECT_MISMATCH", "Vercel returned a project with an unexpected name.");
    const linkedRepoId = project.link?.repoId;
    if (linkedRepoId === undefined || String(linkedRepoId) !== String(input.repoId)) throw vercelError("VERCEL_PROJECT_REPOSITORY_MISMATCH", "The Vercel project is not linked to the expected source repository.");
    return project;
  }

  async setPublicEnvironment(projectId: string, env: VercelPublicEnv): Promise<void> {
    const values: Record<string, string> = { VITE_SELTRA_API_URL: env.apiUrl, VITE_SELTRA_STORE_SLUG: env.storeSlug };
    for (const name of Object.keys(values)) if (!PUBLIC_ENV_NAMES.has(name)) throw vercelError("VERCEL_ENV_FORBIDDEN", "Only approved public build variables may be configured.");
    if (!/^https:\/\//i.test(env.apiUrl) || env.apiUrl.includes("\n") || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(env.storeSlug)) throw vercelError("VERCEL_ENV_INVALID", "Public application build configuration is invalid.");
    const listed = await this.request(`/v10/projects/${encodeURIComponent(projectId)}/env`);
    const rows = Array.isArray((listed as { envs?: unknown }).envs) ? (listed as { envs: Array<Record<string, unknown>> }).envs : [];
    for (const [key, value] of Object.entries(values)) {
      const matches = rows.filter((row) => row.key === key && Array.isArray(row.target) && row.target.includes("production"));
      const payload = { key, value, type: "plain", target: ["production"] };
      if (!matches.length) await this.request(`/v10/projects/${encodeURIComponent(projectId)}/env`, { method: "POST", body: [payload] });
      else {
        const [first, ...duplicates] = matches;
        if (typeof first.id !== "string") throw vercelError("VERCEL_ENV_INVALID", "Vercel returned an environment variable without an id.");
        await this.request(`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(first.id)}`, { method: "PATCH", body: payload });
        for (const duplicate of duplicates) if (typeof duplicate.id === "string") await this.request(`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(duplicate.id)}`, { method: "DELETE" });
      }
    }
  }

  async findDeploymentBySeltraId(projectId: string, seltraDeploymentId: string): Promise<VercelDeployment | undefined> {
    const result = await this.request(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=100`);
    const rows = Array.isArray((result as { deployments?: unknown }).deployments) ? (result as { deployments: Array<Record<string, unknown>> }).deployments : [];
    const found = rows.find((row) => row.meta && typeof row.meta === "object" && (row.meta as Record<string, unknown>).seltraDeploymentId === seltraDeploymentId);
    return found ? parseDeployment(found) : undefined;
  }

  async listProjectDeployments(projectId: string, limit = 100): Promise<VercelDeployment[]> {
    const query = new URLSearchParams({ projectId, limit: String(Math.min(100, Math.max(1, limit))), target: "production" });
    const result = await this.request(`/v7/deployments?${query}`);
    const rows = Array.isArray((result as { deployments?: unknown }).deployments) ? (result as { deployments: unknown[] }).deployments : [];
    return rows.map(parseDeployment);
  }

  async cancelDeployment(deploymentId: string): Promise<VercelDeployment> {
    const value = await this.request(`/v12/deployments/${encodeURIComponent(deploymentId)}/cancel`, { method: "PATCH" });
    return parseDeployment(value);
  }

  async createDeployment(input: { project: VercelProject; repoId: string; sourceSha: string; seltraDeploymentId: string; tenantAppId: string }): Promise<VercelDeployment> {
    if (!/^\d+$/.test(input.repoId) || !/^[a-f0-9]{40,64}$/i.test(input.sourceSha)) throw vercelError("SHA_MISMATCH", "The saved GitHub repository or source SHA is invalid.");
    const existing = await this.findDeploymentBySeltraId(input.project.id, input.seltraDeploymentId);
    if (existing) { assertDeploymentSha(existing, input.sourceSha); return existing; }
    const value = await this.request("/v13/deployments?forceNew=1", { method: "POST", body: {
      name: input.project.name,
      project: input.project.id,
      target: "production",
      gitSource: { type: "github", repoId: input.repoId, ref: "main", sha: input.sourceSha },
      meta: { seltraDeploymentId: input.seltraDeploymentId, seltraTenantAppId: input.tenantAppId, seltraSourceSha: input.sourceSha },
    } });
    const deployment = parseDeployment(value);
    assertDeploymentSha(deployment, input.sourceSha);
    return deployment;
  }

  async getDeployment(idOrUrl: string): Promise<VercelDeployment> {
    const value = await this.request(`/v13/deployments/${encodeURIComponent(idOrUrl)}`);
    return parseDeployment(value);
  }

  async getBuildLogTail(idOrUrl: string, limit = 100): Promise<string> {
    const query = new URLSearchParams({ direction: "backward", limit: String(Math.min(100, Math.max(1, limit))) });
    const value = await this.request(`/v3/deployments/${encodeURIComponent(idOrUrl)}/events?${query}`);
    const rows = Array.isArray(value) ? value : Array.isArray((value as { events?: unknown }).events) ? (value as { events: unknown[] }).events : [];
    return rows.map(eventText).filter(Boolean).map(redactBuildLog).join("\n").slice(-8192);
  }

  async waitUntilReady(id: string, expectedSha: string, timeoutMs: number, onLog?: (line: string) => void, signal?: AbortSignal): Promise<VercelDeployment> {
    const deadline = Date.now() + timeoutMs;
    let seenEvents = new Set<string>();
    while (Date.now() < deadline) {
      if (signal?.aborted) throw vercelError("PUBLISH_CANCELLED", "The publish operation was cancelled.");
      const deployment = await this.getDeployment(id);
      assertDeploymentSha(deployment, expectedSha);
      if (deployment.readyState === "READY") return deployment;
      if (["ERROR", "CANCELED"].includes(deployment.readyState)) {
        const tail = await this.getBuildLogTail(id).catch(() => "");
        throw Object.assign(vercelError("BUILD_FAILED", "Vercel could not build this saved application version."), { buildLogTail: tail, providerCode: deployment.errorCode });
      }
      try {
        const query = new URLSearchParams({ direction: "forward", limit: "100" });
        const eventData = await this.request(`/v3/deployments/${encodeURIComponent(id)}/events?${query}`);
        const events = Array.isArray(eventData) ? eventData : Array.isArray((eventData as { events?: unknown }).events) ? (eventData as { events: unknown[] }).events : [];
        for (const event of events) {
          const text = eventText(event);
          const key = JSON.stringify(event);
          if (text && !seenEvents.has(key)) { seenEvents.add(key); onLog?.(redactBuildLog(text)); }
        }
      } catch { /* state polling remains authoritative if the optional log stream is unavailable */ }
      await this.sleep(Math.min(5_000, Math.max(0, deadline - Date.now())));
    }
    throw vercelError("DEPLOY_TIMEOUT", "Vercel deployment exceeded its configured build timeout.");
  }

  private async request(path: string, options: { method?: string; body?: unknown; allowNotFound?: boolean } = {}): Promise<any | null> {
    if (!this.config.vercelToken) throw vercelError("CONFIG_MISSING", "Vercel publishing is not configured.");
    const url = new URL(path, VERCEL_API);
    if (this.config.vercelTeamId) url.searchParams.set("teamId", this.config.vercelTeamId);
    for (let attempt = 0; attempt < 5; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url, { method: options.method ?? "GET", headers: { authorization: `Bearer ${this.config.vercelToken}`, accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), signal: AbortSignal.timeout(20_000) });
      } catch {
        throw vercelError("VERCEL_ERROR", "Vercel could not be reached.");
      }
      if (response.status === 404 && options.allowNotFound) return null;
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 4) { await this.sleep(retryDelay(response.headers.get("retry-after"), attempt)); continue; }
      }
      if (!response.ok) throw new VercelApiError(response.status, response.status === 429 ? "VERCEL_RATE_LIMITED" : "VERCEL_ERROR", `Vercel API returned status ${response.status}.`);
      if (response.status === 204) return {};
      try { return await response.json(); } catch { throw vercelError("VERCEL_ERROR", "Vercel returned an invalid response."); }
    }
    throw vercelError("VERCEL_RATE_LIMITED", "Vercel request retry budget was exhausted.");
  }
}

export class VercelApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "VercelApiError"; } }
function projectName(tenantAppId: string): string { return `app-${tenantAppId.toLowerCase()}`.slice(0, 52); }
function parseProject(value: unknown): VercelProject {
  if (!value || typeof value !== "object") throw vercelError("VERCEL_ERROR", "Vercel returned an invalid project.");
  const row = value as Record<string, any>;
  if (typeof row.id !== "string" || typeof row.name !== "string") throw vercelError("VERCEL_ERROR", "Vercel returned an incomplete project.");
  return { id: row.id, name: row.name, ...(row.link && typeof row.link === "object" ? { link: row.link } : {}), ...(typeof row.framework === "string" || row.framework === null ? { framework: row.framework } : {}) };
}
function parseDeployment(value: unknown): VercelDeployment {
  if (!value || typeof value !== "object") throw vercelError("VERCEL_ERROR", "Vercel returned an invalid deployment.");
  const row = value as Record<string, any>;
  if (typeof row.id !== "string" || (typeof row.url !== "string" && row.url !== null) || typeof row.readyState !== "string") throw vercelError("VERCEL_ERROR", "Vercel returned an incomplete deployment.");
  return { id: row.id, url: row.url, readyState: row.readyState, ...(typeof row.target === "string" || row.target === null ? { target: row.target } : {}), ...(typeof row.readyStateReason === "string" ? { readyStateReason: row.readyStateReason } : {}), ...(typeof row.errorCode === "string" ? { errorCode: row.errorCode } : {}), ...(typeof row.errorMessage === "string" ? { errorMessage: row.errorMessage } : {}), ...(row.gitSource && typeof row.gitSource === "object" ? { gitSource: row.gitSource } : {}), ...(row.meta && typeof row.meta === "object" ? { meta: row.meta } : {}) };
}
function assertDeploymentSha(deployment: VercelDeployment, expected: string): void {
  const actual = deployment.gitSource?.sha || deployment.meta?.seltraSourceSha;
  if (!actual || actual !== expected) throw vercelError("SHA_MISMATCH", "Vercel deployment source did not match the saved GitHub revision.");
}
function eventText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, any>;
  const candidate = row.text ?? row.payload?.text ?? row.payload?.info?.text ?? row.payload?.message;
  return typeof candidate === "string" ? candidate : "";
}
function redactBuildLog(value: string): string { return value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]").replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]").replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{12,})\b/g, "[REDACTED TOKEN]").replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]"); }
function retryDelay(header: string | null, attempt: number): number { const value = header ? Number(header) : NaN; return Number.isFinite(value) && value >= 0 ? Math.min(30_000, value * 1000) : Math.min(10_000, 500 * 2 ** attempt); }
function vercelError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }

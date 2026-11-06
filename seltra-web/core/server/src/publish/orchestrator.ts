import { randomUUID } from "node:crypto";
import type { ResolvedPublishConfig } from "../config.js";
import type { WorkspaceRuntime } from "../workspace_supervisor.js";
import { WorkspaceDurability } from "./snapshot.js";
import { GithubPublisher } from "./github.js";
import { R2ObjectStore } from "./r2.js";
import { VercelPublisher, type VercelDeployment, type VercelProject } from "./vercel.js";

type Claims = { sub: string; coreWorkspaceKey: string };
type BeginResult = { deploymentId: string; reused: boolean; status?: string; finishedAt?: string | null; lastEventSeq?: number; slug: string; rootDomain: string; current?: { deploymentId: string; vercelOrigin: string } | null; rollbackTarget?: { id: string; vercelOrigin: string; vercelDeploymentId: string } };
type PublishApp = { tenantAppId: string; tenantId: string; coreAppId: number; name: string; slug: string; githubRepoId?: string | null; githubRepoFullName?: string | null; githubRepoVisibility?: string | null; githubDefaultBranch?: string; lastPushedSha?: string | null; vercelProjectId?: string | null; vercelProjectName?: string | null };
type RouteRecord = { slug: string; tenantId: string; appId: string; origin: string; deploymentId: string; vercelDeploymentId: string; sha: string; updatedAt: string };
type QueueJob = { id: string; slug: string; status: string; kind: "PUBLISH" | "ROLLBACK"; lastEventSeq: number; attemptCount: number; rollbackSourceId?: string | null; rollbackTarget?: { id: string; vercelOrigin: string; vercelDeploymentId: string }; leaseToken: string; tenantApp: { coreAppId: number; tenant: { id: string; ownerId: string; coreWorkspaceKey: string; slug: string; owner?: { email: string; plan: string } | null } } };
type QueueLease = { workerId: string; leaseToken: string };
type RuntimeIdentity = { userId: string; workspaceId: string; workspaceKey: string; storeSlug: string; email: string; plan: string };
const STATUS_RANK: Record<string, number> = { QUEUED: 0, PREPARING_WORKSPACE: 1, SAVING_SOURCE: 2, BUILDING: 3, VERIFYING: 4, ACTIVATING: 5, LIVE: 6, FAILED: 6 };

export class PublishOrchestrator {
  private sequence = new Map<string, number>();
  private currentStatus = new Map<string, string>();
  private active = new Set<string>();
  private queueTimer?: NodeJS.Timeout;
  private reconciliationTimer?: NodeJS.Timeout;
  private runtimeFactory?: (identity: RuntimeIdentity) => Promise<WorkspaceRuntime>;
  private pumping = false;
  private readonly workerId = `${process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || "core"}-${randomUUID()}`.slice(0, 128);
  private readonly routeCache = new Map<string, RouteRecord>();

  constructor(private readonly config: ResolvedPublishConfig, private readonly store: R2ObjectStore | undefined, private readonly github: GithubPublisher | undefined, private readonly vercel: VercelPublisher | undefined, private readonly durability: WorkspaceDurability, private readonly backendUrl: string, private readonly coreServiceSecret: string, private readonly fetcher: typeof fetch = fetch) {}

  async start(claims: Claims, coreAppId: number, idempotencyKey: string, runtime: WorkspaceRuntime, confirmReplaceLegacy = false): Promise<{ deploymentId: string; reused: boolean }> {
    this.assertEnabled();
    if (!Number.isSafeInteger(coreAppId) || coreAppId < 1 || !/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) throw coded("INVALID_REQUEST", "A valid app id and idempotency key are required.");
    this.assertRuntimeClaims(claims, runtime);
    if (!this.config.persistenceEnabled) throw coded("SOURCE_NOT_SAVED", "Workspace source persistence must be enabled before publishing.");
    await this.backend("publish/active-run", { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey });
    const begun = await this.backend<BeginResult>("publish/begin", { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey, coreAppId, idempotencyKey, confirmReplaceLegacy });
    if (begun.reused && begun.finishedAt) return { deploymentId: begun.deploymentId, reused: true };
    this.wakeQueue();
    return { deploymentId: begun.deploymentId, reused: begun.reused };
  }

  async rollback(claims: Claims, coreAppId: number, sourceId: string, idempotencyKey: string, runtime: WorkspaceRuntime): Promise<{ deploymentId: string; reused: boolean }> {
    this.assertEnabled();
    this.assertRuntimeClaims(claims, runtime);
    await this.backend("publish/active-run", { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey });
    const begun = await this.backend<BeginResult>("publish/begin", { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey, coreAppId, kind: "ROLLBACK", rollbackSourceId: sourceId, idempotencyKey });
    if (begun.reused && begun.finishedAt) return { deploymentId: begun.deploymentId, reused: true };
    if (!begun.rollbackTarget) throw coded("ROLLBACK_TARGET_INVALID", "The selected deployment is not eligible for rollback.");
    this.wakeQueue();
    return { deploymentId: begun.deploymentId, reused: begun.reused };
  }

  startQueueWorker(runtimeFactory: (identity: RuntimeIdentity) => Promise<WorkspaceRuntime>): void {
    if (!this.config.enabled || this.queueTimer) return;
    this.runtimeFactory = runtimeFactory;
    this.queueTimer = setInterval(() => this.wakeQueue(), 2_000);
    this.queueTimer.unref();
    this.reconciliationTimer = setInterval(() => void this.reconcileUnexpectedDeployments(), 5 * 60_000);
    this.reconciliationTimer.unref();
    this.wakeQueue();
    void this.reconcileUnexpectedDeployments();
  }

  stopQueueWorker(): void {
    if (this.queueTimer) clearInterval(this.queueTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.queueTimer = undefined;
    this.reconciliationTimer = undefined;
  }

  async unpublish(claims: Claims, coreAppId: number, idempotencyKey: string): Promise<void> {
    this.assertEnabled();
    const input = { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey, coreAppId, idempotencyKey };
    const begun = await this.backend<{ slug: string }>("publish/unpublish/begin", input);
    const key = `routes/${begun.slug}.json`;
    const priorRoute = await this.readRoute(begun.slug);
    try {
      await this.store!.delete(this.config.routesBucket!, key);
      const url = `https://${begun.slug}.${this.config.rootDomain}`;
      const deadline = Date.now() + 60_000;
      let verified = false;
      while (Date.now() < deadline) {
        try {
          const response = await this.fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
          if (!response.headers.has("x-seltra-deployment")) { verified = true; break; }
        } catch { /* retry while the deleted route propagates */ }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      if (!verified) throw coded("HOSTNAME_VERIFY_FAILED", "The public hostname still has an active Seltra deployment route.");
      await this.backend("publish/unpublish/finish", input);
      this.routeCache.delete(begun.slug);
    } catch (error) {
      await this.restoreRoute(begun.slug, priorRoute).catch(() => undefined);
      throw coded(errorCode(error), "The application could not be unpublished safely.");
    }
  }

  private wakeQueue(): void { void this.pumpQueue().catch((error) => console.error(JSON.stringify({ event: "publish_queue_poll_failed", code: errorCode(error) }))); }

  private async pumpQueue(): Promise<void> {
    if (this.pumping || !this.runtimeFactory || !this.config.enabled) return;
    this.pumping = true;
    try {
      while (true) {
        const response = await this.backend<{ job: QueueJob | null }>("publish/queue/claim", { workerId: this.workerId, leaseSeconds: 120, maxConcurrent: this.config.publishMaxConcurrent });
        const job = response.job;
        if (!job) break;
        if (this.active.has(job.id)) {
          await this.backend("publish/queue/release", { deploymentId: job.id, workerId: this.workerId, leaseToken: job.leaseToken, retryAfterSeconds: 20 }).catch(() => undefined);
          break;
        }
        this.active.add(job.id);
        void this.runClaimed(job).finally(() => { this.active.delete(job.id); this.wakeQueue(); });
      }
    } finally { this.pumping = false; }
  }

  private async runClaimed(job: QueueJob): Promise<void> {
    const tenant = job.tenantApp.tenant;
    const claims: Claims = { sub: tenant.ownerId, coreWorkspaceKey: tenant.coreWorkspaceKey };
    const begun: BeginResult = {
      deploymentId: job.id, reused: true, status: job.status, lastEventSeq: job.lastEventSeq, slug: job.slug,
      rootDomain: this.config.rootDomain,
      ...(job.rollbackTarget ? { rollbackTarget: job.rollbackTarget } : {}),
    };
    const lease: QueueLease = { workerId: this.workerId, leaseToken: job.leaseToken };
    this.sequence.set(job.id, job.lastEventSeq);
    this.currentStatus.set(job.id, job.status);
    const heartbeat = setInterval(() => {
      void this.backend<{ renewed: boolean }>("publish/queue/renew", { deploymentId: job.id, ...lease, leaseSeconds: 120 })
        .then((result) => { if (!result.renewed) console.error(JSON.stringify({ event: "publish_queue_lease_lost", deploymentId: job.id })); })
        .catch(() => console.warn(JSON.stringify({ event: "publish_queue_heartbeat_failed", deploymentId: job.id })));
    }, 30_000);
    heartbeat.unref();
    try {
      if (job.kind === "ROLLBACK") await this.activateRollback(claims, job.tenantApp.coreAppId, begun, lease);
      else {
        const runtime = await this.runtimeFactory!({ userId: tenant.ownerId, workspaceId: tenant.id, workspaceKey: tenant.coreWorkspaceKey, storeSlug: tenant.slug, email: tenant.owner?.email ?? "", plan: tenant.owner?.plan ?? "free" });
        await this.publish(claims, job.tenantApp.coreAppId, begun, runtime, lease);
      }
    } catch (error) {
      if (["WORKSPACE_CAPACITY", "WORKSPACE_RESTORING", "RESTORE_IN_PROGRESS", "WORKSPACE_RUNTIME_UNAVAILABLE", "VERCEL_BUDGET_WAIT", "VERCEL_RATE_LIMITED"].includes(errorCode(error))) {
        const requestedDelay = Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds);
        const retryAfterSeconds = Number.isSafeInteger(requestedDelay) ? Math.min(300, Math.max(5, requestedDelay)) : Math.min(300, 10 * (2 ** Math.min(5, Math.max(0, job.attemptCount - 1))));
        await this.backend("publish/queue/release", { deploymentId: job.id, ...lease, retryAfterSeconds }).catch(() => undefined);
        return;
      }
      await this.backend("publish/finish", { deploymentId: job.id, outcome: "FAILED", errorCode: errorCode(error), errorMessage: safeMessage(error), ...lease }).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      this.sequence.delete(job.id);
      this.currentStatus.delete(job.id);
    }
  }

  private async reconcileUnexpectedDeployments(): Promise<void> {
    if (!this.vercel || !this.config.enabled) return;
    try {
      const projects = await this.backend<Array<{ projectId: string; slug: string; knownDeploymentIds: string[] }>>("publish/reconciliation/projects", {});
      for (const project of projects) {
        const known = new Set(project.knownDeploymentIds);
        const deployments = await this.vercel.listProjectDeployments(project.projectId, 100);
        for (const deployment of deployments) {
          if (deployment.target !== "production" || known.has(deployment.id) || deployment.meta?.seltraDeploymentId) continue;
          const currentRoute = await this.readRoute(project.slug);
          let reconciliationStatus = currentRoute?.vercelDeploymentId === deployment.id ? "ACTIVE_ROUTE_PRESERVED" : "DETECTED";
          let recorded = await this.backend<{ firstSeen: boolean; reconciliationStatus?: string }>("publish/reconciliation/unexpected", {
            projectId: project.projectId,
            deploymentId: deployment.id,
            readyState: deployment.readyState,
            ...(deployment.url ? { url: deployment.url } : {}),
            ...(deployment.gitSource?.sha ? { sourceSha: deployment.gitSource.sha } : {}),
            reconciliationStatus,
          });
          const alreadyHandled = ["CANCELED", "ACTIVE_ROUTE_PRESERVED", "NOT_CANCELABLE"].includes(recorded.reconciliationStatus || "");
          if (currentRoute?.vercelDeploymentId === deployment.id) reconciliationStatus = "ACTIVE_ROUTE_PRESERVED";
          else if (!alreadyHandled && ["QUEUED", "INITIALIZING", "BUILDING"].includes(deployment.readyState)) {
            try {
              const canceled = await this.vercel.cancelDeployment(deployment.id);
              reconciliationStatus = canceled.readyState === "CANCELED" ? "CANCELED" : "CANCEL_REQUESTED";
            } catch {
              const current = await this.vercel.getDeployment(deployment.id).catch(() => undefined);
              reconciliationStatus = current?.readyState === "CANCELED" ? "CANCELED" : "NOT_CANCELABLE";
            }
          } else if (alreadyHandled) reconciliationStatus = recorded.reconciliationStatus!;
          if (reconciliationStatus !== (recorded.reconciliationStatus || "DETECTED")) {
            recorded = await this.backend("publish/reconciliation/unexpected", {
              projectId: project.projectId, deploymentId: deployment.id, readyState: deployment.readyState,
              ...(deployment.url ? { url: deployment.url } : {}),
              ...(deployment.gitSource?.sha ? { sourceSha: deployment.gitSource.sha } : {}), reconciliationStatus,
            });
          }
          if (recorded.firstSeen) console.error(JSON.stringify({ event: "unexpected_production_deployment", projectId: project.projectId, deploymentId: deployment.id, readyState: deployment.readyState, reconciliationStatus }));
        }
      }
    } catch (error) { console.warn(JSON.stringify({ event: "publish_reconciliation_failed", code: errorCode(error) })); }
  }

  private async publish(claims: Claims, coreAppId: number, begun: BeginResult, runtime: WorkspaceRuntime, lease: QueueLease): Promise<void> {
    let activated = false;
    let priorRoute: RouteRecord | undefined;
    try {
      await this.stage(begun.deploymentId, "PREPARING_WORKSPACE", "Preparing the workspace.", lease);
      await this.stage(begun.deploymentId, "SAVING_SOURCE", "Saving the application source to its private repository.", lease);
      await this.durability.persist(runtime, "manual", `publish:${begun.deploymentId}`);
      const app = await this.backend<PublishApp>("publish/repository-info", { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey, coreAppId });
      const repoId = app.githubRepoId;
      const repoName = app.githubRepoFullName;
      const sourceSha = app.lastPushedSha;
      if (!repoId || !repoName || app.githubRepoVisibility !== "private" || !sourceSha) throw coded("SOURCE_NOT_SAVED", "A verified private GitHub source revision is required before deployment.");
      const repo = await this.github!.ensureRepo(app.tenantAppId);
      if (repo.visibility !== "private" || repo.id !== repoId || repo.fullName.toLowerCase() !== repoName.toLowerCase()) throw coded("REPOSITORY_PRIVACY_REQUIRED", "The saved repository identity or privacy could not be verified.");
      if (!await this.github!.verifyRemoteSha(repo, sourceSha, app.githubDefaultBranch || "main")) throw coded("GITHUB_PUSH_FAILED", "The saved application revision is not present on GitHub.");

      await this.stage(begun.deploymentId, "BUILDING", "Preparing a pinned deployment.", lease);
      const project = await this.vercel!.ensureProject({ tenantAppId: app.tenantAppId, repoFullName: repo.fullName, repoId: repo.id });
      await this.backend("publish/project", { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey, coreAppId, projectId: project.id, projectName: project.name });
      await this.patch(begun.deploymentId, "BUILDING", { vercelProjectId: project.id }, lease);
      await this.vercel!.setPublicEnvironment(project.id, { apiUrl: this.config.publicApiUrl!, storeSlug: begun.slug });
      let deployment = await this.vercel!.findDeploymentBySeltraId(project.id, begun.deploymentId);
      if (!deployment) {
        const budget = await this.backend<{ allowed: boolean; retryAfterSeconds?: number }>("publish/queue/reserve-vercel", { deploymentId: begun.deploymentId, ...lease });
        if (!budget.allowed) throw Object.assign(coded("VERCEL_BUDGET_WAIT", "The deployment is queued until the Vercel request budget has room."), { retryAfterSeconds: budget.retryAfterSeconds ?? 60 });
        deployment = await this.vercel!.createDeployment({ project, repoId: repo.id, sourceSha, seltraDeploymentId: begun.deploymentId, tenantAppId: app.tenantAppId });
      }
      if (deployment.gitSource?.sha && deployment.gitSource.sha !== sourceSha) throw coded("SHA_MISMATCH", "Vercel selected a different GitHub revision than the saved source.");
      await this.patch(begun.deploymentId, "BUILDING", { vercelDeploymentId: deployment.id, vercelOrigin: normalizeVercelHost(deployment.url), sourceCommitSha: sourceSha }, lease);
      let logChain = Promise.resolve();
      deployment = await this.vercel!.waitUntilReady(deployment.id, sourceSha, this.config.vercelDeployTimeoutMinutes * 60_000, (line) => { logChain = logChain.then(() => this.log(begun.deploymentId, line, lease)); });
      await logChain;
      if (deployment.readyState !== "READY" || deployment.gitSource?.sha !== sourceSha) throw coded("SHA_MISMATCH", "The ready Vercel deployment does not match the saved GitHub revision.");

      const origin = normalizeVercelHost(deployment.url);
      await this.stage(begun.deploymentId, "VERIFYING", "Checking the immutable deployment before activation.", lease);
      await this.healthCheck(origin);
      await this.patch(begun.deploymentId, "VERIFYING", { vercelOrigin: origin, sourceCommitSha: sourceSha, healthStatus: "PASSED", healthCheckedAt: new Date().toISOString(), verifiedAt: new Date().toISOString() }, lease);
      await this.stage(begun.deploymentId, "ACTIVATING", "Activating the verified deployment route.", lease);
      await this.assertLease(begun.deploymentId, lease);
      const currentRoute = await this.readRoute(begun.slug);
      priorRoute = currentRoute?.deploymentId === begun.deploymentId ? await this.readPreviousRoute(begun.slug) : currentRoute;
      if (currentRoute?.deploymentId !== begun.deploymentId && priorRoute) await this.store!.put(this.config.routesBucket!, `routes/${begun.slug}.prev.json`, Buffer.from(JSON.stringify(priorRoute)), "application/json");
      const route: RouteRecord = { slug: begun.slug, tenantId: app.tenantId, appId: app.tenantAppId, origin, deploymentId: begun.deploymentId, vercelDeploymentId: deployment.id, sha: sourceSha, updatedAt: new Date().toISOString() };
      await this.store!.put(this.config.routesBucket!, `routes/${begun.slug}.json`, Buffer.from(JSON.stringify(route)), "application/json");
      activated = true;
      this.routeCache.set(begun.slug, route);
      await this.verifyPublicRoute(begun.slug, begun.deploymentId);
      await this.backend("publish/finish", { deploymentId: begun.deploymentId, outcome: "LIVE", ...lease });
    } catch (error) {
      if (["VERCEL_BUDGET_WAIT", "VERCEL_RATE_LIMITED"].includes(errorCode(error))) throw error;
      if (activated) await this.restoreRoute(begun.slug, priorRoute).catch(() => undefined);
      const code = errorCode(error);
      const tail = typeof (error as { buildLogTail?: unknown }).buildLogTail === "string" ? (error as { buildLogTail: string }).buildLogTail : undefined;
      await this.backend("publish/finish", { deploymentId: begun.deploymentId, outcome: "FAILED", errorCode: code, errorMessage: safeMessage(error), ...(tail ? { buildLogTail: tail } : {}), ...lease }).catch(() => undefined);
      console.error(JSON.stringify({ event: "publish_failed", deploymentId: begun.deploymentId, code }));
    }
  }

  private async activateRollback(claims: Claims, coreAppId: number, begun: BeginResult, lease: QueueLease): Promise<void> {
    let activated = false;
    let priorRoute: RouteRecord | undefined;
    try {
      const app = await this.backend<PublishApp>("publish/repository-info", { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey, coreAppId });
      const target = begun.rollbackTarget!;
      const deployment = await this.vercel!.getDeployment(target.vercelDeploymentId);
      if (deployment.readyState !== "READY") throw coded("ROLLBACK_TARGET_INVALID", "The selected deployment is no longer available.");
      const origin = normalizeVercelHost(deployment.url);
      await this.stage(begun.deploymentId, "VERIFYING", "Checking the selected saved deployment.", lease);
      await this.healthCheck(origin);
      await this.patch(begun.deploymentId, "VERIFYING", { vercelDeploymentId: deployment.id, vercelOrigin: origin, healthStatus: "PASSED", healthCheckedAt: new Date().toISOString(), verifiedAt: new Date().toISOString() }, lease);
      await this.stage(begun.deploymentId, "ACTIVATING", "Restoring the selected deployment route.", lease);
      await this.assertLease(begun.deploymentId, lease);
      const currentRoute = await this.readRoute(begun.slug);
      priorRoute = currentRoute?.deploymentId === begun.deploymentId ? await this.readPreviousRoute(begun.slug) : currentRoute;
      if (currentRoute?.deploymentId !== begun.deploymentId && priorRoute) await this.store!.put(this.config.routesBucket!, `routes/${begun.slug}.prev.json`, Buffer.from(JSON.stringify(priorRoute)), "application/json");
      const route: RouteRecord = { slug: begun.slug, tenantId: app.tenantId, appId: app.tenantAppId, origin, deploymentId: begun.deploymentId, vercelDeploymentId: deployment.id, sha: String(deployment.gitSource?.sha || ""), updatedAt: new Date().toISOString() };
      await this.store!.put(this.config.routesBucket!, `routes/${begun.slug}.json`, Buffer.from(JSON.stringify(route)), "application/json");
      activated = true;
      this.routeCache.set(begun.slug, route);
      await this.verifyPublicRoute(begun.slug, begun.deploymentId);
      await this.backend("publish/finish", { deploymentId: begun.deploymentId, outcome: "LIVE", ...lease });
    } catch (error) {
      if (activated) await this.restoreRoute(begun.slug, priorRoute).catch(() => undefined);
      await this.backend("publish/finish", { deploymentId: begun.deploymentId, outcome: "FAILED", errorCode: errorCode(error), errorMessage: safeMessage(error), ...lease }).catch(() => undefined);
    }
  }

  private async healthCheck(origin: string): Promise<void> {
    let lastCode = "HEALTHCHECK_FAILED";
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const response = await this.fetcher(`https://${origin}/`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
        const type = response.headers.get("content-type") || "";
        const body = await response.text();
        if (response.status === 200 && type.toLowerCase().includes("text/html") && Buffer.byteLength(body) >= 200 && !response.headers.has("x-vercel-error")) return;
      } catch { /* retry the immutable origin */ }
      lastCode = "HEALTHCHECK_FAILED";
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw coded(lastCode, "The immutable deployment did not pass its health check.");
  }

  private async verifyPublicRoute(slug: string, deploymentId: string): Promise<void> {
    const url = `https://${slug}.${this.config.rootDomain}/`;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const response = await this.fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
        if (response.status === 200 && response.headers.get("x-seltra-deployment") === deploymentId) return;
      } catch { /* transient route propagation */ }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw coded("HOSTNAME_VERIFY_FAILED", "The public app hostname did not confirm the new deployment.");
  }

  private async readRoute(slug: string): Promise<RouteRecord | undefined> {
    return this.readRouteObject(`routes/${slug}.json`);
  }

  private async readPreviousRoute(slug: string): Promise<RouteRecord | undefined> {
    return this.readRouteObject(`routes/${slug}.prev.json`);
  }

  private async readRouteObject(key: string): Promise<RouteRecord | undefined> {
    try { return JSON.parse((await this.store!.get(this.config.routesBucket!, key)).toString("utf8")) as RouteRecord; }
    catch { return undefined; }
  }

  private async restoreRoute(slug: string, prior?: RouteRecord): Promise<void> {
    if (prior) await this.store!.put(this.config.routesBucket!, `routes/${slug}.json`, Buffer.from(JSON.stringify(prior)), "application/json");
    else await this.store!.delete(this.config.routesBucket!, `routes/${slug}.json`);
    if (prior) this.routeCache.set(slug, prior); else this.routeCache.delete(slug);
  }

  private async stage(deploymentId: string, status: string, message: string, lease: QueueLease): Promise<void> { await this.progress(deploymentId, status, message, undefined, lease); }
  private async patch(deploymentId: string, status: string, patch: Record<string, unknown>, lease: QueueLease): Promise<void> { await this.progress(deploymentId, status, status, patch, lease); }
  private async log(deploymentId: string, line: string, lease: QueueLease): Promise<void> { await this.progress(deploymentId, "BUILDING", line.slice(0, 500), undefined, lease); }
  private async progress(deploymentId: string, requestedStatus: string, message: string, patch: Record<string, unknown> | undefined, lease: QueueLease): Promise<void> {
    const seq = (this.sequence.get(deploymentId) || 1) + 1;
    const current = this.currentStatus.get(deploymentId) || requestedStatus;
    const status = (STATUS_RANK[requestedStatus] ?? 0) < (STATUS_RANK[current] ?? 0) ? current : requestedStatus;
    await this.backend("publish/progress", { deploymentId, seq, status, message, ...(patch ? { patch } : {}), ...lease });
    this.sequence.set(deploymentId, seq);
    this.currentStatus.set(deploymentId, status);
  }
  private async assertLease(deploymentId: string, lease: QueueLease): Promise<void> {
    const result = await this.backend<{ renewed: boolean }>("publish/queue/renew", { deploymentId, ...lease, leaseSeconds: 120 });
    if (!result.renewed) throw coded("PUBLISH_LEASE_LOST", "This worker no longer owns the publish operation.");
  }
  private assertEnabled(): void {
    if (!this.config.enabled) throw coded("PUBLISH_DISABLED", "Publishing is currently unavailable.");
    if (!this.vercel || !this.github || !this.store || !this.config.routesBucket) throw coded("CONFIG_MISSING", "Publishing providers are not configured.");
  }
  private async backend<T = unknown>(route: string, payload: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(`${this.backendUrl.replace(/\/+$/, "")}/api/v5/internal/core/${route}`, { method: "POST", headers: { "content-type": "application/json", "x-core-service-secret": this.coreServiceSecret }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw coded(typeof data.code === "string" ? data.code : "BACKEND_REJECTED", typeof data.message === "string" ? data.message : "Backend rejected the publish operation.");
    return data as T;
  }
  private assertRuntimeClaims(claims: Claims, runtime: WorkspaceRuntime): void {
    if (runtime.userId !== claims.sub || runtime.workspaceKey !== claims.coreWorkspaceKey) throw coded("WORKSPACE_OWNER_MISMATCH", "The active runtime does not belong to this authenticated workspace.");
  }
}

function normalizeVercelHost(value: string | null | undefined): string {
  if (typeof value !== "string") throw coded("VERCEL_ERROR", "Vercel returned a deployment without a hostname.");
  const host = value.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(host)) throw coded("VERCEL_ERROR", "Vercel returned an invalid deployment hostname.");
  return host;
}
function errorCode(error: unknown): string { return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "INTERNAL"; }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "The publish operation failed."; }
function coded(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }

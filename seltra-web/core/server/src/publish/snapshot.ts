import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArchive, extractArchive } from "./archive.js";
import { GithubPublisher } from "./github.js";
import { R2ObjectStore } from "./r2.js";
import { callCommitWorkingTree, callSnapshotUserData } from "./runtime_rpc.js";
import type { WorkspaceRuntime } from "../workspace_supervisor.js";
import type { ResolvedPublishConfig } from "../config.js";

type BackendApp = { tenantAppId: string; tenantId: string; coreAppId: number; name: string; githubRepoId?: string | null; githubRepoFullName?: string | null };
type SnapshotApp = { coreAppId: number; relPath: string; repoFullName: string; sha: string };
type SnapshotManifest = { version: 1; snapshotVersion: string; operationId: string; createdAt: string; bundleKey: string; bundleSha256: string; wrappedRuntimeKey: { iv: string; tag: string; ciphertext: string }; apps: SnapshotApp[] };

export type SavepointReason = "turn_end" | "periodic" | "idle" | "shutdown" | "manual";

export class WorkspaceDurability {
  private readonly retries = new Map<string, NodeJS.Timeout>();
  private readonly failures = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly lastPersistAt = new Map<string, number>();
  constructor(
    private readonly config: ResolvedPublishConfig,
    private readonly store: R2ObjectStore | undefined,
    private readonly github: GithubPublisher | undefined,
    private readonly backendUrl: string,
    private readonly coreServiceSecret: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly workspaceRoot = process.env.WORKSPACE_ROOT || path.join(os.tmpdir(), "seltra-workspaces"),
  ) {}

  start(listRuntimes: () => WorkspaceRuntime[]): void {
    if (!this.config.persistenceEnabled) return;
    this.timer = setInterval(() => {
      for (const runtime of listRuntimes()) {
        const idle = Date.now() - runtime.touchedAt >= this.config.snapshotIdleSeconds * 1000;
        const periodic = Date.now() - (this.lastPersistAt.get(runtime.workspaceKey) || 0) >= this.config.snapshotIntervalMinutes * 60_000;
        if (idle || periodic) void this.persist(runtime, idle ? "idle" : "periodic").catch(() => undefined);
      }
    }, 60_000);
    this.timer.unref();
  }

  async persist(runtime: WorkspaceRuntime, reason: SavepointReason, turnId = "unknown", operationId = persistenceOperationId(runtime.workspaceKey, reason, turnId)) : Promise<void> {
    if (!this.config.persistenceEnabled) return;
    const active = this.inFlight.get(runtime.workspaceKey);
    if (active) return active;
    const operation = this.persistOnce(runtime, reason, turnId, operationId);
    this.inFlight.set(runtime.workspaceKey, operation);
    try { await operation; } finally { if (this.inFlight.get(runtime.workspaceKey) === operation) this.inFlight.delete(runtime.workspaceKey); }
  }

  private async persistOnce(runtime: WorkspaceRuntime, reason: SavepointReason, turnId: string, operationId: string): Promise<void> {
    this.assertConfigured();
    let backupPath: string | undefined;
    try {
      await runtime.syncFromExecution?.();
      const journal = await this.backend<{ status: string }>("workspace-persistence/begin", { userId: runtime.userId, workspaceKey: runtime.workspaceKey, operationId, reason });
      if (journal.status === "SAFE_TO_DESTROY") return;
      const child = await callSnapshotUserData(runtime);
      backupPath = child.backupPath;
      assertWithin(path.resolve(this.workspaceRoot, "ws", runtime.workspaceKey, "tmp"), backupPath);
      const savedApps: SnapshotApp[] = [];
      for (const app of child.apps) {
        const metadata = await this.backend<BackendApp>("publish/repository-info", { userId: runtime.userId, workspaceKey: runtime.workspaceKey, coreAppId: app.coreAppId });
        const repo = await this.github!.ensureRepo(metadata.tenantAppId);
        const author = this.config.gitAuthorName && this.config.gitAuthorEmail ? { name: this.config.gitAuthorName, email: this.config.gitAuthorEmail } : undefined;
        if (!author) throw Object.assign(new Error("Publish commit identity is not configured."), { code: "CONFIG_MISSING" });
        const committed = await callCommitWorkingTree(runtime, { appId: app.coreAppId, author, turnId, state: reason === "shutdown" ? "interrupted" : "complete" });
        const appPath = path.resolve(path.join(path.resolve(this.workspaceRoot, "ws", runtime.workspaceKey, "apps"), committed.relPath));
        const savedSha = await this.github!.pushApp(appPath, repo, "main");
        if (!await this.github!.verifyRemoteSha(repo, savedSha, "main")) throw Object.assign(new Error("GitHub did not retain the pushed commit."), { code: "GITHUB_PUSH_FAILED" });
        await this.backend("publish/repository-saved", {
          userId: runtime.userId, workspaceKey: runtime.workspaceKey, coreAppId: app.coreAppId,
          githubRepoId: repo.id, githubRepoFullName: repo.fullName, githubRepoVisibility: repo.visibility, githubDefaultBranch: repo.defaultBranch,
        });
        await this.backend("github/push-result", { userId: runtime.userId, workspaceKey: runtime.workspaceKey, coreAppId: app.coreAppId, sha: savedSha, kind: reason === "shutdown" ? "INTERRUPTED" : "COMPLETE" });
        savedApps.push({ coreAppId: app.coreAppId, relPath: committed.relPath, repoFullName: repo.fullName, sha: savedSha });
      }
      if (!savedApps.length) throw Object.assign(new Error("No application source was available to persist."), { code: "SOURCE_NOT_SAVED" });
      await this.backend("workspace-persistence/transition", { userId: runtime.userId, workspaceKey: runtime.workspaceKey, operationId, status: "SOURCE_VERIFIED", githubRevisions: Object.fromEntries(savedApps.map((app) => [String(app.coreAppId), app.sha])) });
      const snapshot = await this.createSnapshot(runtime, child.backupPath, savedApps, operationId);
      await this.backend("workspace-persistence/transition", { userId: runtime.userId, workspaceKey: runtime.workspaceKey, operationId, status: "SNAPSHOT_VERIFIED", snapshotVersion: snapshot.snapshotVersion, manifestKey: snapshot.manifestKey, bundleKey: snapshot.bundleKey, bundleSha256: snapshot.bundleSha256 });
      await this.backend("workspace-persistence/transition", { userId: runtime.userId, workspaceKey: runtime.workspaceKey, operationId, status: "SAFE_TO_DESTROY" });
      this.failures.delete(runtime.workspaceKey);
      this.lastPersistAt.set(runtime.workspaceKey, Date.now());
      this.clearRetry(runtime.workspaceKey);
      console.info(JSON.stringify({ event: "workspace_persisted", reason, appCount: savedApps.length }));
    } catch (error) {
      const code = (error as { code?: string }).code || "PERSISTENCE_FAILED";
      console.error(JSON.stringify({ event: "workspace_persist_failed", code }));
      await this.backend("workspace-persistence/transition", { userId: runtime.userId, workspaceKey: runtime.workspaceKey, operationId, status: "DEGRADED", errorCode: code }).catch(() => undefined);
      await this.recordDegraded(runtime, code);
      this.scheduleRetry(runtime, reason, turnId, operationId);
      throw Object.assign(new Error("Source was not saved; the workspace is being retained."), { code: "SOURCE_NOT_SAVED" });
    } finally {
      if (backupPath) await fs.rm(backupPath, { force: true }).catch(() => undefined);
    }
  }

  async restoreBeforeStart(workspaceKey: string, workspaceRoot: string): Promise<string | undefined> {
    if (!this.config.restoreEnabled) return undefined;
    this.assertConfigured();
    assertWorkspaceKey(workspaceKey);
    if (!this.store || !this.github || !this.config.workspacesBucket) throw Object.assign(new Error("Snapshot storage is not configured."), { code: "CONFIG_MISSING" });
    const durable = await this.backend<{ status: string; operationId?: string; snapshotVersion?: string; manifestKey?: string; bundleKey?: string; bundleSha256?: string; githubRevisions?: Record<string, string> }>("workspace-persistence/latest", { workspaceKey });
    if (durable.status === "NONE") return undefined;
    if (durable.status !== "SAFE_TO_DESTROY" || !durable.manifestKey || !durable.operationId || !durable.snapshotVersion || !durable.bundleKey || !durable.bundleSha256 || !durable.githubRevisions) throw Object.assign(new Error("Neon has no complete safe workspace save."), { code: "WORKSPACE_RESTORE_FAILED" });
    if (!durable.manifestKey.startsWith(`workspaces/${workspaceKey}/snapshots/`)) throw Object.assign(new Error("The Neon workspace manifest reference is invalid."), { code: "WORKSPACE_RESTORE_FAILED" });
    let manifest: SnapshotManifest;
    try { manifest = JSON.parse((await this.store.get(this.config.workspacesBucket, durable.manifestKey)).toString("utf8")) as SnapshotManifest; }
    catch (error) { throw Object.assign(new Error("The Neon-referenced workspace manifest could not be read from R2."), { code: "WORKSPACE_RESTORE_FAILED", cause: error }); }
    if (durable.status !== "SAFE_TO_DESTROY" || manifest.version !== 1 || !manifest.operationId || !manifest.snapshotVersion || !manifest.bundleKey || !Array.isArray(manifest.apps)) throw Object.assign(new Error("Workspace snapshot manifest or Neon durability record is invalid."), { code: "WORKSPACE_RESTORE_FAILED" });
    if (manifest.operationId !== durable.operationId || manifest.snapshotVersion !== durable.snapshotVersion || manifest.bundleKey !== durable.bundleKey || manifest.bundleSha256 !== durable.bundleSha256) throw Object.assign(new Error("R2 and Neon workspace versions do not match."), { code: "WORKSPACE_RESTORE_FAILED" });
    if (manifest.apps.some((app) => durable.githubRevisions?.[String(app.coreAppId)] !== app.sha) || Object.keys(durable.githubRevisions || {}).length !== manifest.apps.length) throw Object.assign(new Error("GitHub and Neon workspace revisions do not match."), { code: "WORKSPACE_RESTORE_FAILED" });
    if (!manifest.bundleKey.startsWith(`workspaces/${workspaceKey}/snapshots/`)) throw Object.assign(new Error("Workspace snapshot references an invalid bundle key."), { code: "WORKSPACE_RESTORE_FAILED" });
    const bundle = await this.store.get(this.config.workspacesBucket, manifest.bundleKey);
    if (sha256(bundle) !== manifest.bundleSha256) throw Object.assign(new Error("Workspace snapshot integrity check failed."), { code: "WORKSPACE_RESTORE_FAILED" });
    const secretsKey = unwrapRuntimeKey(this.config.masterKey!, workspaceKey, manifest.wrappedRuntimeKey);
    const files = extractArchive(bundle);
    const parent = path.dirname(path.resolve(workspaceRoot));
    const stageRoot = path.join(parent, `.restore-${workspaceKey}-${randomBytes(6).toString("hex")}`);
    const previousRoot = path.join(parent, `.pre-restore-${workspaceKey}-${Date.now()}`);
    let previousMoved = false;
    try {
      await fs.mkdir(path.join(stageRoot, "apps"), { recursive: true });
      await fs.mkdir(path.join(stageRoot, "tmp"), { recursive: true });
      await fs.mkdir(path.join(stageRoot, "logs"), { recursive: true });
      for (const file of files) {
        const relative = safeUserDataArchivePath(file.path);
        const target = path.resolve(stageRoot, relative);
        assertWithin(stageRoot, target);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.data, { flag: "wx", mode: 0o600 });
      }
      if (!(await exists(path.join(stageRoot, "userData", "sqlite.db")))) throw Object.assign(new Error("Snapshot has no user database."), { code: "WORKSPACE_RESTORE_FAILED" });
      for (const app of manifest.apps) {
        const destination = path.resolve(stageRoot, "apps", safeRelative(app.relPath));
        assertWithin(path.join(stageRoot, "apps"), destination);
        await this.github.cloneApp(app.repoFullName, app.sha, destination);
      }
      if (await exists(workspaceRoot)) { await fs.rename(workspaceRoot, previousRoot); previousMoved = true; }
      await fs.rename(stageRoot, workspaceRoot);
      if (previousMoved) await fs.rm(previousRoot, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      if (previousMoved) try { await fs.access(previousRoot); await fs.rename(previousRoot, workspaceRoot); } catch { /* preserve the pre-restore copy in place */ }
      await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
      throw Object.assign(new Error("Workspace restore failed; the existing workspace copy was preserved."), { code: "WORKSPACE_RESTORE_FAILED", cause: error });
    }
    return secretsKey.toString("hex");
  }

  async persistAll(runtimes: WorkspaceRuntime[], reason: SavepointReason): Promise<void> {
    if (runtimes.length && !this.config.persistenceEnabled) throw Object.assign(new Error("Active workspaces cannot be safely destroyed while persistence is disabled."), { code: "SOURCE_NOT_SAVED" });
    const results = await Promise.allSettled(runtimes.map((runtime) => this.persist(runtime, reason)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw Object.assign(new Error(`${failures.length} workspace persistence operation(s) failed.`), { code: "SOURCE_NOT_SAVED" });
  }

  close(): void { if (this.timer) clearInterval(this.timer); for (const key of this.retries.keys()) this.clearRetry(key); }

  private async createSnapshot(runtime: WorkspaceRuntime, backupPath: string, apps: SnapshotApp[], operationId: string): Promise<{ snapshotVersion: string; manifestKey: string; bundleKey: string; bundleSha256: string }> {
    const userDataRoot = path.resolve(this.workspaceRoot, "ws", runtime.workspaceKey, "userData");
    const files: Array<{ path: string; data: Buffer }> = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(userDataRoot, absolute).replaceAll("\\", "/");
        if (["logs", "log", "cache", "caches", "GPUCache", "Code Cache", "typescript-cache"].some((name) => entry.name.toLowerCase() === name.toLowerCase())) continue;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await walk(absolute); continue; }
        if (!entry.isFile() || /^(?:sqlite\.db(?:-wal|-shm)?|runtime\.log)$/i.test(entry.name)) continue;
        const stat = await fs.stat(absolute);
        if (stat.size > 25 * 1024 * 1024) continue;
        files.push({ path: `userData/${relative}`, data: await fs.readFile(absolute) });
      }
    };
    try {
      await walk(userDataRoot);
      const backup = await fs.readFile(backupPath);
      if (backup.length > 25 * 1024 * 1024) throw Object.assign(new Error("SQLite backup exceeds the snapshot file limit."), { code: "SNAPSHOT_FILE_TOO_LARGE" });
      files.push({ path: "userData/sqlite.db", data: backup });
      const bundle = createArchive(files);
      const digest = sha256(bundle);
      const latestKey = `workspaces/${runtime.workspaceKey}/latest.json`;
      let reusableBundleKey: string | undefined;
      try {
        const previous = JSON.parse((await this.store!.get(this.config.workspacesBucket!, latestKey)).toString("utf8")) as SnapshotManifest;
        if (previous.bundleSha256 === digest && JSON.stringify(previous.apps) === JSON.stringify(apps)) reusableBundleKey = previous.bundleKey;
      } catch { /* no valid previous snapshot */ }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const bundleKey = reusableBundleKey || `workspaces/${runtime.workspaceKey}/snapshots/${stamp}-${randomBytes(4).toString("hex")}.tgz`;
      if (!reusableBundleKey) await this.store!.put(this.config.workspacesBucket!, bundleKey, bundle, "application/gzip");
      const storedBundle = await this.store!.get(this.config.workspacesBucket!, bundleKey);
      if (sha256(storedBundle) !== digest) throw Object.assign(new Error("Uploaded workspace snapshot failed checksum verification."), { code: "SNAPSHOT_CHECKSUM_MISMATCH" });
      const snapshotVersion = `${stamp}-${randomBytes(4).toString("hex")}`;
      const manifest: SnapshotManifest = {
        version: 1,
        snapshotVersion,
        operationId,
        createdAt: new Date().toISOString(),
        bundleKey,
        bundleSha256: digest,
        wrappedRuntimeKey: wrapRuntimeKey(this.config.masterKey!, runtime.workspaceKey, Buffer.from(runtime.runtimeSecretsKey, "hex")),
        apps,
      };
      const manifestKey = `workspaces/${runtime.workspaceKey}/snapshots/${snapshotVersion}.json`;
      await this.store!.put(this.config.workspacesBucket!, manifestKey, Buffer.from(JSON.stringify(manifest)), "application/json");
      const verifiedManifest = JSON.parse((await this.store!.get(this.config.workspacesBucket!, manifestKey)).toString("utf8")) as SnapshotManifest;
      if (verifiedManifest.operationId !== operationId || verifiedManifest.snapshotVersion !== snapshotVersion || verifiedManifest.bundleSha256 !== digest) throw Object.assign(new Error("Workspace snapshot manifest verification failed."), { code: "SNAPSHOT_MANIFEST_MISMATCH" });
      await this.store!.put(this.config.workspacesBucket!, latestKey, Buffer.from(JSON.stringify({ snapshotVersion, manifestKey, operationId })), "application/json");
      const latest = JSON.parse((await this.store!.get(this.config.workspacesBucket!, latestKey)).toString("utf8")) as { snapshotVersion?: string; manifestKey?: string; operationId?: string };
      if (latest.manifestKey !== manifestKey || latest.snapshotVersion !== snapshotVersion || latest.operationId !== operationId) throw Object.assign(new Error("Workspace latest pointer verification failed."), { code: "SNAPSHOT_MANIFEST_MISMATCH" });
      return { snapshotVersion, manifestKey, bundleKey, bundleSha256: digest };
    } finally {
      await fs.rm(backupPath, { force: true }).catch(() => undefined);
    }
  }

  private async backend<T = unknown>(route: string, body: unknown): Promise<T> {
    const response = await this.fetcher(`${this.backendUrl.replace(/\/+$/, "")}/api/v5/internal/core/${route}`, {
      method: "POST", headers: { "content-type": "application/json", "x-core-service-secret": this.coreServiceSecret },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw Object.assign(new Error("Backend did not accept the workspace durability update."), { code: response.status === 403 ? "BACKEND_REJECTED" : "BACKEND_UNAVAILABLE" });
    return await response.json() as T;
  }

  private async recordDegraded(runtime: WorkspaceRuntime, code: string): Promise<void> {
    const count = (this.failures.get(runtime.workspaceKey) || 0) + 1;
    this.failures.set(runtime.workspaceKey, count);
    if (count < 4) return;
    const state = await callSnapshotUserData(runtime).catch(() => null);
    const app = state?.apps[0];
    if (app) {
      await this.backend("github/push-result", { userId: runtime.userId, workspaceKey: runtime.workspaceKey, coreAppId: app.coreAppId, kind: "INTERRUPTED", error: code }).catch(() => undefined);
    }
    if (this.config.alertWebhookUrl) {
      await this.fetcher(this.config.alertWebhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Seltra workspace persistence has failed three times. Workspace ${runtime.workspaceKey}; error ${code}.` }), signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
    }
  }

  private scheduleRetry(runtime: WorkspaceRuntime, reason: SavepointReason, turnId: string, operationId: string): void {
    if (this.retries.has(runtime.workspaceKey)) return;
    const count = this.failures.get(runtime.workspaceKey) || 1;
    if (count >= 4) return;
    const delays = [1_000, 5 * 60_000, 15 * 60_000];
    const timer = setTimeout(() => {
      this.retries.delete(runtime.workspaceKey);
      void this.persist(runtime, reason, turnId, operationId).catch(() => undefined);
    }, delays[Math.min(count - 1, delays.length - 1)]);
    timer.unref();
    this.retries.set(runtime.workspaceKey, timer);
  }

  private clearRetry(workspaceKey: string): void { const timer = this.retries.get(workspaceKey); if (timer) clearTimeout(timer); this.retries.delete(workspaceKey); }
  private assertConfigured(): void {
    if (this.config.configurationErrors.length) throw Object.assign(new Error(`Workspace durability configuration is missing or invalid: ${this.config.configurationErrors.join(", ")}.`), { code: "CONFIG_MISSING" });
    if (!this.store || !this.github || !this.config.masterKey) throw Object.assign(new Error("Workspace durability configuration is incomplete."), { code: "CONFIG_MISSING" });
  }
}

function wrapRuntimeKey(masterKey: Buffer, workspaceKey: string, runtimeKey: Buffer): SnapshotManifest["wrappedRuntimeKey"] {
  if (runtimeKey.length !== 32) throw Object.assign(new Error("Runtime secrets key has an invalid length."), { code: "SNAPSHOT_KEY_INVALID" });
  const key = deriveWorkspaceKey(masterKey, workspaceKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(runtimeKey), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function unwrapRuntimeKey(masterKey: Buffer, workspaceKey: string, wrapped: SnapshotManifest["wrappedRuntimeKey"]): Buffer {
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveWorkspaceKey(masterKey, workspaceKey), Buffer.from(wrapped.iv, "base64"));
    decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, "base64")), decipher.final()]);
  } catch { throw Object.assign(new Error("Workspace snapshot could not be unlocked; verify WORKSPACE_MASTER_KEY."), { code: "WORKSPACE_RESTORE_FAILED" }); }
}

function deriveWorkspaceKey(masterKey: Buffer, workspaceKey: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, Buffer.from(workspaceKey), Buffer.from("seltra-workspace-runtime-key-v1"), 32));
}
function sha256(buffer: Buffer): string { return createHash("sha256").update(buffer).digest("hex"); }
function persistenceOperationId(workspaceKey: string, reason: SavepointReason, turnId: string): string {
  if (reason === "turn_end" || reason === "manual") return createHash("sha256").update(`${workspaceKey}:${reason}:${turnId}`).digest("hex");
  return randomUUID();
}
function assertWorkspaceKey(value: string): void { if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Workspace key is invalid."); }
function safeRelative(value: string): string { const normalized = value.replaceAll("\\", "/"); if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((part) => part === ".." || !part)) throw new Error("Snapshot app path is invalid."); return normalized; }
function safeUserDataArchivePath(value: string): string { const normalized = safeRelative(value); if (!normalized.startsWith("userData/")) throw new Error("Snapshot contains an unsupported data path."); return normalized; }
function assertWithin(root: string, target: string): void { const relative = path.relative(path.resolve(root), path.resolve(target)); if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { if (relative !== "") throw new Error("Snapshot path escaped its destination."); } }
async function exists(value: string): Promise<boolean> { try { await fs.access(value); return true; } catch { return false; } }

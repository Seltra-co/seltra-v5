import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb, getDatabasePath } from "../db";
import { apps } from "../db/schema";
import { getDyadAppPath } from "../paths/paths";
import { installPlatformFiles, validateAppForPush } from "../../server/src/publish/validator";

const run = promisify(execFile);
const IDENTITY_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WorkspaceApp = { coreAppId: number; name: string; relPath: string; githubOrg?: string | null; githubRepo?: string | null };

export async function snapshotUserData(): Promise<{ backupPath: string; apps: WorkspaceApp[] }> {
  const userData = path.resolve(process.env.DYAD_USER_DATA || "./userData");
  const tempRoot = path.resolve(process.env.DYAD_TMP_DIR || path.join(userData, "tmp"));
  await fs.mkdir(tempRoot, { recursive: true });
  const backupPath = path.join(tempRoot, `seltra-userdata-${randomUUID()}.sqlite`);
  await getDb().$client.backup(backupPath);
  const appsRoot = path.resolve(process.env.DYAD_APPS_DIR || path.join(userData, "apps"));
  const rows = await getDb().select({ id: apps.id, name: apps.name, path: apps.path, githubOrg: apps.githubOrg, githubRepo: apps.githubRepo }).from(apps);
  const savedApps: WorkspaceApp[] = [];
  for (const row of rows) {
    const absolute = getDyadAppPath(row.path);
    const relPath = path.relative(appsRoot, absolute).replaceAll("\\", "/");
    if (!relPath || relPath === ".." || relPath.startsWith("../") || path.isAbsolute(relPath)) continue;
    savedApps.push({ coreAppId: row.id, name: row.name, relPath, githubOrg: row.githubOrg, githubRepo: row.githubRepo });
  }
  return { backupPath, apps: savedApps };
}

export async function commitWorkingTree(input: { appId: number; author: { name: string; email: string }; turnId?: string; state?: "complete" | "interrupted"; allowEmpty?: boolean }): Promise<{ appId: number; relPath: string; sha: string; changed: boolean }> {
  if (!Number.isSafeInteger(input.appId) || input.appId < 1 || !input.author?.name?.trim() || !IDENTITY_EMAIL.test(input.author.email)) {
    throw Object.assign(new Error("A valid app id and publish commit identity are required."), { code: "INVALID_COMMIT_REQUEST" });
  }
  const app = await getDb().query.apps.findFirst({ where: (table, { eq }) => eq(table.id, input.appId) });
  if (!app) throw Object.assign(new Error("App not found."), { code: "APP_NOT_FOUND" });
  const appsRoot = path.resolve(process.env.DYAD_APPS_DIR || "./apps");
  const appPath = getDyadAppPath(app.path);
  const relPath = path.relative(appsRoot, appPath).replaceAll("\\", "/");
  if (!relPath || relPath === ".." || relPath.startsWith("../") || path.isAbsolute(relPath)) throw Object.assign(new Error("App path is outside the workspace apps directory."), { code: "APP_PATH_FORBIDDEN" });

  await installPlatformFiles(appPath);
  await validateAppForPush(appPath);
  const isRepository = await git(appPath, ["rev-parse", "--is-inside-work-tree"], true);
  if (!isRepository) await git(appPath, ["init", "-b", "main"]);
  await git(appPath, ["config", "user.name", input.author.name.trim()]);
  await git(appPath, ["config", "user.email", input.author.email.trim()]);
  const pending = await git(appPath, ["status", "--porcelain", "--untracked-files=all"]);
  if (pending || input.allowEmpty) {
    await git(appPath, ["add", "-A"]);
    const turn = (input.turnId || "unknown").replace(/[\r\n<>]/g, "").slice(0, 128);
    const state = input.state || "complete";
    const message = `Seltra save point\n\nSeltra-Turn: ${turn}\nSeltra-State: ${state}`;
    await git(appPath, ["commit", ...(input.allowEmpty ? ["--allow-empty"] : []), "-m", message]);
  }
  const sha = await git(appPath, ["rev-parse", "HEAD"]);
  return { appId: input.appId, relPath, sha, changed: Boolean(pending || input.allowEmpty) };
}

async function git(cwd: string, args: string[], allowFailure = false): Promise<string> {
  try { return (await run("git", ["-C", cwd, ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
  catch (error) {
    if (allowFailure) return "";
    throw Object.assign(new Error(`Git ${args[0]} failed in the workspace.`), { code: "GIT_OPERATION_FAILED", cause: error });
  }
}

export async function removeSnapshotTempFile(filename: string): Promise<void> {
  const tempRoot = path.resolve(process.env.DYAD_TMP_DIR || "./tmp");
  const resolved = path.resolve(filename);
  const relative = path.relative(tempRoot, resolved);
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) return;
  await fs.rm(resolved, { force: true });
}

export function getWorkspaceDataRoot(): string { return path.resolve(process.env.DYAD_USER_DATA || "./userData"); }

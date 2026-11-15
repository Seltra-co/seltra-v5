import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb, getDatabasePath } from "../db";
import { apps } from "../db/schema";
import { getDyadAppPath } from "../paths/paths";
import { commitWorkspaceTree } from "../../server/src/publish/source_commit";

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
  const app = await getDb().query.apps.findFirst({ where: (table, { eq }) => eq(table.id, input.appId) });
  if (!app) throw Object.assign(new Error("App not found."), { code: "APP_NOT_FOUND" });
  const appsRoot = path.resolve(process.env.DYAD_APPS_DIR || "./apps");
  const appPath = getDyadAppPath(app.path);
  return commitWorkspaceTree({
    ...input,
    appPath,
    appsRoot,
  });
}

export async function removeSnapshotTempFile(filename: string): Promise<void> {
  const tempRoot = path.resolve(process.env.DYAD_TMP_DIR || "./tmp");
  const resolved = path.resolve(filename);
  const relative = path.relative(tempRoot, resolved);
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) return;
  await fs.rm(resolved, { force: true });
}

export function getWorkspaceDataRoot(): string { return path.resolve(process.env.DYAD_USER_DATA || "./userData"); }

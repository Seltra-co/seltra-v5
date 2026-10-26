import path from "node:path";
import fs from "node:fs/promises";
import { db } from "../db";
import { apps } from "../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppsBaseDirectory } from "../paths/paths";
import { getChannelPolicy } from "./channel_policy";
import { resolveWorkspaceProjectPath } from "./workspace_path";

const APP_SCOPED_CHANNEL = /app|chat|git|terminal|tests|media|context|agent|preview|version|screenshot|image/i;

// Contract channels are supplied at runtime, so build the table from the same
// preload inventory and retain only operations that can target an app.
import {
  VALID_INVOKE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "../ipc/preload/channels";

const appChannels = new Set(
  [...new Set([
    ...(VALID_INVOKE_CHANNELS as readonly string[]),
    ...(VALID_SEND_CHANNELS as readonly string[]),
  ])].filter((channel) => {
    const classification = getChannelPolicy(channel)?.class;
    return APP_SCOPED_CHANNEL.test(channel) && classification !== undefined && classification !== "DISABLE" && classification !== "ADAPT";
  }),
);

export const APP_PATH_ARGUMENTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze(Object.fromEntries([...appChannels].map((channel) => [channel, ["appId", "appIds"]])));

async function assertAppExistsInsideRuntime(appId: number): Promise<void> {
  const app = db.select({ path: apps.path }).from(apps).where(eq(apps.id, appId)).get();
  if (!app) throw new Error("Unknown app identifier");
  const resolvedRoot = await fs.realpath(path.resolve(getDyadAppsBaseDirectory()));
  const appCandidate = path.isAbsolute(app.path)
    ? path.resolve(app.path)
    : path.resolve(resolvedRoot, app.path);
  const resolvedApp = await fs.realpath(appCandidate);
  const parent = path.relative(resolvedRoot, path.dirname(resolvedApp));
  if (parent !== "") {
    throw new Error("App is outside the workspace apps directory");
  }
  await resolveWorkspaceProjectPath(resolvedRoot, path.basename(resolvedApp), ".");
}

export class RpcPathArgumentError extends Error {
  code = "INVALID_REQUEST";
}

/** Validate every app identifier on a channel before dispatching its handler. */
export async function guardRpcPathArguments(
  channel: string,
  args: unknown[],
): Promise<void> {
  const fields = APP_PATH_ARGUMENTS[channel];
  if (!fields) return;
  const identifiers = new Set<number>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (fields.includes("appId") && typeof record.appId === "number") identifiers.add(record.appId);
    if (fields.includes("appIds") && Array.isArray(record.appIds)) {
      for (const id of record.appIds) if (typeof id === "number") identifiers.add(id);
    }
    for (const child of Object.values(record)) visit(child);
  };
  for (const arg of args) visit(arg);
  try {
    for (const id of identifiers) await assertAppExistsInsideRuntime(id);
  } catch (error) {
    throw new RpcPathArgumentError((error as Error).message);
  }
}

import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext } from "./types";

/**
 * Resolve the app path a read-only tool should target.
 *
 * - Omitted `appName` → current app (`ctx.appPath`).
 * - Provided `appName` → must match a referenced app from the current turn's
 *   `@app:Name` mentions. Any other value is rejected.
 *
 * Write tools do not call this — they operate only on `ctx.appPath` so that
 * referenced apps remain structurally unreachable for modification.
 */
export function resolveTargetAppPath(
  ctx: AgentContext,
  appName: string | undefined,
): string {
  if (!appName) {
    return ctx.appPath;
  }
  const appPath = ctx.referencedApps.get(appName.toLowerCase());
  if (appPath) {
    return appPath;
  }
  const available = [...ctx.referencedApps.keys()];
  const availableStr =
    available.length > 0 ? available.join(", ") : "(none available)";
  throw new DyadError(
    `Unknown app_name '${appName}'. Available referenced apps: ${availableStr}`,
    DyadErrorKind.NotFound,
  );
}

/**
 * Glob pattern for private app internals, for use in the node `glob` library's
 * ignore list.
 *
 * A referenced app's `.dyad/` metadata and `.seltra/` media are not part of the
 * `@app:Name` reference contract and must not be exposed to read-only tools.
 */
export const DYAD_INTERNAL_GLOBS = ["**/.dyad/**", "**/.seltra/**"];

/**
 * Negated globs for ripgrep's `--glob` flag, excluding private app directories
 * at the app root (ripgrep globs are relative to the target app path).
 */
export const DYAD_INTERNAL_RIPGREP_EXCLUDES = ["!.dyad/**", "!.seltra/**"];

/**
 * Is `relativePath` inside a private app directory at the app root?
 *
 * Accepts slashes in either direction and a leading `./`; callers should pass a
 * path already resolved relative to the app root (so traversal aliases
 * normalize correctly before being checked).
 */
export function isDyadInternalPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const firstPathSegment = normalized.split("/")[0];
  return firstPathSegment === ".dyad" || firstPathSegment === ".seltra";
}

/**
 * Strip private app directories from a file list when targeting a referenced
 * app. The current app's own internal files remain visible to the user.
 */
export function filterDyadInternalFiles<T extends { path: string }>(
  files: T[],
  appName: string | undefined,
): T[] {
  if (!appName) {
    return files;
  }
  return files.filter((file) => !isDyadInternalPath(file.path));
}

/**
 * Block Git metadata in every app and private app directories in referenced
 * apps. The relative path is computed from the resolved `fullFilePath`, so
 * normalized traversal aliases are caught.
 */
export function assertDyadInternalAccessAllowed({
  targetAppPath,
  fullFilePath,
  appName,
}: {
  targetAppPath: string;
  fullFilePath: string;
  appName: string | undefined;
}): void {
  const relativeFromApp = path.relative(targetAppPath, fullFilePath);
  // Git metadata can contain credential-bearing remotes and extra headers.
  // Apply the same rule to lexical paths and the reader's canonical-path check.
  if (
    relativeFromApp
      .replace(/\\/g, "/")
      .split("/")
      .some((part) => part.toLowerCase() === ".git")
  ) {
    throw new DyadError(
      "Cannot read Git metadata through file tools.",
      DyadErrorKind.Validation,
    );
  }
  if (!appName) {
    return;
  }
  if (isDyadInternalPath(relativeFromApp)) {
    const internalDirName = relativeFromApp
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .split("/")[0];
    throw new DyadError(
      `Cannot read ${internalDirName}/ paths from referenced apps — these files are not part of the @app reference contract.`,
      DyadErrorKind.Validation,
    );
  }
}

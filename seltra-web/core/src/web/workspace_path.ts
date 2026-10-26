import fs from "node:fs/promises";
import path from "node:path";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/** Resolve a project path, including a not-yet-created write target. */
export async function resolveWorkspaceProjectPath(
  workspaceAppsRoot: string,
  projectId: string,
  requestedPath: string,
): Promise<string> {
  if (
    !projectId ||
    projectId === "." ||
    projectId === ".." ||
    /[\\/]/.test(projectId)
  ) {
    throw new WorkspacePathError("Invalid project identifier");
  }
  const appsRoot = await fs.realpath(workspaceAppsRoot);
  const projectRoot = path.resolve(appsRoot, projectId);
  if (!isWithin(appsRoot, projectRoot) || projectRoot === appsRoot) {
    throw new WorkspacePathError(
      "Project path is outside the workspace apps directory",
    );
  }
  const realProjectRoot = await fs.realpath(projectRoot);
  if (!isWithin(appsRoot, realProjectRoot)) {
    throw new WorkspacePathError(
      "Project symlink escapes the workspace apps directory",
    );
  }
  if (
    !requestedPath ||
    path.isAbsolute(requestedPath) ||
    /^[a-zA-Z]:/.test(requestedPath) ||
    /^(?:\\\\|\/\/)/.test(requestedPath) ||
    requestedPath.split(/[\\/]+/).some((part) => part === "..")
  ) {
    throw new WorkspacePathError("Requested path must stay inside the project");
  }
  const candidate = path.resolve(realProjectRoot, requestedPath);
  if (!isWithin(realProjectRoot, candidate)) {
    throw new WorkspacePathError("Requested path is outside the project");
  }

  // Writes often target a path with several missing segments. Resolve the
  // nearest existing ancestor so symlinks in any existing segment are checked.
  let ancestor = candidate;
  const suffix: string[] = [];
  while (true) {
    try {
      ancestor = await fs.realpath(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
  if (!isWithin(realProjectRoot, ancestor)) {
    throw new WorkspacePathError(
      "Requested path resolves outside the project through a symlink",
    );
  }
  return path.join(ancestor, ...suffix);
}

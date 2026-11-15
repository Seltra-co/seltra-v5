import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { installPlatformFiles, validateAppForPush } from "./validator.js";

const run = promisify(execFile);
const IDENTITY_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function commitWorkspaceTree(input: {
  appId: number;
  appPath: string;
  appsRoot: string;
  author: { name: string; email: string };
  turnId?: string;
  state?: "complete" | "interrupted";
  allowEmpty?: boolean;
}): Promise<{ appId: number; relPath: string; sha: string; changed: boolean }> {
  if (!Number.isSafeInteger(input.appId) || input.appId < 1 || !input.author?.name?.trim() || !IDENTITY_EMAIL.test(input.author.email)) {
    throw Object.assign(new Error("A valid app id and publish commit identity are required."), { code: "INVALID_COMMIT_REQUEST" });
  }
  const appsRoot = path.resolve(input.appsRoot);
  const appPath = path.resolve(input.appPath);
  const relPath = path.relative(appsRoot, appPath).replaceAll("\\", "/");
  if (!relPath || relPath === ".." || relPath.startsWith("../") || path.isAbsolute(relPath)) {
    throw Object.assign(new Error("App path is outside the workspace apps directory."), { code: "APP_PATH_FORBIDDEN" });
  }

  await installPlatformFiles(appPath);
  await validateAppForPush(appPath);
  const readme = await renderSeltraReadme(appPath, input.turnId, input.state || "complete");
  const isRepository = await git(appPath, ["rev-parse", "--is-inside-work-tree"], true);
  if (!isRepository) await git(appPath, ["init", "-b", "main"]);
  await git(appPath, ["config", "user.name", input.author.name.trim()]);
  await git(appPath, ["config", "user.email", input.author.email.trim()]);
  const pending = await git(appPath, ["status", "--porcelain", "--untracked-files=all"]);
  if (pending || input.allowEmpty) {
    await git(appPath, ["add", "-A"]);
    const turn = (input.turnId || "unknown").replace(/[\r\n<>]/g, "").slice(0, 128);
    const state = input.state || "complete";
    await git(appPath, ["commit", ...(input.allowEmpty ? ["--allow-empty"] : []), "-m", `Seltra save point\n\nSeltra-Turn: ${turn}\nSeltra-State: ${state}`]);
  }
  const sha = await git(appPath, ["rev-parse", "HEAD"]);
  return { appId: input.appId, relPath, sha, changed: Boolean(pending || input.allowEmpty) };
}

async function renderSeltraReadme(appPath: string, turnId?: string, state: "complete" | "interrupted" = "complete"): Promise<void> {
  const packagePath = path.join(appPath, "package.json");
  let projectName = path.basename(path.resolve(appPath));
  try {
    const content = await fs.readFile(packagePath, "utf8");
    const pkg = JSON.parse(content) as { name?: string; description?: string };
    if (typeof pkg.name === "string" && pkg.name.trim()) projectName = pkg.name.trim();
  } catch {
    // Fall back to the directory name for generated apps without a package.json.
  }
  const displayName = projectName.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Seltra app";
  const title = displayName.split(" ").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
  const shortTurn = (turnId || "unknown").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || "run";
  const status = state === "interrupted" ? "degraded" : "ready";
  const readme = `# ${title}\n\nAI-generated storefront, landing page, or app experience built with **Seltra**.\n\nBuilt with **Seltra** — AI-native commerce infrastructure.\n\n## Stack\nReact + Vite + TypeScript + Tailwind CSS + shadcn/ui\n\n## Run locally\n\n\`\`\`bash\npnpm install\npnpm dev\n\`\`\`\n\n## Structure\nsrc/pages · src/components · src/lib · public/assets\n\n## Build info\nLast save point: ${new Date().toISOString()} · Run: ${shortTurn} · Status: ${status}\n`;
  await fs.writeFile(path.join(appPath, "README.md"), readme, "utf8");
}

async function git(cwd: string, args: string[], allowFailure = false): Promise<string> {
  try {
    return (await run("git", ["-C", cwd, ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  } catch (error) {
    if (allowFailure && (error as { code?: number }).code !== 0) return "";
    throw Object.assign(new Error(`Git ${args[0]} failed in the workspace.`), { code: "GIT_OPERATION_FAILED", cause: error });
  }
}

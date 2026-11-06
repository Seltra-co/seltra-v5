import fs from "node:fs/promises";
import path from "node:path";

export type PublishValidationError = Error & { code: string };

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code }) as PublishValidationError;
}

const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/\S+:\S+@/i,
  /sk_(?:live|test)_[A-Za-z0-9_-]{12,}/,
  /(?:ghp_|ghs_|github_pat_)[A-Za-z0-9_]{20,}/,
  /xox[abp]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REPO_BYTES = 100 * 1024 * 1024;
const MAX_FILE_COUNT = 20_000;
const ALLOWED_VERCEL_KEYS = new Set(["git", "headers", "redirects", "rewrites", "cleanUrls", "trailingSlash"]);

export async function installPlatformFiles(appPath: string): Promise<void> {
  const repoPath = path.resolve(appPath);
  const vercelPath = path.join(repoPath, "vercel.json");
  const tracked = await runGit(repoPath, ["ls-files", "--error-unmatch", "vercel.json"], true);
  let vercel: Record<string, unknown> = {};
  try {
    vercel = JSON.parse(await fs.readFile(vercelPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail("VERCEL_CONFIG_INVALID", "vercel.json must contain valid JSON.");
    if (tracked) fail("PLATFORM_FILE_MODIFIED", "The platform-owned vercel.json cannot be removed.");
  }
  if (tracked) {
    const git = vercel.git as Record<string, unknown> | undefined;
    if (!git || git.deploymentEnabled !== false) fail("PLATFORM_FILE_MODIFIED", "The platform-owned vercel.json git.deploymentEnabled setting cannot be removed or changed.");
  } else {
    vercel = { ...vercel, git: { ...(typeof vercel.git === "object" && vercel.git ? vercel.git as object : {}), deploymentEnabled: false } };
    const packageJson = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (deps.vite && !deps.nitro) vercel.rewrites ??= [{ source: "/(.*)", destination: "/index.html" }];
    await fs.writeFile(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`, { flag: "wx" }).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
  }

  const ignorePath = path.join(repoPath, ".gitignore");
  let ignored = "";
  try { ignored = await fs.readFile(ignorePath, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const required = ["node_modules/", "dist/", ".next/", "out/", ".env*"];
  const existing = new Set(ignored.split(/\r?\n/).map((line) => line.trim()));
  const additions = required.filter((item) => !existing.has(item));
  if (additions.length) await fs.writeFile(ignorePath, `${ignored}${ignored && !ignored.endsWith("\n") ? "\n" : ""}${additions.join("\n")}\n`);
}

export async function validateAppForPush(appPath: string): Promise<{ framework: "vite" | "next"; bytes: number; files: number }> {
  const root = path.resolve(appPath);
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const framework = deps.next ? "next" : deps.vite && !deps.nitro ? "vite" : undefined;
  if (!framework) fail("UNSUPPORTED_FRAMEWORK", "This app template is not supported for publishing.");
  let bytes = 0;
  let files = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) fail("UNSUPPORTED_FILE", "Symbolic links are not supported in published source.");
      if (entry.isDirectory()) {
        if ([".git", ".vercel", "node_modules", "dist", ".next", "out"].includes(entry.name)) continue;
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/^\.env(?:\..*)?$/i.test(path.posix.basename(relative)) || relative.startsWith(".vercel/")) fail("SECRET_DETECTED", "Publishing blocked: environment files and Vercel metadata cannot be committed.");
      const stat = await fs.stat(absolute);
      if (stat.size > MAX_FILE_BYTES) fail("FILE_TOO_LARGE", `Publishing blocked: ${relative} exceeds the per-file size limit.`);
      bytes += stat.size;
      files += 1;
      if (files > MAX_FILE_COUNT || bytes > MAX_REPO_BYTES) fail("REPOSITORY_TOO_LARGE", "Publishing blocked: source exceeds the repository size limit.");
      const bytesContent = await fs.readFile(absolute);
      if (!bytesContent.includes(0)) {
        const content = bytesContent.toString("utf8");
        if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) fail("SECRET_DETECTED", `Publishing blocked: a secret pattern was found in ${relative}.`);
        if (relative === "vercel.json") validateVercelConfig(content);
      }
    }
  };
  await walk(root);
  return { framework, bytes, files };
}

function validateVercelConfig(content: string): void {
  let config: Record<string, unknown>;
  try { config = JSON.parse(content) as Record<string, unknown>; } catch { fail("VERCEL_CONFIG_INVALID", "vercel.json must contain valid JSON."); }
  if (Object.keys(config!).some((key) => !ALLOWED_VERCEL_KEYS.has(key))) fail("VERCEL_CONFIG_FORBIDDEN", "vercel.json contains a setting that is not allowed.");
  const git = config!.git as Record<string, unknown> | undefined;
  if (!git || git.deploymentEnabled !== false || Object.keys(git).some((key) => key !== "deploymentEnabled")) fail("PLATFORM_FILE_MODIFIED", "The platform-owned vercel.json git.deploymentEnabled setting cannot be removed or changed.");
  const rewrites = config!.rewrites;
  if (rewrites !== undefined) {
    if (!Array.isArray(rewrites)) fail("VERCEL_CONFIG_INVALID", "vercel.json rewrites must be an array.");
    for (const rewrite of rewrites as Array<{ destination?: unknown }>) {
      if (typeof rewrite.destination !== "string" || /^\/\//.test(rewrite.destination) || /^[a-z][a-z0-9+.-]*:/i.test(rewrite.destination)) fail("VERCEL_EXTERNAL_REWRITE", "External Vercel rewrites are not allowed.");
    }
  }
}

async function runGit(cwd: string, args: string[], allowFailure = false): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execute = promisify(execFile);
  try { await execute("git", ["-C", cwd, ...args], { windowsHide: true, maxBuffer: 1024 * 1024 }); return true; }
  catch (error) {
    if (allowFailure && (error as { code?: number }).code !== 0) return false;
    fail("GIT_OPERATION_FAILED", "Could not inspect the source repository safely.");
  }
}

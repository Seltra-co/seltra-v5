import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";

const args = process.argv.slice(2);
const root = path.resolve(args.find((arg) => !arg.startsWith("--")) || "node_modules");
const dryRun = args.includes("--dry-run");
const runtimeBundle = path.resolve(root, "../dist/runtime/runtime_main.js");
const runtimeSource = await fs.readFile(runtimeBundle, "utf8");
const imports = new Set([...runtimeSource.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]));
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const resolve = createRequire(runtimeBundle);
const removableDirs = new Set([".cache", "test", "tests", "__tests__", "__fixtures__"]);
const incompatiblePlatform = /^(?:win32|darwin|android|freebsd|openbsd|sunos|linux-(?:arm64|arm|ia32|ppc64|s390x|riscv64|x64-musl)|.*-(?:win32|darwin|linux-(?:arm64|arm|ia32|ppc64|s390x|riscv64|x64-musl)|linuxmusl-x64))(?:-|$)/;
let removedBytes = 0;
let removedFiles = 0;

async function directorySize(target) {
  let size = 0;
  let entries;
  try { entries = await fs.readdir(target, { withFileTypes: true }); } catch { return size; }
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) size += await directorySize(child);
    else { try { size += (await fs.stat(child)).size; } catch {} }
  }
  return size;
}

async function prune(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (removableDirs.has(entry.name) || incompatiblePlatform.test(entry.name)) {
        removedBytes += await directorySize(target);
        if (!dryRun) await fs.rm(target, { recursive: true, force: true });
        removedFiles++;
      } else await prune(target);
    } else if (entry.name.endsWith(".map") || entry.name.endsWith(".tsbuildinfo")) {
      try { removedBytes += (await fs.stat(target)).size; } catch {}
      if (!dryRun) await fs.rm(target, { force: true });
      removedFiles++;
    }
  }
}

function packageName(specifier) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

function packageDirectoryFromFile(filename, expectedName) {
  let current = path.dirname(filename);
  while (current.startsWith(root)) {
    try {
      const pkg = JSON.parse(fsSync.readFileSync(path.join(current, "package.json"), "utf8"));
      if (pkg.name === expectedName) return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function packageDirectoryAtRoot(name) {
  const candidate = path.join(root, name);
  try {
    const pkg = JSON.parse(fsSync.readFileSync(path.join(candidate, "package.json"), "utf8"));
    if (pkg.name === name) return candidate;
  } catch {}
  return null;
}

function resolvePackageFrom(name, fromDirectory) {
  try {
    const resolver = createRequire(path.join(fromDirectory, "__runtime_prune__.cjs"));
    return resolver.resolve(name);
  } catch {
    return null;
  }
}

async function pruneUnusedPackages() {
  const required = new Map([
    ...[
    "better-sqlite3", "node-pty", "dugite", "@vscode/ripgrep", "ssh2", "dyad-keychain-reader",
    ].map((name) => [name, [name]]),
  ]);
  for (const specifier of imports) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/") && !builtins.has(specifier)) {
      const name = packageName(specifier);
      required.set(name, [...(required.get(name) ?? []), specifier]);
    }
  }

  const keepNames = new Set();
  const visitedDirectories = new Set();
  const queue = [];
  for (const [name, specifiers] of required) {
    let directory = packageDirectoryAtRoot(name);
    if (!directory) {
      for (const specifier of specifiers) {
        let resolved;
        try { resolved = resolve.resolve(specifier); } catch { continue; }
        directory = packageDirectoryFromFile(resolved, name);
        if (directory) break;
      }
    }
    if (directory) queue.push({ name, directory });
  }
  while (queue.length) {
    const { name, directory } = queue.pop();
    keepNames.add(name);
    if (visitedDirectories.has(directory)) continue;
    visitedDirectories.add(directory);
    let pkg;
    try { pkg = JSON.parse(fsSync.readFileSync(path.join(directory, "package.json"), "utf8")); }
    catch { continue; }
    for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      const resolved = resolvePackageFrom(dependency, directory);
      if (!resolved) continue;
      const dependencyDirectory = packageDirectoryFromFile(resolved, dependency);
      if (dependencyDirectory) queue.push({ name: dependency, directory: dependencyDirectory });
    }
  }

  const removed = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const base = path.join(root, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of await fs.readdir(base, { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue;
        const name = `${entry.name}/${scoped.name}`;
        if (keepNames.has(name)) continue;
        const target = path.join(base, scoped.name);
        const bytes = await directorySize(target);
        removed.push({ name, bytes });
        if (!dryRun) await fs.rm(target, { recursive: true, force: true });
      }
      if (!dryRun && (await fs.readdir(base)).length === 0) await fs.rmdir(base).catch(() => undefined);
    } else if (!keepNames.has(entry.name)) {
      removed.push({ name: entry.name, bytes: await directorySize(base) });
      if (!dryRun) await fs.rm(base, { recursive: true, force: true });
    }
  }
  removedBytes += removed.reduce((sum, item) => sum + item.bytes, 0);
  removedFiles += removed.length;
  const removedPackageMiB = Number((removed.reduce((sum, item) => sum + item.bytes, 0) / 1024 / 1024).toFixed(1));
  const largestRemovedPackages = [...removed]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 20)
    .map((item) => ({ package: item.name, sizeMiB: Number((item.bytes / 1024 / 1024).toFixed(1)) }));
  return { keptPackages: keepNames.size, removedPackages: removed.length, removedPackageMiB, largestRemovedPackages, dryRun };
}

async function packageSizes() {
  const packages = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const base = path.join(root, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of await fs.readdir(base, { withFileTypes: true })) {
        if (scoped.isDirectory()) packages.push({ name: `${entry.name}/${scoped.name}`, bytes: await directorySize(path.join(base, scoped.name)) });
      }
    } else packages.push({ name: entry.name, bytes: await directorySize(base) });
  }
  return packages.sort((a, b) => b.bytes - a.bytes).slice(0, 20).map((pkg) => ({ package: pkg.name, sizeMiB: Number((pkg.bytes / 1024 / 1024).toFixed(1)) }));
}

await prune(root);
const packagePrune = await pruneUnusedPackages();
console.log(JSON.stringify({ event: "runtime_image_prune", ...packagePrune, removedEntries: removedFiles, removedMiB: Number((removedBytes / 1024 / 1024).toFixed(1)), top20NodeModulesPackages: await packageSizes() }));

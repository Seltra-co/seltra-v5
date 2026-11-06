import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || "node_modules");
const removableDirs = new Set([".cache", "test", "tests", "__tests__", "__fixtures__"]);
const incompatiblePlatform = /^(?:win32|darwin|android|freebsd|openbsd|sunos|linux-(?:arm64|arm|ia32|ppc64|s390x|riscv64|x64-musl)|.*-(?:win32|darwin|linux-(?:arm64|arm|ia32|ppc64|s390x|riscv64|x64-musl))(?:-|$))/;
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
        await fs.rm(target, { recursive: true, force: true });
        removedFiles++;
      } else await prune(target);
    } else if (entry.name.endsWith(".map") || entry.name.endsWith(".tsbuildinfo")) {
      try { removedBytes += (await fs.stat(target)).size; } catch {}
      await fs.rm(target, { force: true });
      removedFiles++;
    }
  }
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
console.log(JSON.stringify({ event: "runtime_image_prune", removedEntries: removedFiles, removedMiB: Number((removedBytes / 1024 / 1024).toFixed(1)), top20NodeModulesPackages: await packageSizes() }));

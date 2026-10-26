import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const snapshotPath = path.join(root, "docs/web-port/SNAPSHOT.sha256");
const excludedDirs = new Set([
  "node_modules", "userData", "dist", "dist-web", "out", ".web-dev", ".vite",
]);
const excludedRoots = [
  "src/web", "server", "runtime", "scripts/web", "e2e-web", "docs/web-port",
];
const excludedFiles = new Set(["testing/fake-llm-server/dist"]);

async function collect(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name) || excludedRoots.some((p) => relative === p || relative.startsWith(`${p}/`))) continue;
      await collect(absolute, files);
    } else if (entry.isFile() && !excludedFiles.has(relative)) {
      files.push(relative);
    }
  }
  return files;
}

const files = (await collect(root)).sort();
const hashes = new Map();
for (const file of files) {
  hashes.set(file, createHash("sha256").update(await readFile(path.join(root, file))).digest("hex"));
}

let baseline;
try {
  baseline = (await readFile(snapshotPath, "utf8")).trim().split(/\r?\n/).filter(Boolean);
} catch {
  const rows = [...hashes].map(([file, hash]) => `${hash}  ${file}`);
  await writeFile(snapshotPath, `${rows.join("\n")}\n`);
  console.log(`Created baseline snapshot with ${rows.length} files.`);
  process.exit(0);
}

const previous = new Map(baseline.map((line) => {
  const match = line.match(/^([a-f\d]{64})\s+(.+)$/);
  if (!match) throw new Error(`Invalid snapshot line: ${line}`);
  return [match[2], match[1]];
}));
const changed = [...hashes].filter(([file, hash]) => previous.has(file) && previous.get(file) !== hash).map(([file]) => file);
const allowText = await readFile(path.join(root, "docs/web-port/ALLOWED_SEAMS.md"), "utf8").catch(() => "");
const allowed = new Set([...allowText.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]));
const denied = changed.filter((file) => !allowed.has(file));
if (changed.length) console.log(`Changed existing files:\n${changed.map((file) => `  ${file}`).join("\n")}`);
if (denied.length) {
  console.error(`Unlisted seam changes:\n${denied.map((file) => `  ${file}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("All changed existing files are listed in ALLOWED_SEAMS.md.");
}

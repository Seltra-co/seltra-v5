import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { shouldPruneRuntimeFile } from "./runtime-prune-rules.mjs";

const root = path.resolve(process.argv[2] || "node_modules");
const projectRoot = path.dirname(root);
const npmArboristCandidates = [
  path.resolve(path.dirname(process.execPath), "node_modules/npm/node_modules/@npmcli/arborist"),
  path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/node_modules/@npmcli/arborist"),
];
const npmArboristPath = npmArboristCandidates.find((candidate) => fsSync.existsSync(path.join(candidate, "package.json")));
if (!npmArboristPath) throw new Error(`Cannot load npm's @npmcli/arborist; searched ${npmArboristCandidates.join(", ")}`);
const Arborist = createRequire(import.meta.url)(npmArboristPath);
const roots = [projectRoot, path.join(projectRoot, "runtime/native")];
const closure = new Set();
function platformAllows(values, current) {
  if (!values) return true;
  const list = Array.isArray(values) ? values : [values];
  if (list.some((value) => value.startsWith("!") && value.slice(1) === current)) return false;
  const positive = list.filter((value) => !value.startsWith("!"));
  return positive.length === 0 || positive.includes(current);
}
for (const treeRoot of roots) {
  if (!fsSync.existsSync(path.join(treeRoot, "package-lock.json"))) continue;
  const tree = await new Arborist({ path: treeRoot, omit: ["dev"] }).loadActual();
  for (const node of tree.inventory.values()) {
    if (node.dev) continue;
    if (node.optional && (!platformAllows(node.package.os, process.platform) || !platformAllows(node.package.cpu, process.arch))) continue;
    if (node.location.startsWith("node_modules/")) closure.add(node.location.slice("node_modules/".length));
    else if (node.isLink && node.name) closure.add(node.name); // Root file: dependencies are installed as named node_modules symlinks.
  }
}
if (!closure.size) throw new Error("Arborist returned an empty production dependency closure");

const originalTargets = new Map();
function collectTargets(value, output) {
  if (typeof value === "string" && value.startsWith("./")) output.add(value.slice(2));
  else if (Array.isArray(value)) value.forEach((item) => collectTargets(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectTargets(item, output));
}
for (const name of closure) {
  const dir = path.join(root, name);
  const manifestPath = path.join(dir, "package.json");
  if (!fsSync.existsSync(manifestPath)) throw new Error(`Production closure package missing before prune: ${name}`);
  const pkg = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const targets = new Set();
  collectTargets(pkg.main, targets); collectTargets(pkg.module, targets); collectTargets(pkg.exports, targets);
  originalTargets.set(name, [...targets].filter((target) => fsSync.existsSync(path.join(dir, target))));
}
// Protect explicit entry targets for top-level and nested packages alike.
const protectedTargetPaths = new Set(
  [...originalTargets].flatMap(([name, targets]) =>
    targets.map((target) => path.resolve(root, name, target)),
  ),
);

async function pruneContents(dir, packageName) {
  if (fsSync.lstatSync(dir).isSymbolicLink()) return; // Local file: dependencies point to source packages; keep their source tree intact.
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Keep documentation and test directories intact because packages can store executable runtime files inside them (for example yaml/dist/doc/directives.js).
      await pruneContents(target, packageName);
    } else if (shouldPruneRuntimeFile(path.relative(path.join(root, packageName), target).replaceAll("\\", "/"))) {
      // Source maps and declaration files are not runtime inputs; only conventional Markdown documentation names are removed.
      if (!protectedTargetPaths.has(path.resolve(target))) await fs.rm(target, { force: true });
    }
  }
}

let scanned = 0;
for (const entry of await fs.readdir(root, { withFileTypes: true })) {
  if (entry.name === ".bin" || entry.name === ".package-lock.json") continue; // npm command shims and install metadata are not runtime packages.
  if (entry.name.startsWith("@")) {
    for (const child of await fs.readdir(path.join(root, entry.name), { withFileTypes: true })) {
      if (!child.isDirectory() && !child.isSymbolicLink()) throw new Error(`Unclassified entry in node_modules: ${entry.name}/${child.name}`);
      const name = `${entry.name}/${child.name}`;
      if (!closure.has(name)) throw new Error(`Package is outside the Arborist production closure; refusing to prune: ${name}`);
      scanned++;
      await pruneContents(path.join(root, name), name);
    }
  } else {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) throw new Error(`Unclassified entry in node_modules: ${entry.name}`);
    if (!closure.has(entry.name)) throw new Error(`Package is outside the Arborist production closure; refusing to prune: ${entry.name}`);
    scanned++;
    await pruneContents(path.join(root, entry.name), entry.name);
  }
}
const reportPath = path.join(projectRoot, ".runtime-prune-audit.json");
await fs.writeFile(reportPath, JSON.stringify({ closure: [...closure], originalTargets: Object.fromEntries(originalTargets) }, null, 2));
console.log(JSON.stringify({ event: "runtime_image_prune", closurePackages: closure.size, scannedPackages: scanned, preservedPackages: true, report: path.relative(projectRoot, reportPath) }));

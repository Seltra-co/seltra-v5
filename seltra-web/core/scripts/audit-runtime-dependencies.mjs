import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulesRoot = path.join(root, "node_modules");
const reportPath = path.join(root, ".runtime-prune-audit.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const failures = [];
function collectTargets(value, output) {
  if (typeof value === "string" && value.startsWith("./") && !value.includes("*")) output.add(value.slice(2));
  else if (Array.isArray(value)) value.forEach((item) => collectTargets(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectTargets(item, output));
}
for (const name of report.closure) {
  // Arborist's node.location preserves npm alias directory names such as string-width-cjs.
  const packageDir = path.join(modulesRoot, name);
  const manifestPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(manifestPath)) { failures.push(`${name}: missing node_modules/${name}/package.json`); continue; }
  const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (name.startsWith("@types/")) continue;
  const expected = report.originalTargets[name] ?? [];
  for (const target of expected) if (!fs.existsSync(path.join(packageDir, target))) failures.push(`${name}: missing package target ${target}`);
}
const aliases = ["string-width-cjs", "strip-ansi-cjs", "wrap-ansi-cjs"];
for (const alias of aliases) if (!fs.existsSync(path.join(modulesRoot, alias, "package.json"))) failures.push(`${alias}: npm alias directory missing`);
if (!fs.existsSync(path.join(modulesRoot, "math-intrinsics", "package.json"))) failures.push("math-intrinsics: package directory missing");
if (!fs.existsSync(path.join(modulesRoot, "math-intrinsics", "abs.js"))) failures.push("math-intrinsics/abs: target file missing");
console.log(JSON.stringify({ event: "runtime_dependency_file_audit", closurePackages: report.closure.length, checkedNpmAliases: aliases, checkedMathIntrinsicsAbs: true, failures }));
if (failures.length) process.exitCode = 1;

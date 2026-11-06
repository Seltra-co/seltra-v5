import fs from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.resolve(process.argv[2] || path.join(root, "dist/runtime/runtime_main.js"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const source = fs.readFileSync(bundle, "utf8");
const imports = new Set([...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]));
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const resolve = createRequire(bundle);
const audit = [];
for (const specifier of imports) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || builtins.has(specifier)) continue;
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  const declared = manifest.dependencies?.[packageName] ? "production" : manifest.optionalDependencies?.[packageName] ? "optional" : manifest.devDependencies?.[packageName] ? "development" : "transitive-or-unlisted";
  let resolved = false;
  try { resolve.resolve(specifier); resolved = true; } catch {}
  audit.push({ package: packageName, declared, resolved });
}
const unique = [...new Map(audit.map((item) => [item.package, item])).values()].sort((a, b) => a.package.localeCompare(b.package));
console.log(JSON.stringify({ event: "runtime_dependency_audit", bundle: path.relative(root, bundle), packages: unique }));
const missing = unique.filter((item) => !item.resolved);
if (missing.length) {
  console.error(`Runtime bundle external dependencies are unresolved: ${missing.map((item) => item.package).join(", ")}`);
  process.exitCode = 1;
}

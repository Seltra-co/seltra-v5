//web/check-abi.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rootRequire = createRequire(path.join(root, "package.json"));
const runtimeRequire = createRequire(path.join(root, "runtime/native/package.json"));
const modules = ["better-sqlite3", "node-pty", "dugite", "@vscode/ripgrep", "ssh2"];
const nativeResults = [];

for (const id of modules) {
  const loaded = runtimeRequire(id);
  nativeResults.push(id + ": loaded (" + runtimeRequire.resolve(id) + ")");
  if (id === "better-sqlite3") {
    const database = new loaded(":memory:");
    database.exec("CREATE TABLE abi_check (value INTEGER)");
    database.close();
    nativeResults.push("better-sqlite3: in-memory database opened");
  }
}
console.log("Node ABI " + process.versions.modules + " runtime/native: PASS\n" + nativeResults.join("\n"));

if (process.argv.includes("--skip-electron")) {
  console.log("Electron ABI check skipped (web deployment)");
  process.exit(0);
}

const electronEntry = rootRequire.resolve("electron");
const electronRoot = path.dirname(electronEntry);
const electronPackage = JSON.parse(fs.readFileSync(path.join(electronRoot, "package.json"), "utf8"));
const electronExe = path.join(electronRoot, "dist", process.platform === "win32" ? "electron.exe" : "electron");
const script = "for (const id of " + JSON.stringify(modules) + ") { require(id); process.stdout.write(id + ': loaded\\n'); }";
const result = spawnSync(electronExe, ["-e", script], {
  cwd: root,
  encoding: "utf8",
  env: { PATH: process.env.PATH, ELECTRON_RUN_AS_NODE: "1" },
});
if (result.status !== 0) {
  console.error("Electron ABI " + electronPackage.version + " root modules: FAIL\n" + (result.stderr || result.stdout));
  process.exit(result.status ?? 1);
}
console.log("Electron ABI " + electronPackage.version + " root modules: PASS\n" + result.stdout.trim());

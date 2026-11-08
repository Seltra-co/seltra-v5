import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/prune-runtime-image.mjs");

test("runtime image pruning removes caches, maps, and incompatible platform builds only", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "seltra-image-prune-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const modules = path.join(temp, "node_modules");
  const files = [
    "@img/sharp-libvips-linuxmusl-x64/lib.bin",
    "@esbuild/win32-x64/bin.exe",
    "@esbuild/linux-x64/bin.node",
    "@modelcontextprotocol/sdk/server/index.js",
    "pkg/test/fixture.json",
    "pkg/index.js.map",
    "pkg/index.js",
  ];
  for (const file of files) {
    const full = path.join(modules, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, "x");
  }
  await fs.mkdir(path.join(temp, "dist", "runtime"), { recursive: true });
  await fs.writeFile(path.join(temp, "dist", "runtime", "runtime_main.js"), 'require("pkg"); require("@esbuild/linux-x64"); require("@modelcontextprotocol/sdk/server/index.js");');
  await fs.writeFile(path.join(modules, "pkg", "package.json"), JSON.stringify({ name: "pkg", main: "index.js" }));
  await fs.writeFile(path.join(modules, "@esbuild", "linux-x64", "package.json"), JSON.stringify({ name: "@esbuild/linux-x64", main: "bin.node" }));
  await fs.writeFile(path.join(modules, "@modelcontextprotocol", "sdk", "package.json"), JSON.stringify({ name: "@modelcontextprotocol/sdk", exports: { "./server/index.js": "./server/index.js" } }));
  const result = spawnSync(process.execPath, [script, modules], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.access(path.join(modules, "@img/sharp-libvips-linuxmusl-x64")).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(modules, "@esbuild/win32-x64")).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(modules, "@esbuild/linux-x64/bin.node")).then(() => true, () => false), true);
  assert.equal(await fs.access(path.join(modules, "@modelcontextprotocol/sdk/server/index.js")).then(() => true, () => false), true);
  assert.equal(await fs.access(path.join(modules, "pkg/test")).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(modules, "pkg/index.js.map")).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(modules, "pkg/index.js")).then(() => true, () => false), true);
});

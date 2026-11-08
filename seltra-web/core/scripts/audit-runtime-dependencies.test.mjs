import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const modules = path.join(root, "node_modules");
const aliases = [
  ["string-width-cjs", "string-width"],
  ["strip-ansi-cjs", "strip-ansi"],
  ["wrap-ansi-cjs", "wrap-ansi"],
];
for (const [alias, target] of aliases) {
  test(`audits npm alias by installed directory name: ${alias}`, () => {
    const manifestPath = path.join(modules, alias, "package.json");
    assert.ok(fs.existsSync(manifestPath), `missing node_modules/${alias}/package.json`);
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).name, target);
  });
}
test("audits math-intrinsics through its exported abs subpath", () => {
  assert.ok(fs.existsSync(path.join(modules, "math-intrinsics", "package.json")));
  assert.ok(fs.existsSync(path.join(modules, "math-intrinsics", "abs.js")));
});

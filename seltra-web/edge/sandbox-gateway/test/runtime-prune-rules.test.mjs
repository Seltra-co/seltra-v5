import test from "node:test";
import assert from "node:assert/strict";
import { shouldPruneRuntimeFile } from "../scripts/runtime-prune-rules.mjs";

test("prune allowlist keeps executable JavaScript inside documentation directories", () => {
  assert.equal(shouldPruneRuntimeFile("dist/doc/directives.js"), false);
  assert.equal(shouldPruneRuntimeFile("docs/runtime-loader.mjs"), false);
});

test("prune allowlist removes safe package documentation and metadata files", () => {
  assert.equal(shouldPruneRuntimeFile("README.md"), true);
  assert.equal(shouldPruneRuntimeFile("docs/CHANGELOG.md"), true);
  assert.equal(shouldPruneRuntimeFile("dist/index.js.map"), true);
  assert.equal(shouldPruneRuntimeFile("types/index.d.ts"), true);
  assert.equal(shouldPruneRuntimeFile("docs/architecture.md"), false);
});

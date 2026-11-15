import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ensureDyadGitignored } from "./gitignoreUtils";

let appPath: string | undefined;

afterEach(async () => {
  if (appPath) await fs.rm(appPath, { recursive: true, force: true });
  appPath = undefined;
});

it("ignores both legacy metadata and Seltra-managed media", async () => {
  appPath = await fs.mkdtemp(path.join(os.tmpdir(), "seltra-gitignore-"));
  await fs.writeFile(path.join(appPath, ".gitignore"), "dist/\n");

  await ensureDyadGitignored(appPath);

  expect(await fs.readFile(path.join(appPath, ".gitignore"), "utf8")).toBe(
    "dist/\n.dyad/\n.seltra/\n",
  );
});

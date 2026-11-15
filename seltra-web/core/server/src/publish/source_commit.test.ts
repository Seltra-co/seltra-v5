import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { commitWorkspaceTree } from "./source_commit.js";

const run = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("commitWorkspaceTree", () => {
  it("commits a verified workspace copy with platform files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seltra-source-commit-"));
    roots.push(root);
    const appsRoot = path.join(root, "apps");
    const appPath = path.join(appsRoot, "store");
    await mkdir(appPath, { recursive: true });
    await writeFile(path.join(appPath, "package.json"), JSON.stringify({ dependencies: { vite: "1.0.0" } }));
    await writeFile(path.join(appPath, "index.html"), "<main>test store</main>");
    await writeFile(path.join(appPath, "vercel.json"), JSON.stringify({ $schema: "https://openapi.vercel.sh/vercel.json", rewrites: [{ source: "/(.*)", destination: "/index.html" }] }));

    const result = await commitWorkspaceTree({
      appId: 7,
      appPath,
      appsRoot,
      author: { name: "Seltra Test", email: "seltra-test@example.com" },
      turnId: "turn-1",
    });

    expect(result).toMatchObject({ appId: 7, relPath: "store", changed: true });
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    const readme = await readFile(path.join(appPath, "README.md"), "utf8");
    expect(readme).toContain("Built with **Seltra**");
    expect(readme).not.toContain("Dyad");
    expect(JSON.parse(await readFile(path.join(appPath, "vercel.json"), "utf8"))).toMatchObject({ git: { deploymentEnabled: false } });
    const { stdout } = await run("git", ["-C", appPath, "status", "--porcelain"]);
    expect(stdout).toBe("");
  }, 15_000);

  it("rejects app paths outside the verified apps root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "seltra-source-commit-"));
    roots.push(root);

    await expect(commitWorkspaceTree({
      appId: 7,
      appPath: path.join(root, "outside"),
      appsRoot: path.join(root, "apps"),
      author: { name: "Seltra Test", email: "seltra-test@example.com" },
    })).rejects.toMatchObject({ code: "APP_PATH_FORBIDDEN" });
  });
});

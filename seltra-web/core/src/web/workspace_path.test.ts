import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveWorkspaceProjectPath,
  WorkspacePathError,
} from "./workspace_path";

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-workspace-path-"));
  roots.push(root);
  const project = path.join(root, "apps", "demo");
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, "inside.txt"), "ok");
  const outside = path.join(root, "outside.txt");
  await fs.writeFile(outside, "no");
  return { root, project, outside };
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("resolveWorkspaceProjectPath", () => {
  it("accepts paths inside the project", async () => {
    const { root, project } = await fixture();
    expect(
      await resolveWorkspaceProjectPath(
        path.join(root, "apps"),
        "demo",
        "inside.txt",
      ),
    ).toBe(path.join(project, "inside.txt"));
  });
  it.each(["../outside.txt", path.resolve("/outside.txt")])(
    "rejects traversal or absolute escape: %s",
    async (input) => {
      const { root } = await fixture();
      await expect(
        resolveWorkspaceProjectPath(path.join(root, "apps"), "demo", input),
      ).rejects.toBeInstanceOf(WorkspacePathError);
    },
  );
  it.each([String.raw`\\server\share\file.txt`, "C:\\outside.txt"])(
    "rejects UNC and drive-prefixed paths: %s",
    async (input) => {
      const { root } = await fixture();
      await expect(
        resolveWorkspaceProjectPath(path.join(root, "apps"), "demo", input),
      ).rejects.toBeInstanceOf(WorkspacePathError);
    },
  );
  it("allows a write target in new nested directories", async () => {
    const { root, project } = await fixture();
    expect(
      await resolveWorkspaceProjectPath(
        path.join(root, "apps"),
        "demo",
        "new/subdir/file.ts",
      ),
    ).toBe(path.join(project, "new", "subdir", "file.ts"));
  });
  it.skipIf(process.platform !== "win32")(
    "accepts project identifiers with Windows case variation",
    async () => {
      const { root, project } = await fixture();
      expect(
        await resolveWorkspaceProjectPath(
          path.join(root, "apps"),
          "DEMO",
          "inside.txt",
        ),
      ).toBe(path.join(project, "inside.txt"));
    },
  );
  it("rejects a symlink that points outside the project", async () => {
    const { root, project, outside } = await fixture();
    try {
      await fs.symlink(outside, path.join(project, "escape.txt"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await expect(
      resolveWorkspaceProjectPath(
        path.join(root, "apps"),
        "demo",
        "escape.txt",
      ),
    ).rejects.toBeInstanceOf(WorkspacePathError);
  });
});

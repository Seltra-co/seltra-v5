import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  backup: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: () => ({
    $client: { backup: mocks.backup },
    select: mocks.select,
  }),
  getDatabasePath: vi.fn(),
}));

vi.mock("../db/schema", () => ({
  apps: {
    id: "id",
    name: "name",
    path: "path",
    githubOrg: "githubOrg",
    githubRepo: "githubRepo",
  },
}));

vi.mock("../paths/paths", async () => {
  const path = await import("node:path");
  return {
    getDyadAppPath: (appPath: string) =>
      path.default.isAbsolute(appPath)
        ? appPath
        : path.default.join(process.env.DYAD_APPS_DIR || "./apps", appPath),
  };
});

import { snapshotUserData } from "./workspace_rpc";

describe("snapshotUserData", () => {
  let tempRoot: string;
  const originalEnv = {
    DYAD_APPS_DIR: process.env.DYAD_APPS_DIR,
    DYAD_TMP_DIR: process.env.DYAD_TMP_DIR,
    DYAD_USER_DATA: process.env.DYAD_USER_DATA,
    DYAD_WEB_RUNTIME: process.env.DYAD_WEB_RUNTIME,
  };

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "seltra-workspace-rpc-"),
    );
    process.env.DYAD_APPS_DIR = path.join(tempRoot, "apps");
    process.env.DYAD_TMP_DIR = path.join(tempRoot, "tmp");
    process.env.DYAD_USER_DATA = path.join(tempRoot, "userData");
    process.env.DYAD_WEB_RUNTIME = "1";
    mocks.backup.mockResolvedValue(undefined);
    mocks.select.mockReturnValue({
      from: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: "Relative app",
          path: "relative-app",
          githubOrg: null,
          githubRepo: null,
        },
        {
          id: 2,
          name: "Absolute app",
          path: path.join(tempRoot, "apps", "absolute-app"),
          githubOrg: null,
          githubRepo: null,
        },
        {
          id: 3,
          name: "Outside app",
          path: path.join(tempRoot, "outside-app"),
          githubOrg: null,
          githubRepo: null,
        },
      ]),
    });
  });

  afterEach(async () => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("resolves relative app paths against DYAD_APPS_DIR and excludes paths outside it", async () => {
    const result = await snapshotUserData();

    expect(result.apps).toEqual([
      {
        coreAppId: 1,
        name: "Relative app",
        relPath: "relative-app",
        githubOrg: null,
        githubRepo: null,
      },
      {
        coreAppId: 2,
        name: "Absolute app",
        relPath: "absolute-app",
        githubOrg: null,
        githubRepo: null,
      },
    ]);
  });
});

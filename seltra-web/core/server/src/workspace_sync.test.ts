import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSyncState } from "./workspace_sync.js";

describe("WorkspaceSyncState", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("rechecks the backend manifest for an explicit pre-completion sync even when files are unchanged", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "seltra-workspace-sync-"));
    const appsRoot = path.join(root, "apps");
    await mkdir(appsRoot);
    await writeFile(path.join(appsRoot, "app.txt"), "same content");
    const state = new WorkspaceSyncState();
    const syncBackend = vi.fn(async () => ({ verified: true }));
    const input = { appsRoot, isAllowed: () => true, syncBackend, onFailure: vi.fn() };

    await state.synchronize(input);
    const verified = await state.synchronize({ ...input, forceVerify: true });

    expect(syncBackend).toHaveBeenCalledTimes(2);
    expect(verified.verified).toBe(true);
  });

  it("retries failed backend persistence without caching an unverified manifest", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "seltra-workspace-sync-"));
    const appsRoot = path.join(root, "apps");
    await mkdir(appsRoot);
    await writeFile(path.join(appsRoot, "app.txt"), "same content");
    const state = new WorkspaceSyncState();
    const syncBackend = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("temporary persistence failure"), { code: "backend_sync_failed" }))
      .mockResolvedValueOnce({ verified: true });
    const input = { appsRoot, isAllowed: () => true, syncBackend, onFailure: vi.fn() };

    await expect(state.synchronize(input)).rejects.toMatchObject({ code: "backend_sync_failed" });
    const verified = await state.synchronize(input);

    expect(syncBackend).toHaveBeenCalledTimes(2);
    expect(verified.verified).toBe(true);
  });
});

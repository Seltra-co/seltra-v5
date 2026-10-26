import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apps } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { activeRecordings } from "@/ipc/services/recording_registry";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), "dyad-media-user-data")),
    getAppPath: vi.fn(() => process.cwd()),
  },
  shell: { openPath: vi.fn() },
}));

const { registerMediaHandlers } = await import("./media_handlers");

describe("media move recording admission", () => {
  let harness: HandlerTestHarness;
  let tempRoot: string;

  beforeEach(() => {
    activeRecordings.clear();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-media-handler-"));
    harness = setupHandlerTestHarness();
    registerMediaHandlers();
  });

  afterEach(() => {
    activeRecordings.clear();
    harness.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("refuses when the target app is recording", async () => {
    activeRecordings.set(8, {
      appId: 8,
      stop: () => {},
      done: Promise.resolve({ envRestored: true }),
    });

    await expect(
      harness.invokeHandler("move-media-file", {
        sourceAppId: 7,
        targetAppId: 8,
        fileName: "image.png",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  });

  it("returns a bounded media preview payload for the selected app", async () => {
    const appPath = path.join(tempRoot, "preview-app");
    const mediaPath = path.join(appPath, DYAD_MEDIA_DIR_NAME);
    fs.mkdirSync(mediaPath, { recursive: true });
    fs.writeFileSync(path.join(mediaPath, "preview.png"), Buffer.from([137, 80, 78, 71]));
    const app = harness.db.insert(apps).values({ name: "Preview", path: appPath }).returning().get();

    await expect(harness.invokeHandler("get-media-file-data", { appId: app.id, fileName: "preview.png" })).resolves.toEqual({
      mimeType: "image/png",
      base64: Buffer.from([137, 80, 78, 71]).toString("base64"),
    });
    await expect(harness.invokeHandler("get-media-file-data", { appId: app.id, fileName: "../outside.png" })).rejects.toBeDefined();
  });

  it("allows a move out of a recording source when the target is free", async () => {
    const sourcePath = path.join(tempRoot, "source");
    const targetPath = path.join(tempRoot, "target");
    const sourceMediaPath = path.join(sourcePath, DYAD_MEDIA_DIR_NAME);
    fs.mkdirSync(sourceMediaPath, { recursive: true });
    fs.mkdirSync(targetPath, { recursive: true });
    fs.writeFileSync(path.join(sourceMediaPath, "image.png"), "image");
    const [sourceApp, targetApp] = harness.db
      .insert(apps)
      .values([
        { name: "Source", path: sourcePath },
        { name: "Target", path: targetPath },
      ])
      .returning()
      .all();
    activeRecordings.set(sourceApp.id, {
      appId: sourceApp.id,
      stop: () => {},
      done: Promise.resolve({ envRestored: true }),
    });

    await expect(
      harness.invokeHandler("move-media-file", {
        sourceAppId: sourceApp.id,
        targetAppId: targetApp.id,
        fileName: "image.png",
      }),
    ).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(sourceMediaPath, "image.png"))).toBe(false);
    expect(
      fs.existsSync(path.join(targetPath, DYAD_MEDIA_DIR_NAME, "image.png")),
    ).toBe(true);
  });
});

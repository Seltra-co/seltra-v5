import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  getDyadMediaDir,
  getDyadScreenshotDir,
  migrateLegacyMediaDirectories,
} from "./media_path_utils";

let appPath: string | undefined;

afterEach(async () => {
  if (appPath) await fs.rm(appPath, { recursive: true, force: true });
  appPath = undefined;
});

it("moves legacy media and screenshot directories into .seltra", async () => {
  appPath = await fs.mkdtemp(path.join(os.tmpdir(), "seltra-media-migration-"));
  const legacyMediaDir = path.join(appPath, ".dyad", "media");
  const legacyScreenshotDir = path.join(appPath, ".dyad", "screenshot");
  await fs.mkdir(legacyMediaDir, { recursive: true });
  await fs.mkdir(legacyScreenshotDir, { recursive: true });
  await fs.writeFile(path.join(legacyMediaDir, "image.png"), "image");
  await fs.writeFile(path.join(legacyScreenshotDir, "capture.png"), "capture");

  expect(getDyadMediaDir(appPath)).toBe(path.join(appPath, ".seltra", "media"));
  expect(getDyadScreenshotDir(appPath)).toBe(
    path.join(appPath, ".seltra", "screenshot"),
  );
  expect(
    await fs.readFile(
      path.join(appPath, ".seltra", "media", "image.png"),
      "utf8",
    ),
  ).toBe("image");
  expect(
    await fs.readFile(
      path.join(appPath, ".seltra", "screenshot", "capture.png"),
      "utf8",
    ),
  ).toBe("capture");
  await expect(fs.access(legacyMediaDir)).rejects.toThrow();
  await expect(fs.access(legacyScreenshotDir)).rejects.toThrow();
});

it("preserves conflicting legacy files and reports the migration error", async () => {
  appPath = await fs.mkdtemp(path.join(os.tmpdir(), "seltra-media-conflict-"));
  const legacyMediaDir = path.join(appPath, ".dyad", "media");
  const currentMediaDir = path.join(appPath, ".seltra", "media");
  await fs.mkdir(legacyMediaDir, { recursive: true });
  await fs.mkdir(currentMediaDir, { recursive: true });
  await fs.writeFile(path.join(legacyMediaDir, "image.png"), "legacy");
  await fs.writeFile(path.join(currentMediaDir, "image.png"), "current");

  expect(() => migrateLegacyMediaDirectories(appPath!)).toThrow(
    "Conflicting legacy and Seltra media files",
  );
  expect(
    await fs.readFile(path.join(legacyMediaDir, "image.png"), "utf8"),
  ).toBe("legacy");
  expect(
    await fs.readFile(path.join(currentMediaDir, "image.png"), "utf8"),
  ).toBe("current");
});

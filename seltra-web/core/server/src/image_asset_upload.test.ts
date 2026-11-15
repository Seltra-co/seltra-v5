import { describe, expect, it, vi } from "vitest";
import { uploadGeneratedImage } from "./image_asset_upload.js";

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(21 * 1024, 1),
]);

describe("generated image durable upload", () => {
  it("writes a validated raster under the workspace and app asset key", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    await expect(uploadGeneratedImage(
      { put },
      "workspaces",
      "12345678-1234-1234-1234-123456789012",
      42,
      "hero",
      png,
      "image/png",
    )).resolves.toEqual({
      key: "projects/12345678-1234-1234-1234-123456789012/apps/42/assets/hero.png",
      size: png.byteLength,
    });
    expect(put).toHaveBeenCalledWith(
      "workspaces",
      "projects/12345678-1234-1234-1234-123456789012/apps/42/assets/hero.png",
      png,
      "image/png",
    );
  });

  it("rejects SVGs, mismatched MIME types, and unsafe slot IDs", async () => {
    const put = vi.fn();
    await expect(uploadGeneratedImage(
      { put },
      "workspaces",
      "12345678-1234-1234-1234-123456789012",
      42,
      "hero",
      Buffer.from(`<svg>${"x".repeat(22 * 1024)}</svg>`),
      "image/svg+xml",
    )).rejects.toThrow("format does not match");
    await expect(uploadGeneratedImage(
      { put },
      "workspaces",
      "12345678-1234-1234-1234-123456789012",
      42,
      "../hero",
      png,
      "image/png",
    )).rejects.toThrow("identity is invalid");
    expect(put).not.toHaveBeenCalled();
  });
});

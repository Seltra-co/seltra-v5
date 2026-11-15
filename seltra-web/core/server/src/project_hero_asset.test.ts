import { describe, expect, it, vi } from "vitest";
import { decodeProjectHeroWebp, projectHeroPublicUrl, uploadProjectHero } from "./project_hero_asset.js";

const webp = (length = 20 * 1024 + 1) => {
  const bytes = Buffer.alloc(length);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  return bytes;
};

describe("project hero assets", () => {
  it("accepts WebP bytes above the minimum size", () => {
    expect(decodeProjectHeroWebp(webp().toString("base64"))).toHaveLength(20 * 1024 + 1);
  });

  it("rejects undersized, non-WebP, and unsafe storage identities", async () => {
    expect(() => decodeProjectHeroWebp(webp(20 * 1024).toString("base64"))).toThrow(/between 20 KB and 14 MB/);
    expect(() => decodeProjectHeroWebp(Buffer.from("not-webp").toString("base64"))).toThrow(/between 20 KB and 14 MB/);
    expect(() => decodeProjectHeroWebp(webp(14 * 1024 * 1024 + 1).toString("base64"))).toThrow(/between 20 KB and 14 MB/);
    await expect(uploadProjectHero({ put: vi.fn() }, "assets", "../bad", webp().toString("base64"))).rejects.toThrow(/identity is invalid/);
  });

  it("uploads to the stable project hero key", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const bytes = webp();
    await expect(uploadProjectHero({ put }, "assets", "project_123", bytes.toString("base64"))).resolves.toEqual({
      key: "projects/project_123/hero.webp",
      size: bytes.length,
    });
    expect(put).toHaveBeenCalledWith("assets", "projects/project_123/hero.webp", bytes, "image/webp");
  });

  it("builds a cache-busted public URL for the durable object", () => {
    expect(projectHeroPublicUrl("https://core.example.test/v1", "project_123", "1234")).toBe(
      "https://core.example.test/v1/projects/project_123/hero.webp?v=1234",
    );
  });
});

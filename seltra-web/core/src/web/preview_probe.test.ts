import { describe, expect, it, vi } from "vitest";
import { probeBrowserPreview } from "../../server/src/preview_probe";

describe("browser path preview probe", () => {
  it("reports ready only for HTTP 200", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    await expect(probeBrowserPreview("http://ws-project-app-1.localhost:8080/", fetchImpl))
      .resolves.toEqual({ ready: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledWith("http://ws-project-app-1.localhost:8080/", expect.objectContaining({
      headers: { accept: "text/html" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("keeps a redacted upstream body prefix for non-200 responses", async () => {
    const result = await probeBrowserPreview("http://preview.test/", vi.fn(async () =>
      new Response("preview unavailable token=private-value", { status: 503 }),
    ));
    expect(result).toEqual({
      ready: false,
      status: 503,
      redactedBodyPrefix: "preview unavailable token=[redacted]",
    });
  });
});

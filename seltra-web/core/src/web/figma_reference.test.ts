import { describe, expect, it, vi } from "vitest";
import {
  parseFigmaFileUrl,
  retrieveFigmaReference,
  summarizeFigmaFile,
} from "./figma_reference";

describe("Figma reference retrieval", () => {
  it("accepts design/file URLs and strips share tokens and node queries", () => {
    expect(
      parseFigmaFileUrl(
        "https://www.figma.com/design/AbcD12345/My-file?node-id=0-1&t=secret",
      ),
    ).toEqual({
      fileKey: "AbcD12345",
      sourceUrl: "https://www.figma.com/design/AbcD12345",
    });
  });

  it.each([
    "http://www.figma.com/design/AbcD12345/file",
    "https://figma.com.evil.test/design/AbcD12345/file",
    "https://www.figma.com/proto/AbcD12345/file",
    "https://user@www.figma.com/design/AbcD12345/file",
  ])("rejects unsafe or unsupported URL %s", (url) => {
    expect(() => parseFigmaFileUrl(url)).toThrow();
  });

  it("summarizes bounded page structure and colors without inventing assets", () => {
    const result = summarizeFigmaFile(
      {
        name: "Portfolio",
        document: {
          children: [
            {
              id: "1:2",
              name: "Page 1",
              children: [
                {
                  name: "home",
                  type: "FRAME",
                  fills: [
                    {
                      type: "SOLID",
                      color: { r: 1, g: 0.25, b: 0 },
                    },
                  ],
                  children: [
                    {
                      name: "Greeting",
                      type: "TEXT",
                      characters: "Hello",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      "https://www.figma.com/design/AbcD12345",
      "2026-10-19T00:00:00.000Z",
    );
    expect(result.pages[0]?.summary).toContain("home");
    expect(result.pages[0]?.summary).toContain("Hello");
    expect(result.tokens).toContainEqual({
      name: "home",
      value: "#FF4000",
      category: "color",
    });
    expect(result.assets).toEqual([]);
    expect(result.limitations.join(" ")).toContain("untrusted");
  });

  it("fetches through the fixed Figma API origin and reports a normalized reference", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "Figma project",
          document: { children: [{ name: "Page 1", children: [] }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await retrieveFigmaReference(
      "https://www.figma.com/design/AbcD12345/file?node-id=1-2&t=secret",
      "private-token",
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.figma.com/v1/files/AbcD12345?depth=3",
      expect.objectContaining({
        headers: { "X-Figma-Token": "private-token" },
      }),
    );
    expect(result.sourceUrl).toBe("https://www.figma.com/design/AbcD12345");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("retries a rate-limited Figma read when the server permits an immediate retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "Figma project",
            document: { children: [{ name: "Page 1", children: [] }] },
          }),
          { status: 200 },
        ),
      );

    await expect(
      retrieveFigmaReference(
        "https://www.figma.com/design/AbcD12345/file",
        "private-token",
        fetcher,
      ),
    ).resolves.toMatchObject({ fileName: "Figma project" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("bounds retries after repeated Figma rate limiting", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        status: 429,
        headers: { "retry-after": "0" },
      }),
    );

    await expect(
      retrieveFigmaReference(
        "https://www.figma.com/design/AbcD12345/file",
        "private-token",
        fetcher,
      ),
    ).rejects.toThrow("Figma rate-limited the import. Try again shortly.");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("maps Figma permission and missing-file responses without exposing upstream text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret upstream body", { status: 404 }));
    await expect(
      retrieveFigmaReference(
        "https://www.figma.com/design/AbcD12345/file",
        "private-token",
        fetcher,
      ),
    ).rejects.toThrow("Figma could not find a file this token can access.");
  });
});

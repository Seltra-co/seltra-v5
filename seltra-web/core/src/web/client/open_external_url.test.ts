import { afterEach, describe, expect, it, vi } from "vitest";
import { openWebExternalUrl, parseWebExternalUrl } from "./open_external_url";

describe("web external URL handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["https://example.com", "https://example.com/"],
    ["http://localhost:8080/path", "http://localhost:8080/path"],
  ])("accepts %s", (value, normalized) => {
    expect(parseWebExternalUrl(value).href).toBe(normalized);
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "file:///secret"])(
    "rejects %s",
    (value) => {
      expect(() => parseWebExternalUrl(value)).toThrow(
        "Only HTTP and HTTPS links can be opened.",
      );
    },
  );

  it("opens a validated link in a no-opener tab", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    openWebExternalUrl("https://example.com/path");

    expect(open).toHaveBeenCalledWith(
      "https://example.com/path",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("navigates a preopened tab without retaining an opener", () => {
    const replace = vi.fn();
    const tab = {
      opener: {} as Window,
      location: { replace },
    } as unknown as Window;

    openWebExternalUrl("https://example.com/preview", tab);

    expect(tab.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith("https://example.com/preview");
  });
});

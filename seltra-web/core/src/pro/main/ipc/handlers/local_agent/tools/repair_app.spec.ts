import { describe, expect, it } from "vitest";
import { isAcceptableHeroCapture, isIgnoredBrowserNoise } from "./repair_app";

describe("browser QA noise classifier", () => {
  it("ignores Vite WebSocket failures and screenshot shim messages", () => {
    expect(isIgnoredBrowserNoise("[vite] failed to connect to websocket", "https://preview.example.test/")).toBe(true);
    expect(isIgnoredBrowserNoise("WebSocket handshake failed at wss://preview.example.test/" , "https://preview.example.test/")).toBe(true);
    expect(isIgnoredBrowserNoise("WebSocket closed without opened.", "https://preview.example.test/")).toBe(true);
    expect(isIgnoredBrowserNoise("[seltra-screenshot] capture unavailable")).toBe(true);
  });

  describe("project hero screenshot validation", () => {
    it("accepts only a varied, nontrivial 1440x900 WebP capture", () => {
      expect(isAcceptableHeroCapture(1440, 900, 20 * 1024 + 1, 21)).toBe(true);
      expect(isAcceptableHeroCapture(1440, 900, 20 * 1024, 21)).toBe(false);
      expect(isAcceptableHeroCapture(1440, 900, 14 * 1024 * 1024 + 1, 21)).toBe(false);
      expect(isAcceptableHeroCapture(1440, 900, 20 * 1024 + 1, 20)).toBe(false);
      expect(isAcceptableHeroCapture(1280, 720, 20 * 1024 + 1, 21)).toBe(false);
    });
  });

  it("keeps first party asset 404s and uncaught page errors", () => {
    expect(isIgnoredBrowserNoise("HTTP 404: GET https://preview.example.test/assets/x.png")).toBe(false);
    expect(isIgnoredBrowserNoise("uncaught: TypeError: cannot read property" )).toBe(false);
  });

  it("uses the classifier polarity to retain real uncaught errors and ignore benign Vite errors", () => {
    const shouldRecordPageError = (message: string) => !isIgnoredBrowserNoise(message, "https://preview.example.test/");
    expect(shouldRecordPageError("TypeError: Cannot read properties of undefined")).toBe(true);
    expect(shouldRecordPageError("WebSocket closed without opened.")).toBe(false);
  });
});

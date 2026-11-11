import { describe, expect, it } from "vitest";
import { isIgnoredBrowserNoise } from "./repair_app";

describe("browser QA noise classifier", () => {
  it("ignores Vite WebSocket failures and screenshot shim messages", () => {
    expect(isIgnoredBrowserNoise("[vite] failed to connect to websocket", "https://preview.example.test/")).toBe(true);
    expect(isIgnoredBrowserNoise("WebSocket handshake failed at wss://preview.example.test/" , "https://preview.example.test/")).toBe(true);
    expect(isIgnoredBrowserNoise("[dyad-screenshot] capture unavailable")).toBe(true);
  });

  it("keeps first party asset 404s and uncaught page errors", () => {
    expect(isIgnoredBrowserNoise("HTTP 404: GET https://preview.example.test/assets/x.png")).toBe(false);
    expect(isIgnoredBrowserNoise("uncaught: TypeError: cannot read property" )).toBe(false);
  });
});

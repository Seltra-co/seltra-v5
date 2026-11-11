import { describe, expect, it } from "vitest";
import { previewProxyOptions } from "./preview_proxy_options.js";

describe("preview WebSocket proxy options", () => {
  it("sets changeOrigin for signed remote preview targets", () => {
    expect(previewProxyOptions("https://sandbox.example/preview/7", true)).toMatchObject({
      target: "https://sandbox.example/preview/7",
      changeOrigin: true,
      secure: true,
    });
  });

  it("preserves local preview host headers without changing origin", () => {
    expect(previewProxyOptions("http://127.0.0.1:32107", false, { host: "app-7.localhost:32107" })).toEqual({
      target: "http://127.0.0.1:32107",
      headers: { host: "app-7.localhost:32107" },
    });
  });
});

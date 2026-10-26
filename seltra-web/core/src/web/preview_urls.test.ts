import { describe, expect, it } from "vitest";
import { rewritePreviewUrls } from "./preview_urls";

describe("web preview URL rewriting", () => {
  it("keeps app-run and app-info URLs on the same public per-app origin", () => {
    const enginePayload = {
      appId: 42,
      app: { proxyUrl: "http://app-42.localhost:42142/" },
      runState: {
        url: {
          appUrl: "http://app-42.localhost:42142/",
          originalUrl: "http://localhost:32142/",
        },
      },
    };

    const rewritten = rewritePreviewUrls(
      enginePayload,
      "workspace-test",
      "localhost",
      "http",
      "8080",
    );
    const origins = [
      rewritten.app.proxyUrl,
      rewritten.runState.url.appUrl,
      rewritten.runState.url.originalUrl,
    ].map((url) => new URL(url).origin);

    expect(origins).toEqual([
      "http://app-42.localhost:8080",
      "http://app-42.localhost:8080",
      "http://app-42.localhost:8080",
    ]);
  });
});

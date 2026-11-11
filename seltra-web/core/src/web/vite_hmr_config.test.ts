import { describe, expect, it } from "vitest";
import { getPublicViteHmrEnvironment } from "./vite_hmr_config";

describe("public Vite HMR address", () => {
  const workspace = "0123456789abcdef";

  it("uses the public preview host and gateway port locally", () => {
    expect(getPublicViteHmrEnvironment({
      DYAD_WEB_RUNTIME: "1",
      DYAD_WORKSPACE_ID: workspace,
      PREVIEW_BASE_DOMAIN: "localhost",
      PREVIEW_PUBLIC_SCHEME: "http",
      PREVIEW_PUBLIC_PORT: "8080",
    }, 42)).toEqual({
      VITE_HMR_HOST: `ws-${workspace}-app-42.localhost`,
      VITE_HMR_CLIENT_PORT: "8080",
      VITE_HMR_PROTOCOL: "ws",
      VITE_HMR_PATH: "/",
    });
  });

  it("uses wss and 443 in production, never the app port", () => {
    const result = getPublicViteHmrEnvironment({
      DYAD_WEB_RUNTIME: "1",
      DYAD_WORKSPACE_ID: workspace,
      PREVIEW_BASE_DOMAIN: "preview.seltra.co",
      PREVIEW_PUBLIC_SCHEME: "https",
    }, 42);
    expect(result).toMatchObject({
      VITE_HMR_HOST: `ws-${workspace}-app-42.preview.seltra.co`,
      VITE_HMR_CLIENT_PORT: "443",
      VITE_HMR_PROTOCOL: "wss",
    });
    expect(result.VITE_HMR_HOST).not.toContain("localhost:32142");
  });
});

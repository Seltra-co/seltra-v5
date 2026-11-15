import { describe, expect, it } from "vitest";
import { getPublicViteHmrEnvironment } from "./vite_hmr_config";

describe("public Vite HMR address", () => {
  it("keeps preview HMR disabled behind the sandbox gateway", () => {
    expect(getPublicViteHmrEnvironment({
      DYAD_WEB_RUNTIME: "1",
      DYAD_WORKSPACE_ID: "0123456789abcdef",
      PREVIEW_BASE_DOMAIN: "localhost",
      PREVIEW_PUBLIC_SCHEME: "http",
      PREVIEW_PUBLIC_PORT: "8080",
    }, 42)).toEqual({});
    expect(getPublicViteHmrEnvironment({
      DYAD_WEB_RUNTIME: "1",
      DYAD_WORKSPACE_ID: "0123456789abcdef",
      PREVIEW_BASE_DOMAIN: "preview.seltra.co",
      PREVIEW_PUBLIC_SCHEME: "https",
    }, 42)).toEqual({});
  });
});

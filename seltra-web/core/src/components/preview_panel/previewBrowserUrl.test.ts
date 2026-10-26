import { describe, expect, it, vi } from "vitest";
import {
  resolvePreviewBrowserUrl,
  withPreviewAttributionDismissed,
} from "./previewBrowserUrl";

describe("resolvePreviewBrowserUrl", () => {
  it("returns a cloud share link instead of the raw preview URL", async () => {
    const createCloudSandboxShareLink = vi
      .fn()
      .mockResolvedValue({ url: "https://dyad.sh/share/sandbox-1" });

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: true,
        selectedAppId: 42,
        appUrl: "https://preview.internal.test",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("https://dyad.sh/share/sandbox-1");

    expect(createCloudSandboxShareLink).toHaveBeenCalledWith({
      appId: 42,
    });
  });

  it("returns the existing preview URL for non-cloud previews", async () => {
    const createCloudSandboxShareLink = vi.fn();

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: false,
        selectedAppId: null,
        appUrl: "http://app-42.localhost:42142",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("http://app-42.localhost:42142");

    expect(createCloudSandboxShareLink).not.toHaveBeenCalled();
  });

  it("throws when cloud preview browser open is requested without an app id", async () => {
    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: true,
        selectedAppId: null,
        appUrl: "https://preview.internal.test",
        createCloudSandboxShareLink: vi.fn(),
      }),
    ).rejects.toThrow("Cloud sandbox is not running.");
  });
});

describe("withPreviewAttributionDismissed", () => {
  it("preserves the preview route and query while carrying the dismissal", () => {
    expect(
      withPreviewAttributionDismissed(
        "http://app-42.localhost:42142/products?category=tea",
      ),
    ).toBe(
      "http://app-42.localhost:42142/products?category=tea&__seltra_attribution_dismissed=1",
    );
  });
});

import { describe, expect, it, vi } from "vitest";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { throwBridgeRpcError } from "./bridge_errors";

describe("web bridge RPC failures", () => {
  it("shows UnsupportedInWebError as a toast and preserves its error code", () => {
    let thrown: (Error & { code?: string }) | undefined;
    try {
      throwBridgeRpcError(
        "UNSUPPORTED_IN_WEB",
        "Folder import is unavailable in the browser.",
      );
    } catch (error) {
      thrown = error as Error & { code?: string };
    }
    expect(thrown).toMatchObject({
      message: "Folder import is unavailable in the browser.",
      code: "UNSUPPORTED_IN_WEB",
    });
    expect(toastError).toHaveBeenCalledWith(
      "Folder import is unavailable in the browser.",
    );
  });
});

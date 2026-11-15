import { describe, expect, it } from "vitest";
import { frameAncestors } from "./frame_ancestors.js";

describe("preview frame ancestors", () => {
  it("omits IPv6 loopback while preserving other configured origins", () => {
    expect(
      frameAncestors([
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
      ]),
    ).toBe("'self' http://localhost:3000 http://127.0.0.1:3000");
  });
});

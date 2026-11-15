import { describe, expect, it } from "vitest";
import { isImageGenerationRoute } from "./image_generation_route.js";

describe("image generation route", () => {
  it("accepts the unversioned and OpenAI-compatible versioned paths", () => {
    expect(isImageGenerationRoute("POST", "/images/generations")).toBe(true);
    expect(isImageGenerationRoute("POST", "/v1/images/generations")).toBe(true);
  });

  it("rejects other methods and paths", () => {
    expect(isImageGenerationRoute("GET", "/v1/images/generations")).toBe(false);
    expect(isImageGenerationRoute("POST", "/v1/images")).toBe(false);
  });
});

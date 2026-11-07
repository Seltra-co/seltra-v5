import { describe, expect, it } from "vitest";
import { isPrimaryGatewayHost } from "./primary_gateway_host";

const baseConfig = {
  GATEWAY_HOST: "127.0.0.1",
  GATEWAY_PUBLIC_HOSTS: "",
  PREVIEW_BASE_DOMAIN: "localhost",
  CORE_PUBLIC_URL: "https://example.trycloudflare.com",
};

describe("isPrimaryGatewayHost", () => {
  it("treats the configured Core public URL host as the primary builder host", () => {
    expect(
      isPrimaryGatewayHost("example.trycloudflare.com:8080", baseConfig),
    ).toBe(true);
  });

  it("continues to accept explicitly configured public hosts", () => {
    expect(
      isPrimaryGatewayHost("builder.example.com", {
        ...baseConfig,
        GATEWAY_PUBLIC_HOSTS: "builder.example.com,other.example.com",
      }),
    ).toBe(true);
  });

  it("rejects an unrelated host", () => {
    expect(isPrimaryGatewayHost("unrelated.example.com", baseConfig)).toBe(
      false,
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { probeWorkspacePreviewStatus } from "./preview_probe.js";

describe("probeWorkspacePreviewStatus", () => {
  it("uses the signed Cloudflare preview route", async () => {
    const signRequest = vi.fn(() => ({ "x-sandbox-signature": "signed" }));
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(null, { status: 200 });
    };

    const status = await probeWorkspacePreviewStatus(
      {
        baseUrl: "https://gateway.example/v1/workspaces/key/runtime",
        rpcSecret: "rpc-secret",
        workspaceKey: "a".repeat(12),
        signGatewayRequest: signRequest,
      },
      7,
      fetcher,
    );

    expect(status).toBe(200);
    expect(requestedUrl).toBe(
      "https://gateway.example/v1/workspaces/aaaaaaaaaaaa/preview/7/",
    );
    expect(requestedInit?.redirect).toBe("manual");
    expect(signRequest).toHaveBeenCalledWith(
      "GET",
      "/v1/workspaces/aaaaaaaaaaaa/preview/7/",
    );
  });

  it("probes only a validated loopback preview target", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requested.push(String(input));
      if (requested.length === 1) {
        return Response.json({
          appId: 7,
          host: "127.0.0.1",
          port: 4321,
          previewHost: "app-7.localhost",
        });
      }
      return new Response(null, { status: 200 });
    };

    const status = await probeWorkspacePreviewStatus(
      {
        baseUrl: "http://127.0.0.1:8081",
        rpcSecret: "rpc-secret",
        workspaceKey: "a".repeat(12),
      },
      7,
      fetcher,
    );

    expect(status).toBe(200);
    expect(requested).toEqual([
      "http://127.0.0.1:8081/internal/preview-target/7",
      "http://127.0.0.1:4321/",
    ]);
  });

  it("does not probe an unsafe local preview target", async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return Response.json({
        appId: 7,
        host: "203.0.113.1",
        port: 4321,
        previewHost: "app-7.localhost",
      });
    };

    const status = await probeWorkspacePreviewStatus(
      {
        baseUrl: "http://127.0.0.1:8081",
        rpcSecret: "rpc-secret",
        workspaceKey: "a".repeat(12),
      },
      7,
      fetcher,
    );

    expect(status).toBe(0);
    expect(requests).toBe(1);
  });
});

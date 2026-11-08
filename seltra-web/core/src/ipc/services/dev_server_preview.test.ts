import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  DevServerUrlScanner,
  expectedPortDevServerUrl,
  listenForDevServerUrls,
  probeDevServer,
  probeDevServerUntilReady,
  probeExpectedDevServerPort,
} from "./dev_server_preview";

const viteReadyOutput =
  "  VITE v8.0.10  ready in 497 ms\r\n  ➜  Local:   http://localhost:32101/\r\n  ➜  Network: http://10.0.0.1:32101/\r\n";

describe("Vite dev server URL detection", () => {
  it("detects the real Vite 8 ready output when URL bytes are split across chunks", () => {
    const scanner = new DevServerUrlScanner();
    const output = "  VITE v8.0.10  ready in 497 ms\r\n  ➜  Local:   http://localhost:32101/\r\n";
    const first = scanner.push(output.slice(0, output.indexOf("32101")));
    const second = scanner.push(output.slice(output.indexOf("32101")));

    expect([...first, ...second]).toEqual(["http://localhost:32101/"]);
  });

  it("strips ANSI styling, including bold styling inside the Vite port", () => {
    const scanner = new DevServerUrlScanner();
    const ansiOutput = viteReadyOutput
      .replace("VITE v8.0.10", "\u001b[1mVITE v8.0.10\u001b[22m")
      .replace("Local:", "\u001b[36mLocal:\u001b[39m")
      .replace("32101", "\u001b[1m32101\u001b[22m");

    expect(scanner.push(ansiOutput)).toContain("http://localhost:32101/");
  });

  it("removes an ANSI sequence split across output chunks before matching", () => {
    const scanner = new DevServerUrlScanner();
    scanner.push("  VITE v8.0.10 ready in 497 ms\r\n  ➜ Local: \u001b[4");

    expect(scanner.push("mhttp://localhost:32101/\u001b[24m\r\n")).toContain(
      "http://localhost:32101/",
    );
  });

  it("detects plain Vite 8.0.10 output without ANSI codes", () => {
    expect(new DevServerUrlScanner().push(viteReadyOutput)).toContain(
      "http://localhost:32101/",
    );
  });

  it("scans output buffered before the data listener attaches", async () => {
    const stream = new PassThrough();
    const scanner = new DevServerUrlScanner();
    const detected: string[] = [];
    stream.write(viteReadyOutput);
    listenForDevServerUrls(stream, scanner, (url) => detected.push(url));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(detected).toEqual(["http://localhost:32101/"]);
    stream.destroy();
  });

  it("probes both IPv4 and IPv6 loopback and selects the responding address", async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "127.0.0.1") throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      return new Response("<html><div id=\"root\"></div></html>", { status: 200 });
    });

    const result = await probeDevServer("http://localhost:32101/", request);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([input]) => new URL(String(input)).hostname).sort())
      .toEqual(["127.0.0.1", "[::1]"]);
    expect(result).toMatchObject({ host: "::1", status: 200, targetUrl: "http://[::1]:32101/" });
  });

  it("reports failed probes without inventing a preview target", async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new Error("refused"); });

    const result = await probeDevServer("http://localhost:32101/", request);

    expect(result.reason).toBe("loopback_probe_failed");
    expect(result.targetUrl).toBeUndefined();
    expect(result.attempts).toEqual([
      { host: "127.0.0.1", errorClass: "Error" },
      { host: "::1", errorClass: "Error" },
    ]);
  });

  it("retries a slow Vite startup after its initial loopback probe times out", async () => {
    const attempts = new Map<string, number>();
    const request = vi.fn<typeof fetch>(async (input) => {
      const host = new URL(String(input)).hostname;
      const count = (attempts.get(host) ?? 0) + 1;
      attempts.set(host, count);
      if (count === 1) throw new DOMException("startup still warming", "TimeoutError");
      return new Response("ok", { status: 200 });
    });

    const result = await probeDevServerUntilReady("http://localhost:32101/", request, {
      attempts: 2,
      delayMs: 0,
      timeoutMs: 10,
    });

    expect(result).toMatchObject({ targetUrl: "http://127.0.0.1:32101/", status: 200 });
    expect(attempts.get("127.0.0.1")).toBe(2);
    expect(attempts.get("[::1]")).toBe(2);
  });

  it("detects a preview by expected port when output has no URL match", async () => {
    const scanner = new DevServerUrlScanner();
    expect(scanner.push("VITE v8.0.10 ready in 497 ms; Local URL unavailable")).toEqual([]);
    const request = vi.fn<typeof fetch>(async () => new Response("ok", { status: 200 }));

    expect(expectedPortDevServerUrl(32101)).toBe("http://localhost:32101/");
    const result = await probeExpectedDevServerPort(32101, request, {
      attempts: 1,
      timeoutMs: 10,
    });

    expect(result.targetUrl).toBe("http://127.0.0.1:32101/");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

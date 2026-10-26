import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { request as httpRequest } from "node:http";
import { ipcMain, resetForTesting } from "./electron-shim";
import {
  createRpcServer,
  isAllowedMachineChannel,
  rewritePreviewUrls,
} from "./rpc_server";
import {
  CHANNEL_POLICY,
  getChannelPolicy,
  isWebChannelAllowed,
} from "./channel_policy";
import {
  VALID_INVOKE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "../ipc/preload/channels";

function post(url: string, headers: Record<string, string>, body: string) {
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: "POST", headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              json: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

describe("web RPC server", () => {
  it("allows only renderer-used local distributed machine channels", () => {
    for (const channel of [
      "distributed-machine:subscribe",
      "distributed-machine:dispatch",
      "distributed-machine:unsubscribe",
    ]) {
      expect(
        isAllowedMachineChannel(channel, [{ machineId: "chat_stream" }]),
      ).toBe(true);
      expect(isAllowedMachineChannel(channel, [{ machineId: "app_run" }])).toBe(
        true,
      );
      expect(
        isAllowedMachineChannel(channel, [{ machineId: "image_generation" }]),
      ).toBe(true);
      expect(
        isAllowedMachineChannel(channel, [{ machineId: "version_preview" }]),
      ).toBe(true);
      expect(
        isAllowedMachineChannel(channel, [{ machineId: "plan_handoff" }]),
      ).toBe(true);
      expect(
        isAllowedMachineChannel(channel, [{ machineId: "github_ops" }]),
      ).toBe(false);
      expect(
        isAllowedMachineChannel(channel, [{ machineId: "remote_test" }]),
      ).toBe(false);
    }
  });

  it("permits preview-interest cleanup while keeping other release operations disabled", () => {
    expect(isWebChannelAllowed("version-preview:release-window-interest")).toBe(
      true,
    );
    expect(isWebChannelAllowed("version:release-to-message")).toBe(false);
    expect(isWebChannelAllowed("recording:stop")).toBe(false);
  });

  it("rewrites only localhost preview fields at the gateway boundary", () => {
    expect(
      rewritePreviewUrls(
        {
          app: { appId: 42, proxyUrl: "http://localhost:42101/" },
          cloudPreviewUrl: "http://localhost:42102/",
          callback: "http://localhost:1455/auth/callback",
        },
        "workspace-123",
        "localhost",
        "http",
        "8080",
      ),
    ).toEqual({
      app: { appId: 42, proxyUrl: "http://app-42.localhost:8080/" },
      cloudPreviewUrl: "http://localhost:42102/",
      callback: "http://localhost:1455/auth/callback",
    });
  });
  it("gives every preview URL in an engine payload the same per-app origin", () => {
    const payload = rewritePreviewUrls(
      {
        appId: 77,
        appInfo: { appId: 77, proxyUrl: "http://localhost:42177/" },
        previewUrl: "http://app-77.localhost:32177/",
        unrelatedUrl: "http://localhost:1455/auth/callback",
      },
      "workspace-abc",
      "localhost",
      "http",
      "8080",
    );
    const urls = [payload.appInfo.proxyUrl, payload.previewUrl].map(
      (url) => new URL(url),
    );
    expect(new Set(urls.map((url) => url.origin))).toEqual(
      new Set(["http://app-77.localhost:8080"]),
    );
    expect(payload.unrelatedUrl).toBe("http://localhost:1455/auth/callback");
  });
  afterEach(() => resetForTesting());

  it("classifies every preload invoke and send channel", () => {
    expect(CHANNEL_POLICY.length).toBeGreaterThan(0);
    for (const channel of [...VALID_INVOKE_CHANNELS, ...VALID_SEND_CHANNELS]) {
      expect(getChannelPolicy(channel), channel).toBeDefined();
    }
    expect(getChannelPolicy("get-language-models")?.class).toBe("PORT");
    expect(getChannelPolicy("set-app-theme")?.class).toBe("SANDBOX");
    expect(isWebChannelAllowed("set-app-theme")).toBe(true);
    expect(getChannelPolicy("does-release-note-exist")?.class).toBe("DISABLE");
    expect(getChannelPolicy("unknown:channel")).toBeUndefined();
  });

  it("authenticates RPC and routes events to the connected session only", async () => {
    ipcMain.handle("get-app", (event, input) => {
      event.sender.send("chat:response:chunk", { text: "hi" });
      return { id: 1, inputWasUndefined: input === undefined };
    });
    const rpc = createRpcServer({ secret: "test-secret", port: 0 });
    await new Promise<void>((resolve) => rpc.server.once("listening", resolve));
    const address = rpc.address();
    if (!address || typeof address === "string")
      throw new Error("No TCP address");
    const base = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: "Bearer test-secret" };
    const events = new WebSocket(`ws://127.0.0.1:${address.port}/events`, {
      headers: auth,
    });
    const frames: Array<{ channel: string; payload: unknown }> = [];
    events.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => events.once("open", resolve));
    await vi.waitFor(() => expect(frames[0]?.channel).toBe("web:session"));
    const sessionId = (frames[0].payload as { id: string }).id;
    const response = await post(
      `${base}/rpc/get-app`,
      {
        ...auth,
        "content-type": "application/json",
        "x-runtime-session": sessionId,
      },
      JSON.stringify({ args: [1] }),
    );
    expect(response.json).toEqual({
      ok: true,
      result: { id: 1, inputWasUndefined: false },
    });
    const undefinedInput = await post(
      `${base}/rpc/get-app`,
      {
        ...auth,
        "content-type": "application/json",
        "x-runtime-session": sessionId,
      },
      JSON.stringify({ args: [null], undefinedArgs: [0] }),
    );
    expect(undefinedInput.json).toEqual({
      ok: true,
      result: { id: 1, inputWasUndefined: true },
    });
    await vi.waitFor(() =>
      expect(
        frames.some((frame) => frame.channel === "chat:response:chunk"),
      ).toBe(true),
    );

    const unauthorized = await post(`${base}/rpc/get-app`, {}, "{}");
    expect(unauthorized.status).toBe(401);
    const disabled = await post(
      `${base}/rpc/release-notes`,
      {
        ...auth,
        "content-type": "application/json",
        "x-runtime-session": sessionId,
      },
      JSON.stringify({ args: [] }),
    );
    expect(disabled.status).toBe(403);
    events.close();
    await rpc.close();
  });

  it("stops waiting at the channel timeout and binds only to loopback", async () => {
    ipcMain.handle("get-app", () => new Promise(() => undefined));
    expect(() =>
      createRpcServer({ secret: "secret", host: "0.0.0.0" }),
    ).toThrow(/loopback/);
    const rpc = createRpcServer({
      secret: "secret",
      port: 0,
      defaultTimeoutMs: 10,
    });
    await new Promise<void>((resolve) => rpc.server.once("listening", resolve));
    const address = rpc.address();
    if (!address || typeof address === "string")
      throw new Error("No TCP address");
    let sessionId = "";
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/events`, {
      headers: { authorization: "Bearer secret" },
    });
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.channel === "web:session") sessionId = frame.payload.id;
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    await vi.waitFor(() => expect(sessionId).not.toBe(""));
    const response = await post(
      `http://127.0.0.1:${address.port}/rpc/get-app`,
      {
        authorization: "Bearer secret",
        "content-type": "application/json",
        "x-runtime-session": sessionId,
      },
      JSON.stringify({ args: [1] }),
    );
    expect(response.status).toBe(504);
    expect(response.json).toMatchObject({
      ok: false,
      error: { code: "TIMEOUT" },
    });
    socket.close();
    await rpc.close();
  });
});

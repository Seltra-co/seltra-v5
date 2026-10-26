import { afterEach, describe, expect, it, vi } from "vitest";
import { themesData } from "../../shared/themes";

describe("web bridge runtime session startup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits for the WebSocket session before sending the first RPC", async () => {
    const sockets: {
      onmessage?: (event: { data: unknown }) => void;
      onclose?: (event: { code: number; reason: string }) => void;
      onerror?: () => void;
      close: () => void;
    }[] = [];
    let socket:
      | {
          onmessage?: (event: { data: unknown }) => void;
          onclose?: (event: { code: number; reason: string }) => void;
          onerror?: () => void;
          close: () => void;
        }
      | undefined;
    class FakeWebSocket {
      onmessage?: (event: { data: unknown }) => void;
      onclose?: (event: { code: number; reason: string }) => void;
      onerror?: () => void;
      close() {}

      constructor() {
        socket = this;
        sockets.push(this);
      }
    }
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true, result: { headers: init.headers } }),
    }));
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();

    await import("./install_bridge");
    const bridgeWindow = window as unknown as Window & {
      electron: {
        ipcRenderer: {
          invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
        };
      };
    };
    const request = bridgeWindow.electron.ipcRenderer.invoke(
      "window-infrastructure:bootstrap",
      {},
    );
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    socket?.onclose?.({ code: 1006, reason: "test socket reset" });
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(sockets).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();

    socket?.onmessage?.({
      data: new Blob([
        JSON.stringify({
          channel: "web:session",
          payload: { id: "runtime-session-1" },
        }),
      ]),
    });

    await expect(request).resolves.toMatchObject({
      headers: expect.objectContaining({
        "x-runtime-session": "runtime-session-1",
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callsBeforeLocalFallbacks = fetchMock.mock.calls.length;
    await expect(
      bridgeWindow.electron.ipcRenderer.invoke("get-themes"),
    ).resolves.toEqual(themesData);
    await expect(
      bridgeWindow.electron.ipcRenderer.invoke("get-custom-themes"),
    ).resolves.toEqual([]);
    await expect(
      bridgeWindow.electron.ipcRenderer.invoke("codex-subscription:status"),
    ).resolves.toMatchObject({ connected: false, models: [] });
    await expect(
      bridgeWindow.electron.ipcRenderer.invoke(
        "get-initial-load-telemetry-context",
      ),
    ).resolves.toEqual({ isFirstSession: false });
    await expect(
      bridgeWindow.electron.ipcRenderer.invoke("get-subscription-status"),
    ).resolves.toBeNull();
    await expect(
      bridgeWindow.electron.ipcRenderer.invoke("connection-flow:get-states"),
    ).resolves.toEqual({
      github: { status: "disconnected", revision: 0 },
      supabase: { status: "disconnected", revision: 0 },
      neon: { status: "disconnected", revision: 0 },
    });
    await expect(
      bridgeWindow.electron.ipcRenderer.invoke("native-theme:get-state"),
    ).resolves.toEqual({ shouldUseDarkColors: false });
    await expect(
      bridgeWindow.electron.ipcRenderer.invoke(
        "free-agent-quota:get-status",
        undefined,
      ),
    ).resolves.toMatchObject({ messagesUsed: 0, isQuotaExceeded: false });
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeLocalFallbacks);
    await bridgeWindow.electron.ipcRenderer.invoke(
      "get-user-budget",
      undefined,
    );
    const serializedRequest = JSON.parse(
      String(fetchMock.mock.calls[1][1].body),
    ) as { args: unknown[]; undefinedArgs: number[] };
    expect(serializedRequest).toEqual({ args: [null], undefinedArgs: [0] });

    await bridgeWindow.electron.ipcRenderer.invoke(
      "distributed-machine:subscribe",
      { machineId: "plan_handoff", key: { chatId: 7 } },
    );
    const requestsBeforeReconnect = fetchMock.mock.calls.length;
    sockets[1].onclose?.({ code: 1009, reason: "Backpressure limit exceeded" });
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(sockets).toHaveLength(3);
    sockets[2].onmessage?.({
      data: JSON.stringify({
        channel: "web:session",
        payload: { id: "runtime-session-2" },
      }),
    });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeReconnect + 1),
    );
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain(
      "distributed-machine%3Asubscribe",
    );

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    socket?.onmessage?.({ data: "not-json" });
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(consoleError.mock.calls[0][0]).toBe(
      "[seltra-bridge] unparseable event frame",
    );
    consoleError.mockRestore();
  }, 20_000);
});

import {
  VALID_INVOKE_CHANNELS,
  VALID_RECEIVE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "@/ipc/preload/channels";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { throwBridgeRpcError } from "./bridge_errors";
import { openWebExternalUrl } from "./open_external_url";
import { themesData } from "../../shared/themes";

type Listener = (...args: unknown[]) => void;
type Bridge = {
  ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    invokeEnvelope(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
    on(channel: string, listener: Listener): () => void;
    removeAllListeners(channel: string): void;
    removeListener(channel: string, listener: Listener): void;
  };
  webFrame: { setZoomFactor(factor: number): void; getZoomFactor(): number };
};

declare global {
  interface Window {
    __SELTRA_WEB__?: boolean;
    __SELTRA_CONFIG__?: { gatewayBaseUrl?: string; rpcPathPrefix?: string };
  }
}

const invokeChannels = new Set<string>(VALID_INVOKE_CHANNELS);
const sendChannels = new Set<string>(VALID_SEND_CHANNELS);
const receiveChannels = new Set<string>(VALID_RECEIVE_CHANNELS);
const isDynamicReceive = (channel: string) =>
  channel.startsWith("terminal:data:") || channel.startsWith("terminal:exit:");

function getLocalWebResult(channel: string): {
  handled: boolean;
  value?: unknown;
} {
  switch (channel) {
    case "get-themes":
      return { handled: true, value: themesData };
    case "get-custom-themes":
      return { handled: true, value: [] };
    case "local-models:list-ollama":
    case "local-models:list-lmstudio":
      return { handled: true, value: [] };
    case "connection-flow:get-states": {
      const disconnected = { status: "disconnected", revision: 0 } as const;
      return {
        handled: true,
        value: {
          github: disconnected,
          supabase: disconnected,
          neon: disconnected,
        },
      };
    }
    case "get-app-theme":
      return { handled: true, value: null };
    case "get-codex-subscription-status":
    case "codex-subscription:status":
      return {
        handled: true,
        value: {
          connected: false,
          pending: false,
          models: [],
          limitReached: false,
          windows: [],
        },
      };
    case "get-initial-load-telemetry-context":
      return { handled: true, value: { isFirstSession: false } };
    case "get-subscription-status":
      return { handled: true, value: null };
    case "native-theme:get-state":
      return { handled: true, value: { shouldUseDarkColors: false } };
    case "free-agent-quota:get-status":
      return {
        handled: true,
        value: {
          messagesUsed: 0,
          messagesLimit: 5,
          isQuotaExceeded: false,
          windowStartTime: null,
          resetTime: null,
          hoursUntilReset: null,
        },
      };
    default:
      return { handled: false };
  }
}

export function installBridge(): void {
  window.__SELTRA_WEB__ = true;
  if ((window as Window & { electron?: Bridge }).electron) return;
  const listeners = new Map<string, Set<Listener>>();
  const activeChats = new Map<
    string,
    {
      chatId: string;
      invocationRef: { kind: string; entityKey: number; operationId: string };
    }
  >();
  const machineSubscriptions = new Map<string, unknown[]>();
  const pending = new Set<AbortController>();
  const sessionPending = new Set<AbortSignal>();
  const sessionWaiters = new Set<{
    resolve: (sessionId: string) => void;
    reject: (error: Error) => void;
  }>();
  const prefix = window.__SELTRA_CONFIG__?.rpcPathPrefix ?? "";
  const base =
    window.__SELTRA_CONFIG__?.gatewayBaseUrl ?? window.location.origin;
  let sessionId: string | undefined;
  let sessionOpenedAt: number | undefined;
  let socket: WebSocket | undefined;
  let stopped = false;
  let retry = 250;
  let zoom = 1;
  let reconnectTimer: number | undefined;

  const dispatch = (channel: string, args: unknown[]) => {
    for (const callback of [...(listeners.get(channel) ?? [])])
      callback(...args);
  };
  const announceConnection = (status: "connecting" | "connected") => {
    window.dispatchEvent(
      new CustomEvent("seltra:web-connection", { detail: { status } }),
    );
  };
  const failChats = () => {
    for (const [key, chat] of activeChats) {
      dispatch("chat:response:error", [
        {
          ...chat,
          error:
            "Connection lost while the chat response was streaming. Reconnect and try again.",
        },
      ]);
      activeChats.delete(key);
    }
  };
  const connect = () => {
    if (stopped) return;
    announceConnection("connecting");
    const url = new URL(`${prefix}/events`, base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onmessage = async (event) => {
      let frame: { channel?: string; payload?: unknown };
      try {
        const raw =
          typeof event.data === "string"
            ? event.data
            : event.data instanceof Blob
              ? await event.data.text()
              : new TextDecoder().decode(event.data as ArrayBuffer);
        frame = JSON.parse(raw);
      } catch (error) {
        console.error("[seltra-bridge] unparseable event frame", error);
        return;
      }
      if (frame.channel === "web:session") {
        sessionId = (frame.payload as { id?: string } | undefined)?.id;
        if (sessionId) {
          announceConnection("connected");
          sessionOpenedAt = Date.now();
          console.info(
            JSON.stringify({
              event: "websocket_session_connected",
              endpoint: "/api/events",
            }),
          );
          for (const waiter of sessionWaiters) waiter.resolve(sessionId);
          sessionWaiters.clear();
        }
        retry = 250;
        queueMicrotask(() => {
          for (const args of machineSubscriptions.values())
            void request("distributed-machine:subscribe", args).catch(
              () => undefined,
            );
        });
        return;
      }
      if (!frame.channel) return;
      dispatch(frame.channel, [frame.payload]);
      if (
        frame.channel === "chat:response:end" ||
        frame.channel === "chat:response:error"
      ) {
        const payload = frame.payload as
          | { chatId?: string; invocationRef?: { operationId?: string } }
          | undefined;
        if (payload?.chatId && payload.invocationRef?.operationId)
          activeChats.delete(
            `${payload.chatId}:${payload.invocationRef.operationId}`,
          );
      }
    };
    socket.onclose = (event) => {
      console.info(
        JSON.stringify({
          event: "websocket_close",
          endpoint: "/api/events",
          who: "browser",
          code: event.code,
          reason: event.reason.slice(0, 120),
          sessionAgeMs: sessionOpenedAt
            ? Date.now() - sessionOpenedAt
            : undefined,
          bufferedBytes: socket?.bufferedAmount ?? 0,
        }),
      );
      sessionId = undefined;
      sessionOpenedAt = undefined;
      for (const controller of pending) {
        if (!sessionPending.has(controller.signal))
          controller.abort(new Error("Connection lost"));
      }
      pending.clear();
      failChats();
      announceConnection("connecting");
      const delay = retry;
      retry = Math.min(retry * 2, 10_000);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };
    socket.onerror = () => socket?.close();
  };
  const connectNow = () => {
    if (
      stopped ||
      socket?.readyState === WebSocket.CONNECTING ||
      socket?.readyState === WebSocket.OPEN
    )
      return;
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    retry = 250;
    connect();
  };
  window.addEventListener("seltra:web-retry-connection", connectNow);
  connect();

  const waitForSession = (signal: AbortSignal): Promise<string> => {
    if (sessionId) return Promise.resolve(sessionId);
    return new Promise((resolve, reject) => {
      let timeout: number | undefined;
      const finish = (error?: Error, readySessionId?: string) => {
        if (timeout !== undefined) window.clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        sessionWaiters.delete(waiter);
        sessionPending.delete(signal);
        if (error) reject(error);
        else resolve(readySessionId!);
      };
      const onAbort = () => finish(new Error("Runtime connection was aborted"));
      const waiter = {
        resolve: (readySessionId: string) => finish(undefined, readySessionId),
        reject: (error: Error) => finish(error),
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      sessionWaiters.add(waiter);
      sessionPending.add(signal);
      signal.addEventListener("abort", onAbort, { once: true });
      timeout = window.setTimeout(
        () => finish(new Error("Runtime did not reconnect within 60 seconds")),
        60_000,
      );
      if (sessionId) waiter.resolve(sessionId);
    });
  };

  const request = async (channel: string, args: unknown[]) => {
    const localResult = getLocalWebResult(channel);
    if (localResult.handled) return localResult.value;
    const controller = new AbortController();
    pending.add(controller);
    try {
      const activeSessionId = await waitForSession(controller.signal);
      const response = await fetch(
        `${base}${prefix}/rpc/${encodeURIComponent(channel)}`,
        {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-runtime-session": activeSessionId,
          },
          body: JSON.stringify({
            args,
            undefinedArgs: args.flatMap((arg, index) =>
              arg === undefined ? [index] : [],
            ),
          }),
        },
      );
      const body = (await response.json()) as {
        ok: boolean;
        result?: unknown;
        error?: { message?: string; code?: string };
      };
      if (!response.ok || !body.ok)
        throwBridgeRpcError(
          body.error?.code,
          body.error?.message ?? "Runtime request failed",
        );
      return body.result;
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error(
          "Connection lost while the request was in progress. Please retry.",
        );
      throw error;
    } finally {
      pending.delete(controller);
    }
  };
  const bridge: Bridge = {
    ipcRenderer: {
      invoke: async (channel, ...args) => {
        if (!invokeChannels.has(channel))
          throw new Error(`Invalid channel: ${channel}`);
        if (channel === "open-external-url") {
          openWebExternalUrl(args[0]);
          return;
        }
        const input = args[0] as
          | {
              machineId?: string;
              encodedEvent?: {
                type?: string;
                intent?: {
                  chatId?: string;
                  invocationRef?: { operationId?: string };
                };
              };
            }
          | undefined;
        if (channel === "distributed-machine:subscribe" && input?.machineId)
          machineSubscriptions.set(JSON.stringify(input), args);
        if (channel === "distributed-machine:unsubscribe" && input?.machineId)
          machineSubscriptions.delete(JSON.stringify(input));
        if (
          channel === "distributed-machine:dispatch" &&
          input?.machineId === "chat_stream" &&
          input.encodedEvent?.type === "SUBMIT"
        ) {
          const intent = input.encodedEvent.intent;
          if (intent?.chatId && intent.invocationRef?.operationId)
            activeChats.set(
              `${intent.chatId}:${intent.invocationRef.operationId}`,
              {
                chatId: intent.chatId,
                invocationRef: intent.invocationRef as {
                  kind: string;
                  entityKey: number;
                  operationId: string;
                },
              },
            );
        }
        let response: unknown;
        try {
          response = await request(channel, args);
        } catch (error) {
          if (
            channel === "distributed-machine:dispatch" &&
            input?.encodedEvent?.type === "SUBMIT"
          ) {
            const intent = input.encodedEvent.intent;
            if (intent?.chatId && intent.invocationRef?.operationId)
              activeChats.delete(
                `${intent.chatId}:${intent.invocationRef.operationId}`,
              );
          }
          throw error;
        }
        return isIpcInvokeEnvelope(response)
          ? unwrapIpcEnvelope(response)
          : response;
      },
      invokeEnvelope: (channel, ...args) => {
        if (!invokeChannels.has(channel))
          throw new Error(`Invalid channel: ${channel}`);
        if (channel === "open-external-url") {
          try {
            openWebExternalUrl(args[0]);
            return Promise.resolve(undefined);
          } catch (error) {
            return Promise.reject(error);
          }
        }
        const input = args[0] as
          | {
              machineId?: string;
              encodedEvent?: {
                type?: string;
                intent?: {
                  chatId?: string;
                  invocationRef?: {
                    kind: string;
                    entityKey: number;
                    operationId: string;
                  };
                };
              };
            }
          | undefined;
        if (
          channel === "distributed-machine:subscribe" &&
          input?.machineId === "chat_stream"
        )
          machineSubscriptions.set(JSON.stringify(input), args);
        if (
          channel === "distributed-machine:unsubscribe" &&
          input?.machineId === "chat_stream"
        )
          machineSubscriptions.delete(JSON.stringify(input));
        if (
          channel === "distributed-machine:dispatch" &&
          input?.machineId === "chat_stream" &&
          input.encodedEvent?.type === "SUBMIT"
        ) {
          const intent = input.encodedEvent.intent;
          if (intent?.chatId && intent.invocationRef?.operationId) {
            activeChats.set(
              `${intent.chatId}:${intent.invocationRef.operationId}`,
              {
                chatId: intent.chatId,
                invocationRef: intent.invocationRef,
              },
            );
          }
        }
        return request(channel, args).catch((error) => {
          if (
            channel === "distributed-machine:dispatch" &&
            input?.encodedEvent?.type === "SUBMIT"
          ) {
            const intent = input.encodedEvent.intent;
            if (intent?.chatId && intent.invocationRef?.operationId)
              activeChats.delete(
                `${intent.chatId}:${intent.invocationRef.operationId}`,
              );
          }
          throw error;
        });
      },
      send: (channel, ...args) => {
        if (!sendChannels.has(channel))
          throw new Error(`Invalid channel: ${channel}`);
        void request(channel, args).catch((error) =>
          dispatch("web:bridge-error", [error]),
        );
      },
      on: (channel, callback) => {
        if (!receiveChannels.has(channel) && !isDynamicReceive(channel))
          throw new Error(`Invalid channel: ${channel}`);
        let set = listeners.get(channel);
        if (!set) listeners.set(channel, (set = new Set()));
        set.add(callback);
        return () => bridge.ipcRenderer.removeListener(channel, callback);
      },
      removeAllListeners: (channel) => {
        listeners.delete(channel);
      },
      removeListener: (channel, callback) => {
        const set = listeners.get(channel);
        set?.delete(callback);
        if (!set?.size) listeners.delete(channel);
      },
    },
    webFrame: {
      setZoomFactor: (factor) => {
        zoom = factor;
        document.documentElement.style.zoom = String(factor);
      },
      getZoomFactor: () => zoom,
    },
  };
  Object.defineProperty(window, "electron", {
    configurable: false,
    enumerable: true,
    value: bridge,
  });
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.removeEventListener("seltra:web-retry-connection", connectNow);
      socket?.close();
      for (const waiter of sessionWaiters)
        waiter.reject(
          new Error("Page closed before runtime connection was ready"),
        );
      sessionWaiters.clear();
      for (const controller of pending) controller.abort();
    },
    { once: true },
  );
}

installBridge();

import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  VALID_INVOKE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "../ipc/preload/channels";
import { isWebChannelAllowed } from "./channel_policy";
import { guardRpcPathArguments } from "./rpc_path_guard";
import { rewritePreviewUrls } from "./preview_urls";
import { runningApps } from "../ipc/utils/process_manager";
import { closeWebSession, ipcMain, type WebSession } from "./electron-shim";

export type RpcServerOptions = {
  secret?: string;
  host?: string;
  port?: number;
  defaultTimeoutMs?: number;
  channelTimeouts?: Record<string, number>;
};

export type RunningRpcServer = {
  server: Server;
  address: () => ReturnType<Server["address"]>;
  close: () => Promise<void>;
};

const abandonedInvocations = new Map<string, { channel: string; at: number }>();

export function getAbandonedRpcInvocations() {
  return [...abandonedInvocations.values()];
}

export { rewritePreviewUrls };

function isAllowed(channel: string): boolean {
  const known =
    (VALID_INVOKE_CHANNELS as readonly string[]).includes(channel) ||
    (VALID_SEND_CHANNELS as readonly string[]).includes(channel);
  return known && isWebChannelAllowed(channel);
}

export function isAllowedMachineChannel(
  channel: string,
  args: unknown[],
): boolean {
  if (!channel.startsWith("distributed-machine:")) return isAllowed(channel);
  if (
    ![
      "distributed-machine:subscribe",
      "distributed-machine:dispatch",
      "distributed-machine:unsubscribe",
    ].includes(channel)
  )
    return false;
  const machineId = (args[0] as { machineId?: unknown } | undefined)?.machineId;
  // These are local renderer/runtime actors for chat, app preview, image
  // generation, version preview, and plan-to-build handoff. Host-only machines
  // such as github_ops stay deny-by-default.
  return [
    "chat_stream",
    "app_run",
    "image_generation",
    "version_preview",
    "plan_handoff",
  ].includes(String(machineId));
}

function authorized(request: IncomingMessage, secret: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024)
      throw Object.assign(new Error("Request body too large"), {
        code: "BODY_TOO_LARGE",
      });
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createRpcServer(
  options: RpcServerOptions = {},
): RunningRpcServer {
  const secret = options.secret ?? process.env.RUNTIME_RPC_SECRET;
  if (!secret) throw new Error("RUNTIME_RPC_SECRET must be configured");
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
  const sockets = new Set<WebSocket>();
  const sessions = new Map<string, WebSession>();
  const chatsBySession = new Map<string, Set<number>>();
  const server = createServer(async (request, response) => {
    if (!authorized(request, secret)) {
      sendJson(response, 401, {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Unauthorized" },
      });
      return;
    }
    const previewTarget = request.url?.match(
      /^\/internal\/preview-target\/(\d+)$/,
    );
    if (request.method === "GET" && previewTarget) {
      const appId = Number(previewTarget[1]);
      const appInfo = runningApps.get(appId);
      if (!appInfo?.proxyUrl) {
        sendJson(response, 404, {
          ok: false,
          error: {
            code: "PREVIEW_NOT_RUNNING",
            message: "Preview is not running.",
          },
        });
        return;
      }
      try {
        const preview = new URL(appInfo.proxyUrl);
        const localHostname =
          preview.hostname === "localhost" ||
          preview.hostname === "127.0.0.1" ||
          preview.hostname === `app-${appId}.localhost`;
        const address = server.address();
        const rpcPort =
          typeof address === "object" && address ? address.port : undefined;
        const port = Number(preview.port);
        if (
          preview.protocol !== "http:" ||
          !localHostname ||
          !Number.isInteger(port) ||
          port < 1024 ||
          port > 65535 ||
          port === rpcPort
        ) {
          sendJson(response, 403, {
            ok: false,
            error: {
              code: "PREVIEW_TARGET_FORBIDDEN",
              message: "Preview target failed runtime validation.",
            },
          });
          return;
        }
        sendJson(response, 200, { appId, host: "127.0.0.1", port });
      } catch {
        sendJson(response, 404, {
          ok: false,
          error: {
            code: "PREVIEW_NOT_RUNNING",
            message: "Preview is not running.",
          },
        });
      }
      return;
    }
    const match = request.url?.match(/^\/rpc\/([^/?#]+)$/);
    if (request.method !== "POST" || !match) {
      sendJson(response, 404, {
        ok: false,
        error: { code: "NOT_FOUND", message: "Not found" },
      });
      return;
    }
    const channel = decodeURIComponent(match[1]);
    let body: { args?: unknown; undefinedArgs?: unknown };
    try {
      body = (await readBody(request)) as { args?: unknown };
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: { code: "INVALID_REQUEST", message: (error as Error).message },
      });
      return;
    }
    if (
      !Array.isArray(body?.args) ||
      !isAllowedMachineChannel(channel, body.args)
    ) {
      sendJson(response, 403, {
        ok: false,
        error: {
          code: "CHANNEL_DISABLED",
          message: "This IPC channel is unavailable in the web runtime",
        },
      });
      return;
    }
    if (Array.isArray(body.undefinedArgs)) {
      for (const index of body.undefinedArgs) {
        if (Number.isInteger(index) && index >= 0 && index < body.args.length)
          body.args[index] = undefined;
      }
    }
    const sessionId = request.headers["x-runtime-session"];
    const session =
      typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!session) {
      sendJson(response, 400, {
        ok: false,
        error: {
          code: "SESSION_REQUIRED",
          message: "Connect to /events and supply x-runtime-session",
        },
      });
      return;
    }
    const abort = new AbortController();
    let timedOut = false;
    let settled = false;
    let invocationId: string | undefined;
    let invocation: Promise<unknown> | undefined;
    let timeout: NodeJS.Timeout | undefined;
    const dispatchedChatId =
      channel === "distributed-machine:dispatch" &&
      (
        body.args[0] as
          | { machineId?: unknown; encodedKey?: { chatId?: unknown } }
          | undefined
      )?.machineId === "chat_stream"
        ? (body.args[0] as { encodedKey?: { chatId?: unknown } }).encodedKey
            ?.chatId
        : undefined;
    let chatCancelStarted = false;
    const cancelDispatchedChat = () => {
      if (chatCancelStarted || typeof dispatchedChatId !== "number") return;
      chatCancelStarted = true;
      void ipcMain
        .invoke("chat:cancel", [dispatchedChatId], {
          session,
          signal: new AbortController().signal,
        })
        .catch(() => undefined);
    };
    const abandon = (reason: "timeout" | "disconnect") => {
      if (settled || !invocation || !invocationId) return;
      if (!abandonedInvocations.has(invocationId)) {
        abandonedInvocations.set(invocationId, { channel, at: Date.now() });
        while (abandonedInvocations.size > 1000) {
          abandonedInvocations.delete(
            abandonedInvocations.keys().next().value!,
          );
        }
        console.warn("Abandoned RPC invocation", { channel, reason });
      }
    };
    const abortOnDisconnect = () => {
      abandon("disconnect");
      abort.abort(new Error("RPC client disconnected"));
      cancelDispatchedChat();
    };
    request.once("aborted", abortOnDisconnect);
    response.once("close", () => {
      if (!response.writableEnded) abortOnDisconnect();
    });
    try {
      try {
        await guardRpcPathArguments(channel, body.args);
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: { code: "INVALID_REQUEST", message: (error as Error).message },
        });
        return;
      }
      const isInvoke = (VALID_INVOKE_CHANNELS as readonly string[]).includes(
        channel,
      );
      if (typeof dispatchedChatId === "number") {
        chatsBySession.get(session.id)?.add(dispatchedChatId);
      }
      if (!isInvoke) {
        ipcMain.sendForSession(channel, body.args, session);
        sendJson(response, 200, { ok: true, result: null });
        return;
      }
      invocationId = randomUUID();
      invocation = ipcMain.invoke(channel, body.args, {
        session,
        signal: abort.signal,
      });
      void invocation.then(
        () => abandonedInvocations.delete(invocationId!),
        () => abandonedInvocations.delete(invocationId!),
      );
      const result = await Promise.race([
        invocation,
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener(
            "abort",
            () => reject(abort.signal.reason),
            { once: true },
          );
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            abandon("timeout");
            abort.abort(new Error("RPC call timed out"));
            reject(new Error("RPC call timed out"));
          },
            options.channelTimeouts?.[channel] ??
              (channel === "restart-app" || typeof dispatchedChatId === "number"
                ? 15 * 60_000
                : defaultTimeoutMs),
          );
        }),
      ]);
      settled = true;
      if (!abort.signal.aborted && !response.destroyed)
        sendJson(response, 200, {
          ok: true,
          result: rewritePreviewUrls(result),
        });
    } catch (error) {
      settled = true;
      if (!response.destroyed) {
        const err = error as Error & { code?: string };
        const code = timedOut ? "TIMEOUT" : (err.code ?? "RPC_ERROR");
        const status = timedOut
          ? 504
          : code === "INVALID_REQUEST"
            ? 400
            : code === "CHANNEL_DISABLED"
              ? 403
              : code === "UNAUTHORIZED"
                ? 401
                : 500;
        sendJson(response, status, {
          ok: false,
          error: {
            code,
            message: timedOut
              ? "RPC call timed out"
              : (err.message ?? "RPC call failed"),
          },
        });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      request.off("aborted", abortOnDisconnect);
    }
  });

  const websocketServer = new WebSocketServer({ noServer: true });
  websocketServer.on("connection", (socket) => {
    sockets.add(socket);
    const id = randomUUID();
    const openedAt = Date.now();
    const activeChatIds = new Set<number>();
    chatsBySession.set(id, activeChatIds);
    sessions.set(id, {
      id,
      send: (channel, payload) => {
        if (
          (channel === "chat:response:end" ||
            channel === "chat:response:error") &&
          payload &&
          typeof payload === "object" &&
          typeof (payload as { chatId?: unknown }).chatId === "number"
        ) {
          activeChatIds.delete((payload as { chatId: number }).chatId);
        }
        if (socket.readyState === socket.OPEN)
          socket.send(
            JSON.stringify({ channel, payload: rewritePreviewUrls(payload) }),
          );
      },
      close: () => {
        for (const chatId of activeChatIds) {
          void ipcMain
            .invoke("chat:cancel", [chatId], {
              session: sessions.get(id)!,
              signal: new AbortController().signal,
            })
            .catch(() => undefined);
        }
        activeChatIds.clear();
        chatsBySession.delete(id);
      },
    });
    socket.send(JSON.stringify({ channel: "web:session", payload: { id } }));
    socket.once("close", (code, reason) => {
      console.info(
        JSON.stringify({
          event: "websocket_close",
          endpoint: "/events",
          who: "runtime",
          code,
          reason: reason.toString().slice(0, 120),
          sessionAgeMs: Date.now() - openedAt,
          bufferedBytes: socket.bufferedAmount,
        }),
      );
      sockets.delete(socket);
      const session = sessions.get(id);
      if (session) {
        closeWebSession(session);
        session.close?.();
      }
      sessions.delete(id);
    });
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/events" || !authorized(request, secret)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("RPC server may bind only to loopback");
  }
  server.listen(options.port ?? 0, host);
  return {
    server,
    address: () => server.address(),
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.close();
        websocketServer.close();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

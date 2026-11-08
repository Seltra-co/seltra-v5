import { randomUUID, timingSafeEqual } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
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
import { getAppProcessDiagnostics } from "../ipc/services/app_runtime_service";
import { closeWebSession, ipcMain, type WebSession } from "./electron-shim";

export type RpcServerOptions = {
  secret?: string;
  host?: string;
  port?: number;
  defaultTimeoutMs?: number;
  channelTimeouts?: Record<string, number>;
  publishHandlers?: {
    snapshotUserData: () => Promise<unknown>;
    commitWorkingTree: (input: unknown) => Promise<unknown>;
  };
};

export type RunningRpcServer = {
  server: Server;
  address: () => ReturnType<Server["address"]>;
  close: () => Promise<void>;
};

const abandonedInvocations = new Map<string, { channel: string; at: number }>();
// Keep this in sync with the Core gateway's distributed-machine RPC limit.
const MAX_RPC_BODY_BYTES = 40 * 1024 * 1024;

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
    if (size > MAX_RPC_BODY_BYTES)
      throw Object.assign(new Error("Request body exceeds the allowed size."), {
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
  // Builder setup can involve cold starts and slow package installs. Give
  // ordinary RPCs enough time to finish across distant regions; chat dispatch
  // and restart retain their longer channel-specific limit below.
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 10 * 60_000;
  const sockets = new Set<WebSocket>();
  const sessions = new Map<string, WebSession>();
  const server = createServer(async (request, response) => {
    if (!authorized(request, secret)) {
      sendJson(response, 401, {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Unauthorized" },
      });
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/rpc/__gateway-self-test" &&
      process.env.SELTRA_GATEWAY_SELF_TEST === "1"
    ) {
      try {
        const body = await readBody(request) as { args?: unknown };
        if (!Array.isArray(body?.args)) {
          sendJson(response, 400, {
            ok: false,
            error: { code: "INVALID_REQUEST", message: "A JSON args array is required." },
          });
          return;
        }
        sendJson(response, 200, { ok: true, result: { echo: body } });
      } catch (error) {
        const tooLarge = (error as { code?: string }).code === "BODY_TOO_LARGE";
        sendJson(response, tooLarge ? 413 : 400, {
          ok: false,
          error: {
            code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_REQUEST",
            message: tooLarge ? "Request body exceeds the allowed size." : "Request body must be valid JSON.",
          },
        });
      }
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/rpc/__gateway-create-app-self-test" &&
      process.env.SELTRA_GATEWAY_SELF_TEST === "1"
    ) {
      try {
        const body = await readBody(request) as { args?: unknown[] };
        if (!Array.isArray(body?.args) || body.args.length !== 1) {
          sendJson(response, 400, {
            ok: false,
            error: { code: "INVALID_REQUEST", message: "Create-app arguments are required." },
          });
          return;
        }
        const scaffoldPath = path.resolve(
          process.env.DYAD_SCAFFOLD_DIR?.trim() || "/opt/dyad/scaffold",
        );
        const scaffoldEntries = await readdir(scaffoldPath);
        if (!scaffoldEntries.length) {
          sendJson(response, 503, {
            ok: false,
            error: { code: "SCAFFOLD_EMPTY", message: "Runtime scaffold is empty." },
          });
          return;
        }
        const session = { id: randomUUID(), send: () => undefined };
        const envelope = await ipcMain.invoke("create-app", body.args, { session }) as {
          __dyadIpcEnvelope?: string;
          ok?: boolean;
          value?: { app?: { id?: unknown }; chatId?: unknown };
          error?: { code?: string };
        };
        if (envelope?.__dyadIpcEnvelope === "dyad-ipc-envelope-v1" && !envelope.ok) {
          sendJson(response, 500, {
            ok: false,
            error: { code: envelope.error?.code ?? "CREATE_APP_FAILED", message: "Runtime create-app failed." },
          });
          return;
        }
        const result = envelope?.__dyadIpcEnvelope === "dyad-ipc-envelope-v1"
          ? envelope.value
          : envelope as unknown as { app?: { id?: unknown }; chatId?: unknown };
        const appId = result?.app?.id;
        const chatId = result?.chatId;
        if (typeof appId !== "number" || !Number.isInteger(appId) || typeof chatId !== "number" || !Number.isInteger(chatId)) {
          sendJson(response, 500, {
            ok: false,
            error: { code: "CREATE_APP_INVALID_RESULT", message: "Runtime create-app returned an invalid result." },
          });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          result: {
            appId,
            chatId,
            scaffoldEntryCount: scaffoldEntries.length,
          },
        });
      } catch (error) {
        const code = (error as { code?: string }).code === "ENOENT"
          ? "SCAFFOLD_MISSING"
          : "CREATE_APP_SELF_TEST_FAILED";
        sendJson(response, code === "SCAFFOLD_MISSING" ? 503 : 500, {
          ok: false,
          error: { code, message: "Runtime create-app self-test failed." },
        });
      }
      return;
    }
    const internalPublishPath = request.url;
    const internalPublishAction = internalPublishPath === "/internal/publish/snapshot-user-data" ? "snapshot"
      : internalPublishPath === "/internal/publish/commit-working-tree" ? "commit" : undefined;
    if (request.method === "POST" && options.publishHandlers && internalPublishAction) {
      try {
        const body = await readBody(request) as unknown;
        const result = internalPublishAction === "snapshot"
          ? await options.publishHandlers.snapshotUserData()
          : await options.publishHandlers.commitWorkingTree(body);
        sendJson(response, 200, { ok: true, result });
      } catch (error) {
        const code = (error as { code?: string })?.code || "PUBLISH_RPC_FAILED";
        const status = code === "APP_NOT_FOUND" ? 404 : code.endsWith("FORBIDDEN") ? 403 : 500;
        sendJson(response, status, { ok: false, error: { code, message: status === 500 ? "Workspace durability RPC failed." : (error as Error).message } });
      }
      return;
    }
    const previewTarget = request.url?.match(
      /^\/internal\/preview-target\/(\d+)$/,
    );
    const previewDiagnostics = request.url?.match(
      /^\/internal\/diagnostics\/app\/(\d+)$/,
    );
    if (request.method === "GET" && previewDiagnostics && process.env.SELTRA_GATEWAY_SELF_TEST === "1") {
      const appId = Number(previewDiagnostics[1]);
      const appInfo = runningApps.get(appId);
      const processDiagnostics = getAppProcessDiagnostics(appId);
      let mapping: { host: string; hostname: string; port: number; path: string } | null = null;
      if (appInfo?.proxyUrl) {
        try {
          const proxy = new URL(appInfo.proxyUrl);
          mapping = { host: "127.0.0.1", hostname: proxy.hostname, port: Number(proxy.port), path: proxy.pathname || "/" };
        } catch {}
      }
      sendJson(response, 200, {
        appId,
        process: processDiagnostics,
        processPresent: Boolean(appInfo?.process && appInfo.process.exitCode === null),
        previewMapping: mapping,
        devUrlDetected: processDiagnostics?.devUrlDetected ?? false,
        mappingRegistered: Boolean(appInfo?.proxyUrl),
        skipReason: processDiagnostics ? processDiagnostics.skipReason : "process_diagnostics_unavailable",
        mappingSkipReason: processDiagnostics ? processDiagnostics.mappingSkipReason : "process_diagnostics_unavailable",
        loopbackProbeAttempts: processDiagnostics?.loopbackProbeAttempts ?? [],
      });
      return;
    }
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
        sendJson(response, 200, { appId, host: "127.0.0.1", previewHost: preview.hostname, port });
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
      const tooLarge = (error as { code?: string }).code === "BODY_TOO_LARGE";
      sendJson(response, tooLarge ? 413 : 400, {
        ok: false,
        error: {
          code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_REQUEST",
          message: (error as Error).message,
        },
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
      // Losing the response connection is not a user cancellation. Let the
      // current operation finish; explicit cancellation uses the chat machine
      // stop event, and RPCs still have a bounded server-side timeout.
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
  // Keep long running RPC responses alive for cold workspaces and users with
  // higher latency. These are inactivity limits; WebSocket heartbeats below
  // keep the event channel alive independently.
  server.timeout = 16 * 60_000;
  server.requestTimeout = 16 * 60_000;
  server.keepAliveTimeout = 75_000;

  const websocketServer = new WebSocketServer({ noServer: true });
  websocketServer.on("connection", (socket) => {
    sockets.add(socket);
    const id = randomUUID();
    const openedAt = Date.now();
    let isAlive = true;
    const heartbeat = setInterval(() => {
      if (socket.readyState !== socket.OPEN) return;
      if (!isAlive) {
        socket.terminate();
        return;
      }
      isAlive = false;
      socket.ping();
    }, 30_000);
    socket.on("pong", () => { isAlive = true; });
    sessions.set(id, {
      id,
      send: (channel, payload) => {
        if (socket.readyState === socket.OPEN)
          socket.send(
            JSON.stringify({ channel, payload: rewritePreviewUrls(payload) }),
          );
      },
      close: () => {
        // Socket loss is transient and must not be treated like the user's
        // explicit Stop action. Active chat actors remain resumable.
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
      clearInterval(heartbeat);
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
  const isolatedWebRuntime = process.env.DYAD_WEB_RUNTIME === "1";
  if (
    host !== "127.0.0.1" &&
    host !== "::1" &&
    host !== "localhost" &&
    !(isolatedWebRuntime && host === "0.0.0.0")
  ) {
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

//server/src/main.ts
import "reflect-metadata";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { WebSocket, WebSocketServer } from "ws";
import httpProxy from "http-proxy";
import { SignJWT, jwtVerify } from "jose";
import { GatewayModule } from "./app.module.js";
import { loadConfig, type GatewayConfig } from "./config.js";
import {
  FileControlStore,
  type ControlStore,
  type UsageEvent,
} from "./control_store.js";
import {
  CircuitOpenError,
  createBreakerRegistry,
} from "./resilience/circuit_breaker.js";
import { isWebChannelAllowed } from "../../src/web/channel_policy.js";
import { rewritePreviewUrls } from "../../src/web/preview_urls.js";
import { WorkspaceSupervisor, type WorkspaceRuntime } from "./workspace_supervisor.js";
import {
  parseFigmaFileUrl,
  retrieveFigmaReference,
} from "../../src/web/figma_reference.js";

const encoder = new TextEncoder();
const MAX_RPC_BODY_BYTES = 1024 * 1024;
const MAX_MODEL_BODY_BYTES = 10 * 1024 * 1024;

type SessionClaims = { sub: string; email: string; workspaceId: string; coreWorkspaceKey: string; storeSlug: string; plan: string };
type PreviewClaims = {
  sub: string;
  email: string;
  plan: string;
  workspaceId: string;
  coreWorkspaceKey: string;
  storeSlug: string;
  label: string;
  purpose: "preview" | "preview_session";
  exp: number;
};
type UsageBucket = { requests: number; tokens: number; startedAt: number };
type BudgetState = {
  inFlight: number;
  runs: Map<string, UsageBucket>;
  day: UsageBucket;
};
type EventSession = { userId: string; workspaceId: string; browser: WebSocket; runtime: WebSocket };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function cookies(request: IncomingMessage): Map<string, string> {
  return new Map(
    (request.headers.cookie ?? "")
      .split(";")
      .map((pair): [string, string] => {
        const separator = pair.indexOf("=");
        return separator < 0
          ? ["", ""]
          : [
              pair.slice(0, separator).trim(),
              decodeURIComponent(pair.slice(separator + 1).trim()),
            ];
      })
      .filter(([key]) => Boolean(key)),
  );
}

function isHttpsRequest(request: IncomingMessage): boolean {
  return (
    ("encrypted" in request.socket && request.socket.encrypted === true) ||
    request.headers["x-forwarded-proto"] === "https"
  );
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit)
      throw new HttpError(
        413,
        "BODY_TOO_LARGE",
        "Request body exceeds the allowed size.",
      );
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function openAiError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, {
    error: { message, type: "seltra_error", code },
  });
}

function primaryHost(request: IncomingMessage, config: GatewayConfig): boolean {
  const requestHost = (request.headers.host ?? "").split(":")[0].toLowerCase();
  if (requestHost === config.GATEWAY_HOST.toLowerCase()) return true;
  // Deployed behind a public domain: the bare base domain and any listed hosts
  // are the builder UI; only *.PREVIEW_BASE_DOMAIN hosts are previews.
  if (requestHost === config.PREVIEW_BASE_DOMAIN.toLowerCase()) return true;
  return config.GATEWAY_PUBLIC_HOSTS.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .includes(requestHost);
}
//   // if (
//   //   requestHost === "localhost" ||
//   //   requestHost === "127.0.0.1" ||
//   //   requestHost === "::1"
//   // )
//   //   return true;
//   // return requestHost === config.GATEWAY_HOST.toLowerCase();
// }

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return (
    (
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".woff2": "font/woff2",
      } as Record<string, string>
    )[ext] ?? "application/octet-stream"
  );
}

function tokenCount(value: unknown): number {
  try {
    return Math.ceil(JSON.stringify(value).length / 4);
  } catch {
    return 0;
  }
}

function modelContextWindow(model: string, configured: number): number {
  const known: Record<string, number> = {
    "@cf/moonshotai/kimi-k2.7-code": 262_144,
    "@cf/qwen/qwen2.5-coder-32b-instruct": 32_768,
    "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": 80_000,
    "alibaba/qwen3.5-397b-a17b": 262_144,
  };
  return known[model] ?? configured;
}

function providerErrorDetails(body: string): {
  code?: string | number;
  message?: string;
} {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { message: body.slice(0, 300) || undefined };
  }
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : undefined;
  const firstProviderError = Array.isArray(record.errors)
    ? record.errors.find(
        (item) => item && typeof item === "object",
      ) as Record<string, unknown> | undefined
    : undefined;
  const code = error?.code ?? firstProviderError?.code;
  const message = error?.message ?? firstProviderError?.message;
  return {
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(typeof message === "string"
      ? {
          message: message
            .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
            .replace(/(token|secret|key)=\S+/gi, "$1=[redacted]")
            .slice(0, 300),
        }
      : {}),
  };
}

function statusMessage(status: number, role: string, model: string): string {
  if (status === 401)
    return "Seltra model gateway: the upstream model provider rejected the API key (401). Check MODEL_API_KEY and MODEL_ACCOUNT_ID.";
  if (status === 400)
    return `Seltra model provider rejected the ${role} request (400) for ${model}.`;
  if (status === 404) return `Model not found: ${model}.`;
  if (status === 429) return `Seltra model provider rate limited ${model} (429).`;
  return `Seltra model gateway upstream failure (${status}) for ${model}.`;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function roleForAlias(
  model: string,
  config: GatewayConfig,
): {
  role: string;
  model: string;
  setting: string;
  contextWindow: number;
  maxOutputTokens: number;
} {
  const roles: Record<
    string,
    {
      role: string;
      model: string | undefined;
      setting: string;
      contextWindow: number;
      maxOutputTokens: number;
    }
  > = {
    "seltra-builder": {
      role: "builder",
      model: config.AI_MODEL_DEFAULT,
      setting: "AI_MODEL_DEFAULT",
      contextWindow: config.SELTRA_BUILDER_CONTEXT_WINDOW,
      maxOutputTokens: config.SELTRA_BUILDER_MAX_OUTPUT_TOKENS,
    },
    "seltra-planner": {
      role: "planner",
      model: config.AI_MODEL_REASONING || config.AI_MODEL_DEFAULT,
      setting: "AI_MODEL_REASONING",
      contextWindow: config.AI_MODEL_REASONING
        ? config.SELTRA_PLANNER_CONTEXT_WINDOW
        : config.SELTRA_BUILDER_CONTEXT_WINDOW,
      maxOutputTokens: config.AI_MODEL_REASONING
        ? config.SELTRA_PLANNER_MAX_OUTPUT_TOKENS
        : config.SELTRA_BUILDER_MAX_OUTPUT_TOKENS,
    },
    "seltra-fast": {
      role: "fast",
      model: config.AI_MODEL_FAST || config.AI_MODEL_DEFAULT,
      setting: "AI_MODEL_FAST",
      contextWindow: config.SELTRA_FAST_CONTEXT_WINDOW,
      maxOutputTokens: config.SELTRA_FAST_MAX_OUTPUT_TOKENS,
    },
    "seltra-vision": {
      role: "vision",
      model: config.AI_MODEL_VISION,
      setting: "AI_MODEL_VISION",
      contextWindow: config.SELTRA_VISION_CONTEXT_WINDOW,
      maxOutputTokens: config.SELTRA_VISION_MAX_OUTPUT_TOKENS,
    },
    "seltra-image": {
      role: "image",
      model: config.AI_MODEL_IMAGE,
      setting: "AI_MODEL_IMAGE",
      contextWindow: config.SELTRA_VISION_CONTEXT_WINDOW,
      maxOutputTokens: config.SELTRA_VISION_MAX_OUTPUT_TOKENS,
    },
  };
  const entry =
    roles[model] ?? Object.values(roles).find((item) => item.model === model);
  if (!entry)
    throw new HttpError(
      400,
      "UNKNOWN_MODEL",
      "Unknown Seltra model alias: " + model,
    );
  const mapped = entry.model;
  if (!mapped)
    throw new HttpError(
      503,
      "MODEL_NOT_CONFIGURED",
      "Seltra model " + model + " is not configured.",
    );
  return {
    role: entry.role,
    model: mapped,
    setting: entry.setting,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
  };
}

async function main(): Promise<void> {
  const traceStartup = (stage: string) => {
    if (process.env.SELTRA_GATEWAY_TRACE_STARTUP === "1")
      console.log(JSON.stringify({ event: "gateway_startup_stage", stage }));
  };
  traceStartup("begin");
  let config: GatewayConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const controlDirectory = path.resolve(
    config.CONTROL_DIR ?? ".web-dev/control",
  );
  let store: ControlStore = new FileControlStore(controlDirectory);
  traceStartup("config_validated");
  let prismaClient: import("@prisma/client").PrismaClient | undefined;
  if (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL) {
    if (process.env.TEST_DATABASE_URL)
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const [{ PrismaClient }, { PrismaControlStore }] = await Promise.all([
      import("@prisma/client"),
      import("./prisma_control_store.js"),
    ]);
    prismaClient = new PrismaClient();
    store = new PrismaControlStore(prismaClient);
  }
  const jwtSecret = encoder.encode(config.CORE_TOKEN_SECRET);
  const primaryOrigin = [...config.allowedOrigins][0];
  if (!primaryOrigin) {
    throw new Error(
      "GATEWAY_ALLOWED_ORIGINS must include the primary renderer origin.",
    );
  }
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const supervisor = new WorkspaceSupervisor({
    root: runtimeRoot,
    dataRoot: path.resolve(config.DATA_ROOT),
    maxActive: config.MAX_ACTIVE_WORKSPACES,
    idleMs: config.WORKSPACE_IDLE_TTL_SECONDS * 1000,
    publicApiUrl: config.SELTRA_PUBLIC_API_URL,
    env: process.env,
  });
  const entitlementCache = new Map<string, { expiresAt: number; active: boolean; reason?: string }>();
  const sessionOwners = new Map<string, SessionClaims>();
  const modelTokens = new Map<string, SessionClaims>();
  const eventSessions = new Set<EventSession>();
  const budgetStates = new Map<string, BudgetState>();
  const breakerRegistry = createBreakerRegistry({
    failureThreshold: 3,
    windowMs: 30_000,
    cooldownMs: 15_000,
    halfOpenMaxProbes: 1,
  });
  const previewProxy = httpProxy.createProxyServer({
    ws: true,
    // Preserve the public per-app hostname for the runtime's local proxy,
    // which uses it to select the corresponding dev server.
    changeOrigin: false,
    xfwd: false,
    timeout: 120_000,
  });
  const previewCookieRefreshes = new WeakMap<IncomingMessage, string>();
  const nest = await NestFactory.create(GatewayModule, { logger: false });
  traceStartup("nest_created");
  nest.use((request: IncomingMessage, response: ServerResponse) => {
    setSecurityHeaders(response);
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Runtime-Session, X-Seltra-Run-Id");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    void route(request, response).catch((error: unknown) => {
      const err =
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "INTERNAL_ERROR",
              "The gateway could not complete the request.",
            );
      if (err.status === 404)
        console.warn(
          JSON.stringify({
            event: "gateway_404",
            method: request.method,
            host: request.headers.host,
            url: request.url,
            code: err.code,
          }),
        );
      if (!response.headersSent) {
        if (err.code === "PREVIEW_TOKEN_REQUIRED") {
          response.removeHeader("X-Frame-Options");
          response.setHeader(
            "Content-Security-Policy",
            `frame-ancestors 'self' ${primaryOrigin}; default-src 'none'; script-src 'unsafe-inline'`,
          );
          response.setHeader("Cache-Control", "no-store");
          const host = (request.headers.host ?? "").split(":")[0].toLowerCase();
          const suffix = "." + config.PREVIEW_BASE_DOMAIN.toLowerCase();
          const label = host.endsWith(suffix)
            ? host.slice(0, -suffix.length)
            : "";
          const isNavigation =
            request.headers.accept?.includes("text/html") ||
            request.headers["sec-fetch-dest"] === "iframe" ||
            request.headers["sec-fetch-dest"] === "document";
          if (isNavigation && /^ws-[a-f0-9]{12}-app-[1-9]\d{0,14}$/.test(label)) {
            const message = JSON.stringify({
              type: "seltra:preview-auth-expired",
              label,
            }).replaceAll("<", "\\u003c");
            const targetOrigin = JSON.stringify(primaryOrigin).replaceAll(
              "<",
              "\\u003c",
            );
            response.writeHead(401, {
              "content-type": "text/html; charset=utf-8",
            });
            response.end(
              `<!doctype html><meta charset="utf-8"><title>Preview access expired</title><p>Refreshing preview...</p><script>parent.postMessage(${message},${targetOrigin});</script>`,
            );
            return;
          }
          sendJson(response, 401, {
            ok: false,
            error: { code: err.code, message: err.message },
          });
        } else {
          sendJson(response, err.status, {
            ok: false,
            error: { code: err.code, message: err.message },
          });
        }
      } else response.destroy();
    });
  });
  await nest.listen(config.GATEWAY_PORT, config.GATEWAY_HOST);
  traceStartup("http_listening");
  const server = nest.getHttpServer() as Server;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_RPC_BODY_BYTES,
  });

  previewProxy.on("proxyReq", (proxyRequest) => {
    proxyRequest.removeHeader("cookie");
    proxyRequest.removeHeader("authorization");
    proxyRequest.removeHeader("x-runtime-session");
  });
  previewProxy.on("proxyRes", (proxyResponse, request, response) => {
    proxyResponse.headers["x-content-type-options"] = "nosniff";
    proxyResponse.headers["referrer-policy"] = "same-origin";
    const refreshedCookie = previewCookieRefreshes.get(request);
    if (refreshedCookie) {
      const existingCookies = proxyResponse.headers["set-cookie"];
      proxyResponse.headers["set-cookie"] = [
        ...(Array.isArray(existingCookies)
          ? existingCookies
          : existingCookies
            ? [existingCookies]
            : []),
        refreshedCookie,
      ];
    }
    // Previews are intentionally cross-origin subdomains of the renderer.
    // SAMEORIGIN would prevent their iframe from rendering.
    delete proxyResponse.headers["x-frame-options"];
    response.removeHeader("X-Frame-Options");
  });
  previewProxy.on("error", (_error, _request, response) => {
    if (response && "writeHead" in response && !response.headersSent) {
      (response as ServerResponse).writeHead(502, {
        "content-type": "text/plain",
      });
      (response as ServerResponse).end("Preview is unavailable.");
    }
  });

  async function authenticate(
    request: IncomingMessage,
  ): Promise<SessionClaims | null> {
    const authorization = request.headers.authorization;
    const match = typeof authorization === "string" ? authorization.match(/^Bearer\s+(.+)$/i) : null;
    const token = match?.[1]?.trim();
    if (!token) return null;
    try {
      const verified = await jwtVerify(token, jwtSecret, {
        algorithms: ["HS256"],
        issuer: "seltra-api",
        audience: "seltra-core",
      });
      const payload = verified.payload;
      if (typeof payload.sub !== "string" || typeof payload.email !== "string" ||
        typeof payload.workspaceId !== "string" || typeof payload.coreWorkspaceKey !== "string" ||
        !/^[a-f0-9]{12}$/.test(payload.coreWorkspaceKey) || typeof payload.storeSlug !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.storeSlug) || typeof payload.plan !== "string") return null;
      const claims = payload as SessionClaims;
      await assertEntitlement(claims);
      await store.getOrCreateWorkspace(claims.sub, claims.workspaceId, claims.email);
      return claims;
    } catch (error) {
      // Preserve typed entitlement failures such as CREDITS_EXHAUSTED instead
      // of turning them into a generic missing-token response.
      if (error instanceof HttpError) throw error;
      return null;
    }
  }

  async function assertEntitlement(claims: SessionClaims) {
    const cached = entitlementCache.get(claims.workspaceId);
    let result = cached && cached.expiresAt > Date.now() ? cached : undefined;
    if (!result) {
      let response: Response;
      try {
        response = await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/internal/core/entitlement/${encodeURIComponent(claims.workspaceId)}`, {
          headers: { "x-core-service-secret": config.CORE_SERVICE_SECRET },
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        throw new HttpError(503, "ENTITLEMENT_UNAVAILABLE", "Seltra could not verify builder access.");
      }
      if (!response.ok) throw new HttpError(503, "ENTITLEMENT_UNAVAILABLE", "Seltra could not verify builder access.");
      const entitlement = await response.json() as { active?: boolean; reason?: string; userId?: string; coreWorkspaceKey?: string; storeSlug?: string };
      if (entitlement.userId !== claims.sub || entitlement.coreWorkspaceKey !== claims.coreWorkspaceKey || entitlement.storeSlug !== claims.storeSlug)
        throw new HttpError(403, "WORKSPACE_FORBIDDEN", "Builder token does not match this workspace.");
      result = { active: entitlement.active === true, reason: entitlement.reason, expiresAt: Date.now() + 60_000 };
      entitlementCache.set(claims.workspaceId, result);
    }
    if (!result.active) {
      if (result.reason === "credits_exhausted")
        throw new HttpError(402, "CREDITS_EXHAUSTED", "This workspace has used its AI credits for this period.");
      throw new HttpError(403, "WORKSPACE_INACTIVE", "Builder access is not active for this workspace.");
    }
  }

  async function runtimeFor(claims: Pick<SessionClaims, "sub" | "email" | "plan" | "workspaceId" | "coreWorkspaceKey" | "storeSlug">): Promise<WorkspaceRuntime> {
    let runtime: WorkspaceRuntime;
    try {
      runtime = await supervisor.get(claims.workspaceId, claims.coreWorkspaceKey, claims.storeSlug);
    } catch (error) {
      const status = Number((error as { status?: number }).status) || 503;
      throw new HttpError(status, String((error as { code?: string }).code ?? "WORKSPACE_RUNTIME_UNAVAILABLE"), (error as Error).message || "Workspace runtime is unavailable.");
    }
    modelTokens.set(runtime.modelToken, claims);
    return runtime;
  }

  function checkOrigin(request: IncomingMessage): void {
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin))
      throw new HttpError(
        403,
        "ORIGIN_FORBIDDEN",
        "Request origin is not allowed.",
      );
  }

  async function issuePreviewToken(label: string, claims: Pick<SessionClaims, "sub" | "email" | "plan" | "workspaceId" | "coreWorkspaceKey" | "storeSlug">): Promise<string> {
    return new SignJWT({
      sub: claims.sub,
      email: claims.email,
      plan: claims.plan,
      workspaceId: claims.workspaceId,
      coreWorkspaceKey: claims.coreWorkspaceKey,
      storeSlug: claims.storeSlug,
      label,
      purpose: "preview",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(config.PREVIEW_TOKEN_TTL)
      .sign(jwtSecret);
  }

  async function issuePreviewSessionToken(label: string, claims: Pick<SessionClaims, "sub" | "email" | "plan" | "workspaceId" | "coreWorkspaceKey" | "storeSlug">): Promise<string> {
    return new SignJWT({
      sub: claims.sub,
      email: claims.email,
      plan: claims.plan,
      workspaceId: claims.workspaceId,
      coreWorkspaceKey: claims.coreWorkspaceKey,
      storeSlug: claims.storeSlug,
      label,
      purpose: "preview_session",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${config.PREVIEW_SESSION_TTL_SECONDS}s`)
      .sign(jwtSecret);
  }

  function previewCookie(token: string): string {
    // Preview iframes run on a separate subdomain from the dashboard. They
    // need a cross-site cookie; Chromium treats localhost as a secure context
    // even when the local gateway is served over plain HTTP.
    const secureCookie =
      config.previewScheme === "https" ||
      config.PREVIEW_BASE_DOMAIN === "localhost" ||
      config.PREVIEW_BASE_DOMAIN.endsWith(".localhost");
    return (
      "seltra_preview=" +
      encodeURIComponent(token) +
      "; Path=/; HttpOnly; SameSite=" +
      (secureCookie ? "None" : "Lax") +
      "; Max-Age=" +
      config.PREVIEW_SESSION_TTL_SECONDS +
      (secureCookie ? "; Secure" : "")
    );
  }

  async function rewriteWithPreviewTokens<T>(payload: T, claims: SessionClaims): Promise<T> {
    const rewritten = rewritePreviewUrls(
      payload,
      claims.coreWorkspaceKey,
      config.PREVIEW_BASE_DOMAIN,
      config.previewScheme,
      config.previewPort === undefined ? undefined : String(config.previewPort),
      true,
    );
    const visit = async (value: unknown, key?: string): Promise<unknown> => {
      if (
        typeof value === "string" &&
        (key === "proxyUrl" ||
          key === "previewUrl" ||
          key === "url" ||
          key === "appUrl" ||
          key === "originalUrl")
      ) {
        try {
          const url = new URL(value);
          if (url.hostname.endsWith("." + config.PREVIEW_BASE_DOMAIN)) {
            const label = url.hostname.slice(
              0,
              -("." + config.PREVIEW_BASE_DOMAIN).length,
            );
            if (label.startsWith(`ws-${claims.coreWorkspaceKey}-app-`)) {
              url.searchParams.set("preview_token", await issuePreviewToken(label, claims));
              return url.toString();
            }
          }
        } catch {
          /* keep the engine payload unchanged */
        }
        return value;
      }
      if (Array.isArray(value))
        return Promise.all(value.map((item) => visit(item)));
      if (value && typeof value === "object")
        return Object.fromEntries(
          await Promise.all(
            Object.entries(value).map(async ([childKey, child]) => [
              childKey,
              await visit(child, childKey),
            ]),
          ),
        );
      return value;
    };
    return (await visit(rewritten)) as T;
  }

  async function resolvePreviewPort(label: string, claims: Pick<SessionClaims, "sub" | "email" | "plan" | "workspaceId" | "coreWorkspaceKey" | "storeSlug">): Promise<number> {
    const match = label.match(/^ws-([a-f0-9]{12})-app-([1-9]\d{0,14})$/);
    if (!match || match[1] !== claims.coreWorkspaceKey)
      throw new HttpError(404, "PREVIEW_NOT_FOUND", "Preview not found.");
    const appId = Number(match[2]);
    const runtime = await runtimeFor(claims);
    const response = await fetch(
      runtime.baseUrl + "/internal/preview-target/" + appId,
      {
        headers: { authorization: "Bearer " + runtime.rpcSecret },
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!response.ok)
      throw new HttpError(404, "PREVIEW_NOT_FOUND", "Preview is not running.");
    const target = (await response.json()) as {
      appId?: unknown;
      port?: unknown;
      host?: unknown;
    };
    if (
      target.appId !== appId ||
      target.host !== "127.0.0.1" ||
      typeof target.port !== "number" ||
      !Number.isInteger(target.port) ||
      target.port < 1024 ||
      target.port > 65535 ||
      target.port === config.GATEWAY_PORT
    ) {
      throw new HttpError(
        403,
        "PREVIEW_TARGET_FORBIDDEN",
        "Preview target failed gateway validation.",
      );
    }
    return target.port;
  }

  async function validPreviewToken(
    token: string | undefined,
    label: string,
    purposes: readonly PreviewClaims["purpose"][],
  ): Promise<PreviewClaims | null> {
    if (!token) return null;
    try {
      const verified = await jwtVerify(token, jwtSecret, {
        algorithms: ["HS256"],
      });
      const claims = verified.payload as unknown as PreviewClaims;
      if (
        !purposes.includes(claims.purpose) ||
        !/^ws-[a-f0-9]{12}-app-[1-9]\d{0,14}$/.test(label) ||
        label !== `ws-${claims.coreWorkspaceKey}-app-${label.match(/-app-(\d+)$/)?.[1]}` ||
        !/^[a-f0-9]{12}$/.test(claims.coreWorkspaceKey) ||
        typeof claims.workspaceId !== "string" ||
        typeof claims.sub !== "string" ||
        typeof claims.email !== "string" ||
        typeof claims.plan !== "string" ||
        typeof claims.storeSlug !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(claims.storeSlug) ||
        claims.label !== label ||
        typeof claims.exp !== "number"
      )
        return null;
      return claims;
    } catch {
      return null;
    }
  }

  async function validatePreviewAccess(
    request: IncomingMessage,
    response: ServerResponse,
    label: string,
  ): Promise<PreviewClaims | null> {
    const url = new URL(request.url ?? "/", "http://gateway.invalid");
    const queryToken = url.searchParams.get("preview_token") ?? undefined;
    const queryClaims = await validPreviewToken(queryToken, label, ["preview"]);
    if (queryClaims) {
      await assertEntitlement(queryClaims);
      const sessionToken = await issuePreviewSessionToken(label, queryClaims);
      url.searchParams.delete("preview_token");
      response.setHeader("Set-Cookie", previewCookie(sessionToken));
      response.writeHead(302, { location: url.pathname + url.search });
      response.end();
      return null;
    }

    const cookieToken = cookies(request).get("seltra_preview");
    const cookieClaims = await validPreviewToken(cookieToken, label, [
      "preview",
      "preview_session",
    ]);
    if (!cookieClaims) return null;
    await assertEntitlement(cookieClaims);

    if (url.searchParams.has("preview_token")) {
      url.searchParams.delete("preview_token");
      request.url = url.pathname + url.search;
    }
    const remainingSeconds = cookieClaims.exp - Math.floor(Date.now() / 1000);
    if (
      cookieClaims.purpose === "preview" ||
      remainingSeconds < config.PREVIEW_SESSION_TTL_SECONDS / 2
    ) {
      previewCookieRefreshes.set(
        request,
        previewCookie(await issuePreviewSessionToken(label, cookieClaims)),
      );
    }
    return cookieClaims;
  }

  function budgetState(workspaceId: string): BudgetState {
    let state = budgetStates.get(workspaceId);
    if (!state) {
      state = {
        inFlight: 0,
        runs: new Map(),
        day: { requests: 0, tokens: 0, startedAt: Date.now() },
      };
      budgetStates.set(workspaceId, state);
    }
    return state;
  }

  function budgetBucket(state: BudgetState, runId: string): UsageBucket {
    if (runId.endsWith(utcDay())) return state.day;
    let bucket = state.runs.get(runId);
    if (!bucket) {
      bucket = { requests: 0, tokens: 0, startedAt: Date.now() };
      state.runs.set(runId, bucket);
    }
    return bucket;
  }

  async function usageSummary(claims: SessionClaims): Promise<unknown> {
    const rows = await store.listUsage(claims.workspaceId);
    const byRole: Record<
      string,
      { inputTokens: number; outputTokens: number; requests: number }
    > = {};
    const byRun: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        tokens: number;
        requests: number;
      }
    > = {};
    for (const row of rows) {
      const role = (byRole[row.role] ??= {
        inputTokens: 0,
        outputTokens: 0,
        requests: 0,
      });
      role.inputTokens += row.inputTokens;
      role.outputTokens += row.outputTokens;
      role.requests++;
      const run = (byRun[row.runId] ??= {
        inputTokens: 0,
        outputTokens: 0,
        tokens: 0,
        requests: 0,
      });
      run.inputTokens += row.inputTokens;
      run.outputTokens += row.outputTokens;
      run.tokens += row.inputTokens + row.outputTokens;
      run.requests++;
    }
    return {
      byRole,
      byRun,
      tokensPerRun: Object.fromEntries(
        Object.entries(byRun).map(([runId, value]) => [runId, value.tokens]),
      ),
    };
  }

  async function handleModelRequest(
    request: IncomingMessage,
    response: ServerResponse,
    modelsOnly: boolean,
  ): Promise<void> {
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ?? "";
    const modelClaims = modelTokens.get(bearer);
    const activeRuntime = modelClaims ? supervisor.getByKey(modelClaims.coreWorkspaceKey) : null;
    if (!bearer || !modelClaims || !activeRuntime || activeRuntime.modelToken !== bearer) {
      console.warn(
        JSON.stringify({
          event: "workspace_model_token_rejected",
          reason: bearer ? "TOKEN_MISMATCH" : "TOKEN_MISSING",
          path: request.url,
        }),
      );
      throw new HttpError(
        401,
        "UNAUTHORIZED",
        "Invalid workspace model token.",
      );
    }
    await assertEntitlement(modelClaims);
    if (modelsOnly) {
      sendJson(response, 200, {
        object: "list",
        data: [
          config.AI_MODEL_DEFAULT,
          config.AI_MODEL_REASONING || config.AI_MODEL_DEFAULT,
          config.AI_MODEL_FAST || config.AI_MODEL_DEFAULT,
          config.AI_MODEL_VISION,
        ]
          .filter((id): id is string => Boolean(id))
          .map((id) => ({
            id,
            object: "model",
            created: 0,
            owned_by: "seltra",
          })),
      });
      return;
    }
    const bodyBytes = await readBody(request, MAX_MODEL_BODY_BYTES);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyBytes.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        "Request body must be valid JSON.",
      );
    }
    if (typeof body.model !== "string")
      throw new HttpError(400, "INVALID_REQUEST", "A model alias is required.");
    let mapping: {
      role: string;
      model: string;
      setting: string;
      contextWindow: number;
      maxOutputTokens: number;
    };
    try {
      mapping = roleForAlias(body.model, config);
    } catch (error) {
      const err = error as HttpError;
      openAiError(response, err.status, err.code, err.message);
      return;
    }
    if (!config.MODEL_API_KEY || !config.modelBaseUrl) {
      openAiError(
        response,
        503,
        "MODEL_PROVIDER_NOT_CONFIGURED",
        "Seltra model gateway: configure MODEL_API_KEY and MODEL_ACCOUNT_ID.",
      );
      return;
    }

    const inputTokensEstimate = tokenCount(body.messages);
    const contextSafetyMargin = 512;
    const availableOutputTokens = Math.min(
      mapping.maxOutputTokens,
      mapping.contextWindow - inputTokensEstimate - contextSafetyMargin,
    );
    if (availableOutputTokens <= 0) {
      openAiError(
        response,
        400,
        "PROMPT_TOO_LONG",
        `Prompt too long for Seltra ${mapping.role} (${inputTokensEstimate} > ${mapping.contextWindow - contextSafetyMargin} tokens). Reduce the prompt or select a model with a larger context window.`,
      );
      return;
    }
    const requestedOutputTokens = Number(body.max_tokens);
    const requestedOutputCap =
      Number.isFinite(requestedOutputTokens) && requestedOutputTokens > 0
        ? Math.floor(requestedOutputTokens)
        : mapping.maxOutputTokens;
    body.max_tokens = Math.min(requestedOutputCap, availableOutputTokens);

    const claimsWorkspace = modelClaims.workspaceId;
    const runIdHeader = request.headers["x-seltra-run-id"];
    const explicitRunId =
      typeof runIdHeader === "string" && runIdHeader.length <= 128
        ? runIdHeader
        : undefined;
    const runId = explicitRunId ?? claimsWorkspace + "-" + utcDay();
    const state = budgetState(claimsWorkspace);
    const bucket = budgetBucket(state, runId);
    const requestTokens = tokenCount(body.messages);
    if (state.inFlight >= config.MODEL_MAX_CONCURRENT_REQUESTS) {
      openAiError(
        response,
        429,
        "budget_exceeded",
        "Seltra request limit reached: maximum concurrent requests.",
      );
      return;
    }
    if (
      (explicitRunId !== undefined &&
        bucket.requests >= config.MODEL_MAX_REQUESTS_PER_RUN) ||
      state.day.requests >= config.MODEL_MAX_REQUESTS_PER_WORKSPACE
    ) {
      openAiError(
        response,
        429,
        "budget_exceeded",
        "Seltra request limit reached: maximum model requests.",
      );
      return;
    }
    if (
      explicitRunId !== undefined &&
      bucket.tokens + requestTokens > config.MODEL_MAX_TOKENS_PER_RUN
    ) {
      openAiError(
        response,
        429,
        "budget_exceeded",
        `Seltra run token budget exceeded (${bucket.tokens.toLocaleString()} estimated input tokens used; limit ${config.MODEL_MAX_TOKENS_PER_RUN.toLocaleString()}). Start a new run or raise MODEL_MAX_TOKENS_PER_RUN.`,
      );
      return;
    }
    if (
      state.day.tokens + requestTokens >
      config.MODEL_MAX_TOKENS_PER_WORKSPACE
    ) {
      openAiError(
        response,
        429,
        "budget_exceeded",
        `Seltra workspace token budget exceeded (${state.day.tokens.toLocaleString()} estimated input tokens used; daily limit ${config.MODEL_MAX_TOKENS_PER_WORKSPACE.toLocaleString()}). Try again after the workspace budget resets.`,
      );
      return;
    }
    if (
      explicitRunId !== undefined &&
      Date.now() - bucket.startedAt > config.MODEL_MAX_WALL_CLOCK_SECONDS * 1000
    ) {
      openAiError(
        response,
        429,
        "budget_exceeded",
        "Seltra run wall-clock limit exceeded.",
      );
      return;
    }
    const statefulBucket = bucket;
    bucket.requests++;
    state.day.requests++;
    bucket.tokens += requestTokens;
    state.day.tokens += requestTokens;
    state.inFlight++;
    const startedAt = Date.now();
    const inputTokensGuess = requestTokens;
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    const streaming = body.stream === true;
    const upstreamBody = {
      ...body,
      model: mapping.model,
      ...(streaming && !body.stream_options
        ? { stream_options: { include_usage: true } }
        : {}),
    };
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let estimated = true;
    let succeeded = false;
    let errorClass: string | undefined;
    let upstreamResponse: Response | undefined;
    let usedModel = mapping.model;
    const fallbacks =
      mapping.role === "builder" && config.AI_PROVIDER === "cloudflare"
        ? config.AI_MODEL_FALLBACKS.split(",")
            .map((model) => model.trim())
            .filter((model) => model && model !== mapping.model)
        : [];
    const toolFallbacks = new Set(
      config.AI_MODEL_TOOL_FALLBACKS.split(",")
        .map((model) => model.trim())
        .filter(Boolean),
    );
    const compatibleFallbacks = Array.isArray(body.tools) && body.tools.length
      ? fallbacks.filter((model) => toolFallbacks.has(model))
      : fallbacks;
    const candidateModels = [mapping.model, ...compatibleFallbacks].filter(
      (model, index, models) => models.indexOf(model) === index,
    );
    try {
      let lastError: unknown;
      for (const [candidateIndex, candidateModel] of candidateModels.entries()) {
        const candidateContext = modelContextWindow(
          candidateModel,
          mapping.contextWindow,
        );
        const candidateOutput = Math.min(
          mapping.maxOutputTokens,
          candidateIndex === 0
            ? candidateContext - inputTokensEstimate - contextSafetyMargin
            : Math.min(
                config.SELTRA_BUILDER_FALLBACK_MAX_OUTPUT_TOKENS,
                candidateContext - inputTokensEstimate - contextSafetyMargin,
              ),
        );
        if (candidateOutput <= 0) continue;
        const candidateBody = {
          ...upstreamBody,
          model: candidateModel,
          max_tokens: Math.min(requestedOutputCap, candidateOutput),
        };
        const breaker = breakerRegistry.get(
          config.AI_PROVIDER + ":" + candidateModel,
        );
        let candidateError: unknown;
        const maxAttempts =
          candidateIndex === 0 && compatibleFallbacks.length > 0 ? 1 : 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            upstreamResponse = await breaker.execute(
              async () => {
                const result = await fetch(
                  config.modelBaseUrl.replace(/\/+$/, "") +
                    "/chat/completions",
                  {
                    method: "POST",
                    headers: {
                      authorization: "Bearer " + config.MODEL_API_KEY,
                      "content-type": "application/json",
                      accept: streaming
                        ? "text/event-stream"
                        : "application/json",
                    },
                    body: JSON.stringify(candidateBody),
                    signal: controller.signal,
                  },
                );
                if (!result.ok) {
                  const providerBody = await result.text().catch(() => "");
                  const details = providerErrorDetails(providerBody);
                  const detail =
                    details.code || details.message
                      ? ` Cloudflare${details.code ? ` ${details.code}` : ""}: ${details.message ?? "request rejected"}`
                      : "";
                  const failure = new Error(
                    statusMessage(result.status, mapping.role, candidateModel) +
                      detail,
                  );
                  Object.assign(failure, {
                    status: result.status,
                    providerCode: details.code,
                    retryAfter: result.headers.get("retry-after"),
                  });
                  throw failure;
                }
                return result;
              },
              (error) => {
                const status = (error as { status?: number }).status ?? 0;
                return status === 429 || status >= 500 || status === 0
                  ? "retryable"
                  : status >= 400 && status <= 404
                    ? "config"
                    : "client_error";
              },
            );
            usedModel = candidateModel;
            break;
          } catch (error) {
            candidateError = error;
            lastError = error;
            const status = (error as { status?: number }).status ?? 0;
            const retryable = status === 429 || status >= 500 || status === 0;
            if (
              !retryable ||
              attempt === maxAttempts - 1 ||
              controller.signal.aborted
            )
              break;
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                80 + Math.floor(Math.random() * 160) * (attempt + 1),
              ),
            );
          }
        }
        if (upstreamResponse) break;
        const status = (candidateError as { status?: number } | undefined)
          ?.status;
        const canFailOver =
          status === 429 ||
          status === 400 ||
          status === 403 ||
          status === 404 ||
          (typeof status === "number" && status >= 500) ||
          status === 0;
        if (
          !canFailOver ||
          candidateIndex === candidateModels.length - 1 ||
          controller.signal.aborted
        )
          throw candidateError ?? lastError;
        const nextModel = candidateModels[candidateIndex + 1];
        console.warn(
          JSON.stringify({
            event: "model_fallback",
            role: mapping.role,
            from: candidateModel,
            to: nextModel,
            status,
            providerCode: (candidateError as { providerCode?: unknown })
              ?.providerCode,
          }),
        );
      }
      if (!upstreamResponse)
        throw lastError ?? new Error("Model provider did not respond.");
      const upstreamUsage = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const usage = (value as { usage?: Record<string, unknown> }).usage;
        if (!usage) return;
        const input = Number(usage.prompt_tokens ?? usage.input_tokens);
        const output = Number(usage.completion_tokens ?? usage.output_tokens);
        const cached = Number(
          (usage.prompt_tokens_details as Record<string, unknown> | undefined)
            ?.cached_tokens ??
            usage.cached_input_tokens ??
            0,
        );
        if (Number.isFinite(input) && Number.isFinite(output)) {
          estimated = false;
          outputTokens = output;
          cachedInputTokens = Number.isFinite(cached) ? cached : 0;
          (
            statefulBucket as UsageBucket & { reportedInput?: number }
          ).reportedInput = input;
        }
      };
      if (streaming) {
        response.writeHead(upstreamResponse.status, {
          "content-type":
            upstreamResponse.headers.get("content-type") ?? "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const reader = upstreamResponse.body?.getReader();
        if (!reader) throw new Error("Provider stream was empty.");
        const decoder = new TextDecoder();
        let pending = "";
        let outputChars = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          outputChars += text.length;
          pending += text;
          const blocks = pending.split(/\r?\n\r?\n/);
          pending = blocks.pop() ?? "";
          for (const block of blocks) {
            const data = block
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (!data || data === "[DONE]") continue;
            try {
              upstreamUsage(JSON.parse(data));
            } catch {
              /* pass non-JSON SSE data unchanged */
            }
          }
          if (!response.destroyed) response.write(value);
        }
        outputTokens ||= Math.ceil(outputChars / 4);
        if (!response.destroyed) response.end();
      } else {
        const value = (await upstreamResponse.json()) as Record<
          string,
          unknown
        >;
        upstreamUsage(value);
        if (estimated)
          outputTokens = tokenCount(
            (value.choices as Array<{ message?: unknown }> | undefined)?.[0]
              ?.message,
          );
        sendJson(response, upstreamResponse.status, value);
      }
      succeeded = true;
    } catch (error) {
      const status =
        error instanceof CircuitOpenError
          ? 503
          : ((error as { status?: number }).status ?? 502);
      const retryAfter = Number((error as { retryAfter?: string }).retryAfter);
      const message =
        error instanceof CircuitOpenError
          ? "Seltra model gateway is temporarily unavailable while the provider circuit recovers. Retry shortly."
          : status === 401
            ? "Model key rejected. Check MODEL_API_KEY and try again."
            : status === 404
              ? `Model not found: ${mapping.model}. Check ${mapping.setting} in .env.web and rerun npm run web:dev.`
              : status === 429
                ? "Rate limited, retry in " +
                  (Number.isFinite(retryAfter) && retryAfter > 0
                    ? Math.ceil(retryAfter)
                    : 1) +
                  "s."
                : (error as Error).message || "Model provider request failed.";
      errorClass =
        status === 401 || status === 403 || status === 404
          ? "config"
          : status === 400
            ? "client_error"
            : "retryable";
      if (!response.destroyed)
        openAiError(
          response,
          status === 503 ? 503 : status >= 400 && status < 500 ? status : 502,
          error instanceof CircuitOpenError
            ? "circuit_open"
            : errorClass === "config"
              ? "provider_config_error"
              : "provider_error",
          message,
        );
    } finally {
      state.inFlight = Math.max(0, state.inFlight - 1);
      const reportedInput = (
        statefulBucket as UsageBucket & { reportedInput?: number }
      ).reportedInput;
      const inputTokens = reportedInput ?? inputTokensGuess;
      const actualTotal = inputTokens + outputTokens;
      statefulBucket.tokens += Math.max(0, actualTotal - inputTokensGuess);
      state.day.tokens += Math.max(0, actualTotal - inputTokensGuess);
      const usage: UsageEvent = {
        workspaceId: claimsWorkspace,
        role: mapping.role,
        model: usedModel,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        ok: succeeded,
        errorClass,
        latencyMs: Date.now() - startedAt,
        runId,
        estimated,
        createdAt: new Date().toISOString(),
      };
      await store.appendUsage(usage).catch(() => undefined);
      await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/internal/core/usage`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-core-service-secret": config.CORE_SERVICE_SECRET },
        body: JSON.stringify({ tenantId: claimsWorkspace, userId: modelClaims.sub, role: mapping.role, model: usedModel, tokens: inputTokens + outputTokens, cached: cachedInputTokens > 0, ok: succeeded, runId }),
        signal: AbortSignal.timeout(5_000),
      }).then((result) => {
        if (!result.ok) console.error(JSON.stringify({ event: "usage_report_failed", status: result.status }));
      }).catch(() => console.error(JSON.stringify({ event: "usage_report_failed" })));
    }
  }

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://gateway.invalid");
    if (request.method === "OPTIONS") {
      if (!request.headers.origin || !config.allowedOrigins.has(request.headers.origin))
        throw new HttpError(403, "ORIGIN_FORBIDDEN", "Request origin is not allowed.");
      response.writeHead(204, { "access-control-max-age": "600" });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (!primaryHost(request, config)) {
      const host = (request.headers.host ?? "").split(":")[0].toLowerCase();
      const suffix = "." + config.PREVIEW_BASE_DOMAIN.toLowerCase();
      if (!host.endsWith(suffix))
        throw new HttpError(404, "NOT_FOUND", "Not found.");
      const label = host.slice(0, -suffix.length);
      const previewClaims = await validatePreviewAccess(request, response, label);
      if (!previewClaims) {
        if (response.writableEnded) return;
        throw new HttpError(
          401,
          "PREVIEW_TOKEN_REQUIRED",
          "Preview access token is missing or expired.",
        );
      }
      const port = await resolvePreviewPort(label, previewClaims);
      const internalPreviewHost = `app-${label.match(/-app-(\d+)$/)?.[1]}.localhost:${port}`;
      // previewProxy.web(request, response, {
      //   target: "http://127.0.0.1:" + port,
      //   headers: { host: `${label}.${config.PREVIEW_BASE_DOMAIN}:${port}` },
      //   proxyTimeout: 120_000,
      // });
      previewProxy.web(request, response, {
        target: "http://127.0.0.1:" + port,
        headers: { host: internalPreviewHost },
        proxyTimeout: 120_000,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith("/v1/")) {
      if (request.method === "GET" && url.pathname === "/v1/models") {
        await handleModelRequest(request, response, true);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/chat/completions"
      ) {
        await handleModelRequest(request, response, false);
        return;
      }
      throw new HttpError(404, "NOT_FOUND", "Not found.");
    }
    if (url.pathname.startsWith("/api/")) {
      const claims = await authenticate(request);
      if (!claims)
        throw new HttpError(401, "UNAUTHORIZED", "Authentication is required.");
    if (url.pathname === "/api/auth/me" && request.method === "GET") {
        sendJson(response, 200, {
          user: { id: claims.sub, email: claims.email },
        workspace: { id: claims.workspaceId, coreWorkspaceKey: claims.coreWorkspaceKey, storeSlug: claims.storeSlug, plan: claims.plan },
        });
        return;
      }
      if (url.pathname === "/api/usage/summary" && request.method === "GET") {
        sendJson(response, 200, await usageSummary(claims));
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        checkOrigin(request);
      if (url.pathname === "/api/figma/import" && request.method === "POST") {
        if (!config.FIGMA_ACCESS_TOKEN?.trim())
          throw new HttpError(
            503,
            "FIGMA_NOT_CONFIGURED",
            "Figma import is not configured on this Seltra gateway.",
          );
        let body: { url?: unknown };
        try {
          body = JSON.parse(
            (await readBody(request, 8 * 1024)).toString("utf8"),
          ) as { url?: unknown };
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(
            400,
            "INVALID_FIGMA_REQUEST",
            "Figma import requires a JSON body with a design URL.",
          );
        }
        if (typeof body.url !== "string" || body.url.length > 2_000)
          throw new HttpError(
            400,
            "INVALID_FIGMA_URL",
            "Figma import requires a valid design URL.",
          );
        try {
          parseFigmaFileUrl(body.url);
          const reference = await retrieveFigmaReference(
            body.url,
            config.FIGMA_ACCESS_TOKEN,
          );
          sendJson(response, 200, { reference });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Figma import failed.";
          const status =
            message === "Figma import is not configured."
              ? 503
              : message.startsWith("Only HTTPS") ||
                  message.startsWith("The Figma link") ||
                  message.startsWith("Paste a valid")
                ? 400
                : message.includes("could not be reached")
                  ? 502
                  : 422;
          throw new HttpError(status, "FIGMA_IMPORT_FAILED", message);
        }
        return;
      }
      const match = url.pathname.match(/^\/api\/rpc\/([^/]+)$/);
      if (match && request.method === "POST") {
        const channel = decodeURIComponent(match[1]);
        const requestStartedAt = Date.now();
        let logStatus = 500;
        response.once("finish", () =>
          console.log(
            JSON.stringify({
              time: new Date().toISOString(),
              userId: claims.sub,
              channel,
              status: logStatus,
              durationMs: Date.now() - requestStartedAt,
            }),
          ),
        );
        if (!isWebChannelAllowed(channel))
          throw new HttpError(
            403,
            "CHANNEL_DISABLED",
            "This IPC channel is unavailable in the web runtime.",
          );
        logStatus = 403;
        const runtimeSessionId = request.headers["x-runtime-session"];
        if (
          typeof runtimeSessionId !== "string" ||
          sessionOwners.get(runtimeSessionId)?.sub !== claims.sub ||
          sessionOwners.get(runtimeSessionId)?.workspaceId !== claims.workspaceId
        )
          throw new HttpError(
            403,
            "SESSION_FORBIDDEN",
            "Runtime session does not belong to this user.",
          );
        const body = await readBody(request, MAX_RPC_BODY_BYTES);
        const abort = new AbortController();
        request.once("aborted", () => abort.abort());
        response.once("close", () => {
          if (!response.writableEnded) abort.abort();
        });
        const workspaceRuntime = await runtimeFor(claims);
        const upstream = await fetch(
          workspaceRuntime.baseUrl + "/rpc/" + encodeURIComponent(channel),
          {
            method: "POST",
            headers: {
              authorization: "Bearer " + workspaceRuntime.rpcSecret,
              "content-type": "application/json",
              "x-runtime-session": runtimeSessionId,
            },
            body: new Uint8Array(body),
            signal: abort.signal,
          },
        );
        let result: unknown;
        try {
          result = JSON.parse(await upstream.text());
        } catch {
          result = {
            ok: false,
            error: {
              code: "RUNTIME_INVALID_RESPONSE",
              message: "Runtime returned an invalid response.",
            },
          };
        }
        if ((channel === "create-app" || channel === "list-apps") && result && typeof result === "object") {
          const rpcResponse = result as { ok?: boolean; result?: unknown };
          let value = rpcResponse.result;
          // Runtime IPC handlers return a typed IPC envelope inside the RPC
          // response. Core's own browser bridge unwraps it. Read the same
          // success value here so TenantApp sync sees create-app/list-apps.
          if (value && typeof value === "object" &&
            (value as { __dyadIpcEnvelope?: unknown }).__dyadIpcEnvelope === "dyad-ipc-envelope-v1") {
            const ipc = value as { ok?: boolean; value?: unknown };
            value = ipc.ok ? ipc.value : undefined;
          }
          const appCandidates = channel === "create-app"
            ? [value && typeof value === "object" ? (value as { app?: unknown }).app : undefined]
            : value && typeof value === "object" && Array.isArray((value as { apps?: unknown }).apps)
              ? (value as { apps: unknown[] }).apps
              : [];
          for (const candidate of appCandidates) {
            if (!candidate || typeof candidate !== "object") continue;
            const app = candidate as { id?: unknown; name?: unknown };
            if (typeof app.id !== "number" || !Number.isSafeInteger(app.id) || typeof app.name !== "string") continue;
            await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/builder/apps/sync`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-core-service-secret": config.CORE_SERVICE_SECRET },
              body: JSON.stringify({ tenantId: claims.workspaceId, coreAppId: app.id, name: app.name, status: "draft" }),
              signal: AbortSignal.timeout(5_000),
            }).then((sync) => {
              if (!sync.ok) console.error(JSON.stringify({ event: "tenant_app_sync_failed", tenantId: claims.workspaceId, appId: app.id, status: sync.status }));
            }).catch(() => console.error(JSON.stringify({ event: "tenant_app_sync_failed", tenantId: claims.workspaceId, appId: app.id })));
          }
        }
        const rewritten = await rewriteWithPreviewTokens(result, claims);
        logStatus = upstream.status;
        sendJson(response, upstream.status, rewritten);
        return;
      }
      if (url.pathname === "/api/auth/me")
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
      throw new HttpError(404, "NOT_FOUND", "Not found.");
    }
    throw new HttpError(404, "NOT_FOUND", "Not found.");
  }

  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", "http://gateway.invalid");
        if (!primaryHost(request, config)) {
          const host = (request.headers.host ?? "").split(":")[0].toLowerCase();
          const suffix = "." + config.PREVIEW_BASE_DOMAIN.toLowerCase();
          if (!host.endsWith(suffix))
            throw new HttpError(404, "NOT_FOUND", "Not found.");
          const label = host.slice(0, -suffix.length);
          const previewOrigin = request.headers.origin;
          if (previewOrigin) {
            const publicPort =
              config.previewPort === undefined ? "" : ":" + config.previewPort;
            const expectedOrigin =
              config.previewScheme +
              "://" +
              label +
              "." +
              config.PREVIEW_BASE_DOMAIN +
              publicPort;
            if (previewOrigin !== expectedOrigin)
              throw new HttpError(
                403,
                "PREVIEW_ORIGIN_FORBIDDEN",
                "Preview origin is not allowed.",
              );
          }
          const queryToken = url.searchParams.get("preview_token") ?? undefined;
          const queryClaims = await validPreviewToken(queryToken, label, ["preview"]);
          const cookieClaims = queryClaims ? null : await validPreviewToken(cookies(request).get("seltra_preview"), label, ["preview", "preview_session"]);
          const claims = queryClaims ?? cookieClaims;
          if (!claims) throw new HttpError(401, "PREVIEW_TOKEN_REQUIRED", "Preview token required.");
          await assertEntitlement(claims);
          if (url.searchParams.has("preview_token")) {
            url.searchParams.delete("preview_token");
            request.url = url.pathname + url.search;
          }
          const port = await resolvePreviewPort(label, claims);
          const internalPreviewHost = `app-${label.match(/-app-(\d+)$/)?.[1]}.localhost:${port}`;
          const internalPreviewOrigin = "http://" + internalPreviewHost;
          previewProxy.ws(request, socket, head, {
            target: "http://127.0.0.1:" + port,
            headers: {
              host: internalPreviewHost,
              origin: internalPreviewOrigin,
            },
          });
          return;
        }
        if (url.pathname !== "/api/events")
          throw new HttpError(404, "NOT_FOUND", "Not found.");
        checkOrigin(request);
        const ticket = url.searchParams.get("ticket");
        if (!ticket || ticket.length > 4096) throw new HttpError(401, "WS_TICKET_REQUIRED", "A websocket ticket is required.");
        let redeemed: { workspaceId?: string; userId?: string; coreWorkspaceKey?: string; storeSlug?: string; email?: string; plan?: string };
        try {
          const result = await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/internal/core/ws-ticket/redeem`, {
            method: "POST", headers: { "content-type": "application/json", "x-core-service-secret": config.CORE_SERVICE_SECRET },
            body: JSON.stringify({ ticket }), signal: AbortSignal.timeout(5_000),
          });
          if (!result.ok) throw new Error("ticket rejected");
          redeemed = await result.json() as typeof redeemed;
        } catch { throw new HttpError(401, "WS_TICKET_INVALID", "Websocket ticket is invalid or expired."); }
        if (!redeemed.workspaceId || !redeemed.userId || !redeemed.coreWorkspaceKey || !redeemed.storeSlug || !redeemed.email || !redeemed.plan)
          throw new HttpError(401, "WS_TICKET_INVALID", "Websocket ticket is invalid or expired.");
        const claims: SessionClaims = { workspaceId: redeemed.workspaceId, sub: redeemed.userId, coreWorkspaceKey: redeemed.coreWorkspaceKey, storeSlug: redeemed.storeSlug, email: redeemed.email, plan: redeemed.plan };
        await assertEntitlement(claims);
        const workspaceRuntime = await runtimeFor(claims);
        url.searchParams.delete("ticket");
        request.url = url.pathname + url.search;
        wss.handleUpgrade(request, socket, head, (browser) => {
          const eventsUrl = new URL(workspaceRuntime.baseUrl + "/events");
          eventsUrl.protocol = eventsUrl.protocol === "https:" ? "wss:" : "ws:";
          const runtime = new WebSocket(eventsUrl, {
            headers: { authorization: "Bearer " + workspaceRuntime.rpcSecret },
          });
          const pair: EventSession = { userId: claims.sub, workspaceId: claims.workspaceId, browser, runtime };
          eventSessions.add(pair);
          const openedAt = Date.now();
          let runtimeSessionId: string | undefined;
          let closed = false;
          let browserAlive = true;
          let runtimeAlive = true;
          let queuedRuntimeBytes = 0;
          let runtimeMessageQueue = Promise.resolve();
          const authLifetimeTimer = setTimeout(() => closeBoth("gateway", 1008, "Builder session expired"), 10 * 60_000);
          authLifetimeTimer.unref();
          const sessionReadyTimer = setTimeout(() => {
            if (!runtimeSessionId) closeBoth("gateway", 1011, "Runtime session handshake timed out");
          }, 20_000);
          sessionReadyTimer.unref();
          const heartbeatTimer = setInterval(() => {
            if (closed) return;
            if (!browserAlive || !runtimeAlive) {
              closeBoth("gateway", 1011, "WebSocket heartbeat timed out");
              return;
            }
            browserAlive = false;
            runtimeAlive = false;
            try {
              if (browser.readyState === WebSocket.OPEN) browser.ping();
              if (runtime.readyState === WebSocket.OPEN) runtime.ping();
            } catch {
              closeBoth("gateway", 1011, "WebSocket heartbeat failed");
            }
          }, 30_000);
          heartbeatTimer.unref();
          const closeBoth = (
            who: "browser" | "runtime" | "gateway",
            code = 1001,
            reason = "Connection closed",
          ) => {
            console.info(
              JSON.stringify({
                event: "websocket_close",
                endpoint: "/api/events",
                who,
                code,
                reason: reason.slice(0, 120),
                sessionAgeMs: Date.now() - openedAt,
                browserBufferedBytes: browser.bufferedAmount,
                runtimeBufferedBytes: runtime.bufferedAmount,
                queuedRuntimeBytes,
              }),
            );
            if (closed) return;
            closed = true;
            clearTimeout(authLifetimeTimer);
            clearTimeout(sessionReadyTimer);
            clearInterval(heartbeatTimer);
            const forwardedCode =
              code === 1005 || code === 1006 || code === 1015 ? 1011 : code;
            if (browser.readyState < WebSocket.CLOSING)
              browser.close(forwardedCode, reason.slice(0, 120));
            if (runtime.readyState < WebSocket.CLOSING)
              runtime.close(forwardedCode, reason.slice(0, 120));
            if (runtimeSessionId) sessionOwners.delete(runtimeSessionId);
            eventSessions.delete(pair);
          };
          runtime.on("message", (data, isBinary) => {
            const size = isBinary
              ? Buffer.isBuffer(data)
                ? data.byteLength
                : Buffer.byteLength(data.toString())
              : Buffer.byteLength(data.toString());
            queuedRuntimeBytes += size;
            if (
              runtime.bufferedAmount > config.GATEWAY_WS_BUFFER_LIMIT ||
              browser.bufferedAmount > config.GATEWAY_WS_BUFFER_LIMIT ||
              queuedRuntimeBytes > config.GATEWAY_WS_BUFFER_LIMIT
            ) {
              closeBoth("gateway", 1009, "Backpressure limit exceeded");
              return;
            }
            runtimeMessageQueue = runtimeMessageQueue
              .then(async () => {
                try {
                  if (closed || browser.readyState !== WebSocket.OPEN) return;
                  let outgoing: Buffer | string = isBinary
                    ? Buffer.isBuffer(data)
                      ? data
                      : Array.isArray(data)
                        ? Buffer.concat(data)
                        : Buffer.from(data)
                    : data.toString();
                  if (!isBinary) {
                    try {
                      const frame = JSON.parse(data.toString()) as {
                        channel?: string;
                        payload?: { id?: unknown };
                      };
                      if (
                        frame.channel === "web:session" &&
                        typeof frame.payload?.id === "string"
                      ) {
                        runtimeSessionId = frame.payload.id;
                        clearTimeout(sessionReadyTimer);
                        sessionOwners.set(runtimeSessionId, claims);
                      }
                      outgoing = JSON.stringify(
                        await rewriteWithPreviewTokens(frame, claims),
                      );
                    } catch {
                      /* forward opaque engine events unchanged */
                    }
                  }
                  if (browser.readyState === WebSocket.OPEN)
                    browser.send(outgoing, { binary: isBinary });
                } finally {
                  queuedRuntimeBytes = Math.max(0, queuedRuntimeBytes - size);
                }
              })
              .catch(() => {
                closeBoth("gateway", 1011, "WebSocket forwarding failed");
              });
          });
          browser.on("pong", () => { browserAlive = true; });
          runtime.on("pong", () => { runtimeAlive = true; });
          browser.on("message", (data, isBinary) => {
            if (
              browser.bufferedAmount > config.GATEWAY_WS_BUFFER_LIMIT ||
              runtime.bufferedAmount > config.GATEWAY_WS_BUFFER_LIMIT
            ) {
              closeBoth("gateway", 1009, "Backpressure limit exceeded");
              return;
            }
            if (runtime.readyState === WebSocket.OPEN)
              runtime.send(data, { binary: isBinary });
          });
          browser.once("close", (code, reason) =>
            closeBoth("browser", code, reason.toString()),
          );
          runtime.once("close", (code, reason) =>
            closeBoth("runtime", code, reason.toString()),
          );
          browser.once("error", () =>
            closeBoth("browser", 1011, "Browser connection failed"),
          );
          runtime.once("error", () =>
            closeBoth("runtime", 1011, "Runtime connection failed"),
          );
        });
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        console.error(JSON.stringify({
          event: "websocket_upgrade_rejected",
          endpoint: "/api/events",
          status,
          code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        }));
        socket.write(
          "HTTP/1.1 " +
            status +
            " " +
            (status === 401
              ? "Unauthorized"
              : status === 403
                ? "Forbidden"
                : "Not Found") +
            "\r\nConnection: close\r\n\r\n",
        );
        socket.destroy();
      }
    })();
  });

  function onShutdown(): void {
    for (const pair of eventSessions) {
      pair.browser.close(1001, "Gateway shutting down");
      pair.runtime.close(1001, "Gateway shutting down");
    }
    previewProxy.close();
    void supervisor.close();
    void prismaClient?.$disconnect();
    void nest.close();
  }
  process.once("SIGINT", onShutdown);
  process.once("SIGTERM", onShutdown);
  const address = server.address();
  console.log(
    JSON.stringify({
      event: "gateway_listening",
      host: config.GATEWAY_HOST,
      port:
        typeof address === "object" && address
          ? address.port
          : config.GATEWAY_PORT,
    }),
  );
}

void main();

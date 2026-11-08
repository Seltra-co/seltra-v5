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
import { assertCorePublicUrlResolvable, assertModelProviderReachable, classifyModelStartupFailure } from "./startup_checks.js";
import { redactSensitiveText } from "./security.js";
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
import { isPrimaryGatewayHost } from "../../src/web/primary_gateway_host.js";
import { rewritePreviewUrls } from "../../src/web/preview_urls.js";
import { WorkspaceSupervisor, type WorkspaceRuntime } from "./workspace_supervisor.js";
import {
  parseFigmaFileUrl,
  retrieveFigmaReference,
} from "../../src/web/figma_reference.js";
import { logError } from "./logger.js";
import { GithubPublisher } from "./publish/github.js";
import { R2ObjectStore } from "./publish/r2.js";
import { WorkspaceDurability } from "./publish/snapshot.js";
import { EditLeaseClient } from "./publish/edit_lease.js";
import { VercelPublisher } from "./publish/vercel.js";
import { PublishOrchestrator } from "./publish/orchestrator.js";
import { resolvePromptIntent } from "./prompt_intent.js";

const encoder = new TextEncoder();
// Chat attachments are sent as base64 in the distributed-machine intent.
// The UI permits 25 MiB of source files, which expands to ~33.4 MiB on the
// wire before the prompt and RPC envelope are added.
const MAX_RPC_BODY_BYTES = 40 * 1024 * 1024;
const MAX_RPC_WEBSOCKET_PAYLOAD_BYTES = 1024 * 1024;
const MAX_MODEL_BODY_BYTES = 10 * 1024 * 1024;
const MAX_WORKSPACE_SYNC_BODY_BYTES = 10 * 1024 * 1024;
const WS_TICKET_REDEEM_TIMEOUT_MS = 15_000;
const WORKSPACE_SYNC_IGNORED_NAMES = new Set([
  ".git",
  ".next",
  "build",
  "dist",
  "logs",
  "node_modules",
  "runtime-secrets.key",
  "temp",
  "userdata",
]);

function isWorkspaceSyncPathAllowed(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const mediaParts = normalized.split("/").filter(Boolean);
  const dyadIndex = mediaParts.lastIndexOf(".dyad");
  const isDyadRoot = dyadIndex >= 0 && mediaParts.length === dyadIndex + 1;
  const isDyadMedia = dyadIndex >= 0 && mediaParts[dyadIndex + 1] === "media";
  const mediaContainer = isDyadRoot || (isDyadMedia && mediaParts.length <= dyadIndex + 2);
  const mediaImage = isDyadMedia && /\.(?:png|jpe?g|webp|gif|avif)$/i.test(normalized);
  if (segments.some((segment) => segment.startsWith(".")) && !mediaContainer && !mediaImage) return false;
  return segments.every((segment) => {
    const name = segment.toLowerCase();
    return !WORKSPACE_SYNC_IGNORED_NAMES.has(name) &&
      !/^\.env(?:\.|$)/i.test(name) &&
      !/\.(?:key|pem|p12|pfx)$/i.test(name) &&
      !/^(?:credentials|service-account)(?:\.|$)/i.test(name);
  });
}

function isRasterImagePath(relativePath: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|avif)$/i.test(relativePath);
}

type SessionClaims = { sub: string; email: string; workspaceId: string; creditWorkspaceId?: string; coreWorkspaceKey: string; storeSlug: string; plan: string };
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
  dayKey: string;
  day: UsageBucket;
};
type EventSession = { userId: string; workspaceId: string; browser: WebSocket; runtime: WebSocket };
// A workspace may have more than one browser/RPC socket. Share one durable
// file snapshot sync across those sockets to avoid duplicate blob inserts and
// connection-pool pressure. The periodic sync will pick up edits made mid-run.
const workspaceFileSyncs = new Map<string, Promise<void>>();

async function syncWorkspaceFileBatches(
  config: GatewayConfig,
  claims: Pick<SessionClaims, "workspaceId" | "creditWorkspaceId">,
  files: Array<{ path: string; content: string }>,
  appId?: number,
): Promise<void> {
  const key = claims.workspaceId;
  const active = workspaceFileSyncs.get(key);
  if (active) return active;
  const operation = performWorkspaceFileBatches(config, claims, files, appId);
  workspaceFileSyncs.set(key, operation);
  try {
    await operation;
  } finally {
    if (workspaceFileSyncs.get(key) === operation) workspaceFileSyncs.delete(key);
  }
}

async function performWorkspaceFileBatches(
  config: GatewayConfig,
  claims: Pick<SessionClaims, "workspaceId" | "creditWorkspaceId">,
  files: Array<{ path: string; content: string }>,
  appId?: number,
): Promise<void> {
  const batches: Array<Array<{ path: string; content: string }>> = [];
  let batch: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    const candidate = [...batch, file];
    const body = JSON.stringify({ tenantId: claims.workspaceId, workspaceId: claims.creditWorkspaceId ?? claims.workspaceId, ...(appId ? { coreAppId: appId } : {}), files: candidate });
    if (Buffer.byteLength(body, "utf8") > MAX_WORKSPACE_SYNC_BODY_BYTES) {
      if (batch.length) batches.push(batch);
      batch = [file];
      const singleFileBody = JSON.stringify({ tenantId: claims.workspaceId, workspaceId: claims.creditWorkspaceId ?? claims.workspaceId, ...(appId ? { coreAppId: appId } : {}), files: batch });
      if (Buffer.byteLength(singleFileBody, "utf8") > MAX_WORKSPACE_SYNC_BODY_BYTES) {
        batch = [];
        console.error(JSON.stringify({ event: "workspace_file_sync_skipped", tenantId: claims.workspaceId, path: file.path, reason: "file_exceeds_sync_payload_limit" }));
      }
    } else {
      batch = candidate;
    }
  }
  if (batch.length) batches.push(batch);

  for (const filesBatch of batches) {
    const response = await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/builder/workspace/files-sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-core-service-secret": config.CORE_SERVICE_SECRET },
      body: JSON.stringify({ tenantId: claims.workspaceId, workspaceId: claims.creditWorkspaceId ?? claims.workspaceId, ...(appId ? { coreAppId: appId } : {}), files: filesBatch }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "workspace_files_sync_failed", tenantId: claims.workspaceId, appId, status: response.status }));
      return;
    }
  }
}

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
}

function frameAncestors(config: GatewayConfig): string {
  return ["'self'", ...config.allowedOrigins].join(" ");
}

function setPreviewFrameHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  config: GatewayConfig,
): void {
  const host = (request.headers.host ?? "").split(":")[0].toLowerCase();
  const previewSuffix = "." + config.PREVIEW_BASE_DOMAIN.toLowerCase();
  if (!host.endsWith(previewSuffix)) return;
  response.removeHeader("X-Frame-Options");
  response.setHeader(
    "Content-Security-Policy",
    `frame-ancestors ${frameAncestors(config)}; default-src 'none'; script-src 'unsafe-inline'`,
  );
}

function refererOrigin(request: IncomingMessage): string | null {
  const referer = request.headers.referer;
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
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

function sendSse(response: ServerResponse, event: string, data: unknown, id?: number): void {
  if (response.destroyed || response.writableEnded) return;
  if (id !== undefined) response.write(`id: ${id}\n`);
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
  return isPrimaryGatewayHost(request.headers.host, config);
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

// Image payloads are transported as base64, but their encoded byte count is
// not a useful estimate of vision tokens. Count a conservative allowance per
// image and estimate the rest of the request from its serialized text.
const IMAGE_CONTEXT_TOKEN_ESTIMATE = 16_384;
function modelInputTokenCount(value: unknown): number {
  let imageCount = 0;
  try {
    const serialized = JSON.stringify(value, (key, child: unknown) => {
      if (typeof child !== "string") return child;
      const isImageDataUrl = /^data:image\/[^;,]+;base64,/i.test(child);
      const isRawImagePayload = key === "image" && child.length > 4_096;
      if (isImageDataUrl || isRawImagePayload) {
        imageCount += 1;
        return "[image content]";
      }
      return child;
    });
    return Math.ceil(serialized.length / 4) + imageCount * IMAGE_CONTEXT_TOKEN_ESTIMATE;
  } catch {
    return tokenCount(value);
  }
}

function containsImageInput(value: unknown): boolean {
  if (typeof value === "string") return /^data:image\//i.test(value);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsImageInput);
  const item = value as Record<string, unknown>;
  if (typeof item.type === "string" && /^(image|image_url|input_image)$/i.test(item.type)) return true;
  if (typeof item.image_url === "string" || typeof item.image === "string") return true;
  return Object.values(item).some(containsImageInput);
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
  type?: string;
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
  const type = error?.type ?? firstProviderError?.type;
  const message = error?.message ?? firstProviderError?.message;
  return {
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(typeof type === "string" ? { type: redactSensitiveText(type).slice(0, 80) } : {}),
    ...(typeof message === "string"
      ? {
          message: redactSensitiveText(message).slice(0, 300),
        }
      : {}),
  };
}

function statusMessage(_status: number, _role: string, _model: string): string {
  return "Something went wrong on our side. Try again.";
}

function internalModelErrorCode(status: number, error: unknown): string {
  const codes: string[] = [];
  let current = error as { code?: unknown; name?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current.code === "string") codes.push(current.code.toUpperCase());
    if (typeof current.name === "string") codes.push(current.name.toUpperCase());
    current = current.cause as typeof current;
  }
  if (codes.some((code) => ["ENOTFOUND", "EAI_AGAIN", "ENODATA", "EAI_FAIL"].includes(code))) return "MODEL_DNS_FAILURE";
  if (codes.some((code) => ["TIMEOUTERROR", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code))) return "MODEL_TIMEOUT";
  if (status === 401) return "MODEL_PROVIDER_401";
  if (status === 403) return "MODEL_PROVIDER_403";
  if (status >= 500) return "MODEL_PROVIDER_5XX";
  if (status === 0) return "MODEL_NETWORK_FAILURE";
  return `MODEL_PROVIDER_HTTP_${status}`;
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
  if (config.EXECUTION_PROVIDER === "cloudflare") {
    const missing = [
      ...(!config.SANDBOX_GATEWAY_URL ? ["SANDBOX_GATEWAY_URL"] : []),
      ...(!config.SANDBOX_GATEWAY_SIGNING_SECRET?.trim() ? ["SANDBOX_GATEWAY_SIGNING_SECRET"] : []),
      ...(!config.CORE_PUBLIC_URL ? ["CORE_PUBLIC_URL"] : []),
    ];
    if (missing.length) {
      console.error(JSON.stringify({ event: "execution_provider_startup_refused", code: "CONFIG_MISSING", variables: missing }));
      process.exitCode = 1;
      return;
    }
  }
  if (process.env.NODE_ENV === "test") {
    console.info(JSON.stringify({ event: "ai_startup_selfcheck", status: "skipped", reason: "test environment" }));
  } else {
    try {
      await assertModelProviderReachable({
        provider: config.AI_PROVIDER,
        baseUrl: config.modelBaseUrl,
        apiKey: config.MODEL_API_KEY,
        model: config.AI_MODEL_REASONING?.trim() || config.AI_MODEL_DEFAULT,
        callbackUrl: config.CORE_PUBLIC_URL,
      });
        console.info(JSON.stringify({ event: "ai_startup_selfcheck", status: "passed", role: "planner" }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "ai_startup_selfcheck",
        status: "failed",
        code: classifyModelStartupFailure(error),
        errorName: error instanceof Error ? error.name : typeof error,
      }));
      process.exitCode = 1;
      return;
    }
  }
  if (config.EXECUTION_PROVIDER === "cloudflare") {
    try {
      await assertCorePublicUrlResolvable(config.CORE_PUBLIC_URL);
    } catch (error) {
      console.error(JSON.stringify({
        event: "core_callback_startup_check",
        status: "failed",
        code: "CORE_PUBLIC_URL_UNRESOLVABLE",
        message: error instanceof Error ? error.message : "Core callback URL is unavailable.",
      }));
      process.exitCode = 1;
      return;
    }
  }
  if (!process.env.DEPLOY_MODE?.trim() || !["hobby", "team"].includes(process.env.DEPLOY_MODE.trim().toLowerCase())) {
    console.warn(JSON.stringify({ event: "deploy_mode_defaulted", variable: "DEPLOY_MODE", mode: "team" }));
  }
  console.info(JSON.stringify({ event: "publish_config_validation", enabled: config.publish.enabled, passed: !config.publish.configurationErrors.length, missing: config.publish.configurationErrors }));
  if ((config.publish.enabled || config.publish.persistenceEnabled || config.publish.restoreEnabled) && config.publish.configurationErrors.length) {
    console.error(JSON.stringify({ event: "publish_startup_refused", code: "CONFIG_MISSING", variables: config.publish.configurationErrors }));
    process.exitCode = 1;
    return;
  }
  const workspaceRoot = path.resolve(config.WORKSPACE_ROOT);
  const legacyDataRoot = path.resolve(config.DATA_ROOT);
  const workspaceInsideLegacy = path.relative(legacyDataRoot, workspaceRoot);
  const legacyInsideWorkspace = path.relative(workspaceRoot, legacyDataRoot);
  if (!workspaceInsideLegacy.startsWith("..") && !path.isAbsolute(workspaceInsideLegacy) || !legacyInsideWorkspace.startsWith("..") && !path.isAbsolute(legacyInsideWorkspace)) {
    console.error(JSON.stringify({ event: "workspace_root_not_ephemeral", code: "CONFIG_INVALID", variables: ["WORKSPACE_ROOT", "DATA_ROOT"] }));
    process.exitCode = 1;
    return;
  }
  if ((config.NODE_ENV === "production" || config.RENDER !== undefined) && (!config.publish.persistenceEnabled || !config.publish.restoreEnabled)) {
    console.error(JSON.stringify({ event: "workspace_durability_startup_refused", code: "CONFIG_MISSING", variables: [
      ...(!config.publish.persistenceEnabled ? ["WORKSPACE_PERSISTENCE_ENABLED"] : []),
      ...(!config.publish.restoreEnabled ? ["WORKSPACE_RESTORE_ENABLED"] : []),
    ] }));
    process.exitCode = 1;
    return;
  }
  if ((config.publish.enabled || config.publish.persistenceEnabled || config.publish.restoreEnabled) && config.publish.routesBucket === config.publish.workspacesBucket) {
    console.info(JSON.stringify({ event: "r2_single_bucket_mode", message: "single-bucket mode; split before production" }));
  }
  const engineUrl = process.env.SELTRA_ENGINE_URL ?? process.env.DYAD_ENGINE_URL;
  console.info(
    `Seltra Engine configured: ${engineUrl ?? "<not configured>"} (key present: ${Boolean(process.env.SELTRA_ENGINE_API_KEY ?? process.env.DYAD_PRO_API_KEY) ? "yes" : "no"})`,
  );

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
  console.log(JSON.stringify({
    level: "info",
    event: "preview_config_startup",
    domain: config.PREVIEW_BASE_DOMAIN,
    scheme: config.previewScheme,
    port: config.previewPort ?? null,
    allowedOrigins: [...config.allowedOrigins],
    frameAncestors: frameAncestors(config),
  }));
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const durabilityEnabled = config.publish.persistenceEnabled || config.publish.restoreEnabled;
  const github = (config.publish.enabled || durabilityEnabled) ? new GithubPublisher({
    org: config.publish.githubOrg!, appId: config.publish.githubAppId!, installationId: config.publish.githubInstallationId!,
    privateKeyPem: config.publish.githubPrivateKeyPem!, mode: config.publish.deployMode, repoPrefix: config.publish.repoPrefix,
  }) : undefined;
  const objectStore = (config.publish.enabled || durabilityEnabled) ? new R2ObjectStore({
    endpoint: config.publish.r2Endpoint!, accountId: config.publish.r2AccountId!, accessKeyId: config.publish.r2AccessKeyId!, secretAccessKey: config.publish.r2SecretAccessKey!,
  }) : undefined;
  const durability = new WorkspaceDurability(config.publish, objectStore, github, config.NEST_INTERNAL_URL, config.CORE_SERVICE_SECRET, fetch, config.WORKSPACE_ROOT);
  const editLeases = new EditLeaseClient(config.NEST_INTERNAL_URL, config.CORE_SERVICE_SECRET);
  const vercel = config.publish.enabled ? new VercelPublisher({ vercelToken: config.publish.vercelToken, vercelTeamId: config.publish.vercelTeamId }) : undefined;
  const publishOrchestrator = new PublishOrchestrator(config.publish, objectStore, github, vercel, durability, config.NEST_INTERNAL_URL, config.CORE_SERVICE_SECRET);
  const publishBackend = async <T = Record<string, unknown>>(route: string, payload: Record<string, unknown>): Promise<T> => {
    const result = await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/internal/core/${route}`, {
      method: "POST", headers: { "content-type": "application/json", "x-core-service-secret": config.CORE_SERVICE_SECRET },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
    const body = await result.json().catch(() => ({})) as Record<string, unknown>;
    if (!result.ok) throw new HttpError(result.status, typeof body.code === "string" ? body.code : "BACKEND_REJECTED", typeof body.message === "string" ? body.message : "Backend rejected the request.");
    return body as T;
  };
  const supervisor = new WorkspaceSupervisor({
    root: runtimeRoot,
    dataRoot: path.resolve(config.WORKSPACE_ROOT),
    maxActive: config.MAX_ACTIVE_WORKSPACES,
    idleMs: config.WORKSPACE_IDLE_TTL_SECONDS * 1000,
    publicApiUrl: config.publish.publicApiUrl ?? config.SELTRA_PUBLIC_API_URL,
    env: process.env,
    onWorkspaceCleanupPending: async (projectId, workspaceKey) => { await publishBackend('workspace-cleanup/pending', { projectId, workspaceKey }) },
    ...(config.publish.restoreEnabled ? {
      restoreBeforeStart: (workspaceKey: string, workspaceRoot: string) => durability.restoreBeforeStart(workspaceKey, workspaceRoot),
    } : {}),
    ...(config.publish.persistenceEnabled ? {
      persistBeforeIdleStop: async (runtime: WorkspaceRuntime) => { await durability.persist(runtime, "idle"); return true; },
    } : {}),
  });
  await supervisor.assertExecutionReady();
  const devOnlyHostExecution = supervisor.executionMode === "host";
  console.info(JSON.stringify({ event: "execution_provider_ready", provider: supervisor.executionMode, isolated: !devOnlyHostExecution }));
  if (devOnlyHostExecution) {
    console.warn("NOT ISOLATED - DEV ONLY: workspace code runs as a host process.");
  }
  durability.start(() => supervisor.listRuntimes());
  const gatewayWorkspaceReaper = setInterval(() => {
    void (async () => {
      try {
        const active = await publishBackend<{ workspaceKeys: string[] }>('workspaces/active', {});
        const result = await supervisor.reapGatewayWorkspaces(new Set(active.workspaceKeys), config.WORKSPACE_GATEWAY_IDLE_TIMEOUT_SECONDS * 1000);
        if (result.destroyed) console.info(JSON.stringify({ event: 'gateway_workspace_reap', scanned: result.scanned, destroyed: result.destroyed }));
      } catch (error) {
        console.error(JSON.stringify({ event: 'gateway_workspace_reap_failed', code: error instanceof Error ? error.name : 'unknown' }));
      }
    })();
  }, config.WORKSPACE_GATEWAY_REAPER_INTERVAL_SECONDS * 1000);
  gatewayWorkspaceReaper.unref();
  const entitlementCache = new Map<string, { expiresAt: number; active: boolean; reason?: string; engineApiKey: string }>();
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
  const previewRuntimes = new WeakMap<IncomingMessage, WorkspaceRuntime>();
  const nest = await NestFactory.create(GatewayModule, { logger: false });
  traceStartup("nest_created");
  nest.use((request: IncomingMessage, response: ServerResponse) => {
    setSecurityHeaders(response);
    setPreviewFrameHeaders(request, response, config);
    let responseReason = "";
    response.once("finish", () => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        console.warn(JSON.stringify({
          event: "gateway_http_error",
          method: request.method,
          path: new URL(request.url ?? "/", "http://gateway.invalid").pathname,
          status: response.statusCode,
          reason: responseReason || response.statusMessage || "HTTP_ERROR",
        }));
      }
    });
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
      responseReason = `${err.code}: ${err.message}`;
      if (err.code === "PREVIEW_TOKEN_REQUIRED" || err.code === "PREVIEW_NOT_FOUND") {
        const host = (request.headers.host ?? "").split(":")[0].toLowerCase();
        const previewSuffix = "." + config.PREVIEW_BASE_DOMAIN.toLowerCase();
        const label = host.endsWith(previewSuffix)
          ? host.slice(0, -previewSuffix.length)
          : "";
        console.warn(JSON.stringify({
          event: "preview_rejected",
          host,
          label,
          hasToken: Boolean(
            new URL(request.url ?? "/", "http://gateway.invalid").searchParams.get("preview_token"),
          ),
          code: err.code,
          refererOrigin: refererOrigin(request),
        }));
      }
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
            `frame-ancestors ${frameAncestors(config)}; default-src 'none'; script-src 'unsafe-inline'`,
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
          if (isNavigation && (
            /^ws-[a-f0-9]{12}-app-[1-9]\d{0,14}$/.test(label) ||
            /^app-[1-9]\d{0,14}$/.test(label)
          )) {
            const message = JSON.stringify({
              type: "seltra:preview-auth-expired",
              label,
            }).replaceAll("<", "\\u003c");
            const targetOrigins = [...config.allowedOrigins]
              .map((origin) => JSON.stringify(origin).replaceAll("<", "\\u003c"));
            response.writeHead(401, {
              "content-type": "text/html; charset=utf-8",
            });
            response.end(
              `<!doctype html><meta charset="utf-8"><title>Preview access expired</title><p>Refreshing preview...</p><script>${targetOrigins.map((targetOrigin) => `parent.postMessage(${message},${targetOrigin});`).join("")}</script>`,
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
    maxPayload: MAX_RPC_WEBSOCKET_PAYLOAD_BYTES,
  });

  previewProxy.on("proxyReq", (proxyRequest) => {
    proxyRequest.removeHeader("cookie");
    proxyRequest.removeHeader("authorization");
    proxyRequest.removeHeader("x-runtime-session");
  });
  previewProxy.on("proxyReq", (proxyRequest, request) => {
    const runtime = previewRuntimes.get(request);
    if (!runtime?.signGatewayRequest) return;
    for (const [name, value] of Object.entries(runtime.signGatewayRequest(request.method ?? "GET", proxyRequest.path ?? "/"))) proxyRequest.setHeader(name, value);
  });
  previewProxy.on("proxyReqWs", (proxyRequest, request) => {
    const runtime = previewRuntimes.get(request);
    if (!runtime?.signGatewayRequest) return;
    for (const [name, value] of Object.entries(runtime.signGatewayRequest("GET", proxyRequest.path ?? "/"))) proxyRequest.setHeader(name, value);
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
    const cspHeader = proxyResponse.headers["content-security-policy"];
    const rewriteCsp = (value: string): string => {
      const directives = value
        .split(";")
        .map((directive) => directive.trim())
        .filter((directive) => directive && !/^frame-ancestors(?:\s|$)/i.test(directive));
      directives.push(`frame-ancestors ${frameAncestors(config)}`);
      return directives.join("; ");
    };
    if (Array.isArray(cspHeader)) {
      proxyResponse.headers["content-security-policy"] = cspHeader.map(rewriteCsp);
    } else if (typeof cspHeader === "string") {
      proxyResponse.headers["content-security-policy"] = rewriteCsp(cspHeader);
    } else {
      proxyResponse.headers["content-security-policy"] =
        `frame-ancestors ${frameAncestors(config)}`;
    }
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
      await assertEntitlement(claims, true);
      await store.getOrCreateWorkspace(claims.sub, claims.workspaceId, claims.email);
      return claims;
    } catch (error) {
      // Preserve typed entitlement failures such as CREDITS_EXHAUSTED instead
      // of turning them into a generic missing-token response.
      if (error instanceof HttpError) throw error;
      return null;
    }
  }

  async function assertEntitlement(claims: SessionClaims, allowExhausted = false) {
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
      const entitlement = await response.json() as { active?: boolean; reason?: string; userId?: string; creditWorkspaceId?: string; coreWorkspaceKey?: string; storeSlug?: string; engineApiKey?: string };
      if (entitlement.userId !== claims.sub || entitlement.coreWorkspaceKey !== claims.coreWorkspaceKey || entitlement.storeSlug !== claims.storeSlug)
        throw new HttpError(403, "WORKSPACE_FORBIDDEN", "Builder token does not match this workspace.");
      if (typeof entitlement.engineApiKey !== "string" || !/^sk_seltra_[A-Za-z0-9_-]{40,}$/.test(entitlement.engineApiKey))
        throw new HttpError(503, "ENGINE_KEY_UNAVAILABLE", "A workspace-scoped Seltra Engine key is unavailable.");
      result = { active: entitlement.active === true, reason: entitlement.reason, engineApiKey: entitlement.engineApiKey, expiresAt: Date.now() + 60_000 };
      entitlementCache.set(claims.workspaceId, result);
    }
    if (result.reason === "credits_exhausted" && !allowExhausted)
        throw new HttpError(402, "CREDITS_EXHAUSTED", "Seltra daily account token allowance is used. Your project and saved changes are safe; credits are shared across your projects and reset at midnight UTC.");
    if (!result.active) {
      throw new HttpError(403, "WORKSPACE_INACTIVE", "Builder access is not active for this workspace.");
    }
    return { engineApiKey: result.engineApiKey };
  }

  async function runtimeFor(claims: Pick<SessionClaims, "sub" | "email" | "plan" | "workspaceId" | "coreWorkspaceKey" | "storeSlug">): Promise<WorkspaceRuntime> {
    let runtime: WorkspaceRuntime;
    try {
      const entitlement = await assertEntitlement(claims, true);
      runtime = await supervisor.get(claims.workspaceId, claims.coreWorkspaceKey, claims.storeSlug, claims.sub, entitlement.engineApiKey);
    } catch (error) {
      const status = Number((error as { status?: number }).status) || 503;
      throw new HttpError(status, String((error as { code?: string }).code ?? "WORKSPACE_RUNTIME_UNAVAILABLE"), (error as Error).message || "Workspace runtime is unavailable.");
    }
    modelTokens.set(runtime.modelToken, claims);
    return runtime;
  }

  publishOrchestrator.startQueueWorker((identity) => runtimeFor({
    sub: identity.userId,
    email: identity.email,
    plan: identity.plan,
    workspaceId: identity.workspaceId,
    coreWorkspaceKey: identity.workspaceKey,
    storeSlug: identity.storeSlug,
  }));

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
            const bareAppMatch = label.match(/^app-([1-9]\d{0,14})$/);
            const normalizedLabel = bareAppMatch
              ? `ws-${claims.coreWorkspaceKey}-app-${bareAppMatch[1]}`
              : label;
            if (/^ws-[a-f0-9]{12}-app-[1-9]\d{0,14}$/.test(normalizedLabel)) {
              url.hostname = `${normalizedLabel}.${config.PREVIEW_BASE_DOMAIN}`;
              url.protocol = `${config.previewScheme}:`;
              url.port = config.previewScheme === "https" ? "" : (config.previewPort === undefined ? "" : String(config.previewPort));
              url.searchParams.set("preview_token", await issuePreviewToken(normalizedLabel, claims));
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

  async function resolvePreviewPort(label: string, claims: Pick<SessionClaims, "sub" | "email" | "plan" | "workspaceId" | "coreWorkspaceKey" | "storeSlug">): Promise<number | string> {
    const match = label.match(/^ws-([a-f0-9]{12})-app-([1-9]\d{0,14})$/);
    if (!match || match[1] !== claims.coreWorkspaceKey)
      throw new HttpError(404, "PREVIEW_NOT_FOUND", "Preview not found.");
    const appId = Number(match[2]);
    const runtime = await runtimeFor(claims);
    if (runtime.signGatewayRequest) return runtime.baseUrl.replace(/\/runtime$/, `/preview/${appId}`);
    const targetUrl = runtime.baseUrl + "/internal/preview-target/" + appId;
    const response = await fetch(
      targetUrl,
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
      await assertEntitlement(queryClaims, true);
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
    await assertEntitlement(cookieClaims, true);

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
    const today = utcDay();
    if (!state) {
      state = {
        inFlight: 0,
        runs: new Map(),
        dayKey: today,
        day: { requests: 0, tokens: 0, startedAt: Date.now() },
      };
      budgetStates.set(workspaceId, state);
    } else if (state.dayKey !== today) {
      state.dayKey = today;
      state.runs.clear();
      state.day = { requests: 0, tokens: 0, startedAt: Date.now() };
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
    const requestId =
      typeof request.headers["x-request-id"] === "string"
        ? request.headers["x-request-id"]
        : typeof request.headers["x-dyad-request-id"] === "string"
          ? request.headers["x-dyad-request-id"]
          : undefined;
    console.log(JSON.stringify({
      level: "info",
      event: "core_model_request_started",
      timestamp: new Date().toISOString(),
      requestId,
      method: request.method,
      path: request.url,
      modelsOnly,
    }));
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
    console.info(JSON.stringify({ event: 'core_project_phase', projectId: modelClaims.workspaceId, phase: 'model call start', at: new Date().toISOString(), requestId }));
    await assertEntitlement(modelClaims);
    if (modelsOnly) {
      sendJson(response, 200, {
        object: "list",
        data: [
          config.AI_MODEL_DEFAULT,
          config.AI_MODEL_REASONING || config.AI_MODEL_DEFAULT,
          config.AI_MODEL_FAST || config.AI_MODEL_DEFAULT,
          config.AI_MODEL_VISION,
          config.AI_MODEL_IMAGE,
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
    // Tool requests use the explicitly configured tool model. In Seltra web
    // deployments this is set to the same DeepSeek model as the builder, so
    // tool-enabled build turns stay on the configured provider/key instead of
    // silently switching to an unrelated fallback model.
    if (
      mapping.role === "builder" &&
      Array.isArray(body.tools) &&
      body.tools.length > 0 &&
      config.AI_MODEL_TOOL?.trim()
    ) {
      mapping = { ...mapping, model: config.AI_MODEL_TOOL.trim(), setting: "AI_MODEL_TOOL" };
    }
    // Builder turns containing image attachments must use the configured
    // vision model. DeepSeek V4 Flash 0731 and GLM 4.7 Flash support tools,
    // but they reject image inputs. Keep text-only requests on the builder.
    const hasImageInput = containsImageInput(body.messages);
    if (mapping.role === "builder" && hasImageInput) {
      if (!config.AI_MODEL_VISION?.trim()) {
        openAiError(response, 503, "VISION_MODEL_NOT_CONFIGURED", "Seltra image requests need a vision-capable model. Configure AI_MODEL_VISION and retry.");
        return;
      }
      mapping = { ...mapping, model: config.AI_MODEL_VISION.trim(), setting: "AI_MODEL_VISION" };
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

    const inputTokensEstimate = modelInputTokenCount(body.messages);
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
    const creditAccountId = modelClaims.creditWorkspaceId ?? modelClaims.sub;
    const state = budgetState(creditAccountId);
    const configuredWorkspaceLimit = config.MODEL_MAX_TOKENS_PER_WORKSPACE;
    const configuredProLimit = Number(process.env.SELTRA_PRO_MAX_TOKENS_PER_WORKSPACE ?? configuredWorkspaceLimit * 5);
    const accountTokenLimit = modelClaims.plan === 'premium' || modelClaims.plan === 'pro'
      ? (Number.isFinite(configuredProLimit) && configuredProLimit > 0 ? Math.floor(configuredProLimit) : configuredWorkspaceLimit * 5)
      : configuredWorkspaceLimit;
    const bucket = budgetBucket(state, runId);
    const requestTokens = inputTokensEstimate;
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
      state.day.tokens + requestTokens > accountTokenLimit
    ) {
      openAiError(
        response,
        429,
        "budget_exceeded",
        `Seltra workspace token budget exceeded (${state.day.tokens.toLocaleString()} estimated input tokens used; daily account limit ${accountTokenLimit.toLocaleString()}). Try again after the account budget resets.`,
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
    const compatibleFallbacks = hasImageInput
      ? []
      : Array.isArray(body.tools) && body.tools.length
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
                    providerErrorType: details.type,
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
            const errorRecord = error && typeof error === "object" ? error as { name?: string; code?: string; providerCode?: string | number; providerErrorType?: string; cause?: { code?: string } } : {};
            logError("model_provider_attempt_failed", {
              requestId: request.headers["x-request-id"],
              model: candidateModel,
              role: mapping.role,
              status,
              internalErrorCode: internalModelErrorCode(status, error),
              attempt: attempt + 1,
              streaming,
              providerHost: (() => { try { return new URL(config.modelBaseUrl).hostname } catch { return undefined } })(),
              errorName: errorRecord.name ?? typeof error,
              errorCode: errorRecord.code ?? errorRecord.cause?.code,
              providerCode: errorRecord.providerCode,
              providerErrorType: errorRecord.providerErrorType,
            });
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
      const message = "Something went wrong on our side. Try again.";
      errorClass =
        status === 401 || status === 403 || status === 404
          ? "config"
          : status === 400
            ? "client_error"
            : "retryable";
      const errorRecord = error && typeof error === "object" ? error as { name?: string; code?: string; providerCode?: string | number; providerErrorType?: string; cause?: { code?: string } } : {};
      logError("model_request_failed", {
        requestId: request.headers["x-request-id"],
        model: usedModel,
        role: mapping.role,
        status,
        internalErrorCode: internalModelErrorCode(status, error),
        errorClass,
        streaming,
        latencyMs: Date.now() - startedAt,
        retryable: errorClass === "retryable",
        errorName: errorRecord.name ?? typeof error,
        errorCode: errorRecord.code ?? errorRecord.cause?.code,
        providerCode: errorRecord.providerCode,
        providerErrorType: errorRecord.providerErrorType,
      });
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
      console.info(JSON.stringify({ event: 'core_project_phase', projectId: claimsWorkspace, phase: 'model call end', at: new Date().toISOString(), requestId: request.headers['x-request-id'] ?? null }));
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
        body: JSON.stringify({ tenantId: claimsWorkspace, workspaceId: modelClaims.creditWorkspaceId ?? claimsWorkspace, userId: modelClaims.sub, role: mapping.role, model: usedModel, tokensIn: inputTokens, tokensOut: outputTokens, cached: cachedInputTokens > 0, ok: succeeded, runId }),
        signal: AbortSignal.timeout(5_000),
      }).then((result) => {
        if (!result.ok) console.error(JSON.stringify({ event: "usage_report_failed", status: result.status }));
      }).catch(() => console.error(JSON.stringify({ event: "usage_report_failed" })));
      // The next model request must observe the just-committed account balance.
      entitlementCache.delete(claimsWorkspace);
    }
  }

  async function handleImageGenerationRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const modelClaims = modelTokens.get(bearer);
    const activeRuntime = modelClaims ? supervisor.getByKey(modelClaims.coreWorkspaceKey) : null;
    if (!bearer || !modelClaims || !activeRuntime || activeRuntime.modelToken !== bearer)
      throw new HttpError(401, "UNAUTHORIZED", "Invalid workspace model token.");
    await assertEntitlement(modelClaims);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "INVALID_REQUEST", "Request body must be valid JSON.");
    }
    if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 2048)
      throw new HttpError(400, "INVALID_REQUEST", "A non-empty image prompt of at most 2048 characters is required.");
    if (!config.AI_MODEL_IMAGE)
      throw new HttpError(503, "IMAGE_MODEL_NOT_CONFIGURED", "Image generation is unavailable: configure AI_MODEL_IMAGE.");
    if (!config.MODEL_API_KEY || !config.MODEL_ACCOUNT_ID)
      throw new HttpError(503, "MODEL_PROVIDER_NOT_CONFIGURED", "Image generation is unavailable: configure MODEL_API_KEY and MODEL_ACCOUNT_ID.");

    const model = config.AI_MODEL_IMAGE;
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.MODEL_ACCOUNT_ID}/ai/run/${model}`;
    const multipart = /flux-2-(?:dev|klein)/i.test(model);
    const init: RequestInit = multipart
      ? (() => {
          const form = new FormData();
          form.append("prompt", body.prompt as string);
          form.append("width", "1024");
          form.append("height", "1024");
          if (model.endsWith("flux-2-dev")) form.append("steps", "25");
          return { method: "POST", headers: { Authorization: `Bearer ${config.MODEL_API_KEY}` }, body: form };
        })()
      : {
          method: "POST",
          headers: { Authorization: `Bearer ${config.MODEL_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ prompt: body.prompt }),
        };

    const startedAt = Date.now();
    let ok = false;
    let errorClass: string | undefined;
    try {
      const upstream = await fetch(endpoint, { ...init, signal: AbortSignal.timeout(90_000) });
      if (!upstream.ok) {
        const detail = (await upstream.text().catch(() => "")).slice(0, 500);
        errorClass = upstream.status === 429 ? "rate_limit" : "provider_error";
        console.error(JSON.stringify({ event: "image_generation_failed", model, status: upstream.status, detail }));
        throw new HttpError(upstream.status >= 500 ? 502 : upstream.status, "IMAGE_PROVIDER_ERROR", `Image provider returned ${upstream.status}: ${detail}`);
      }
      const contentType = upstream.headers.get("content-type") ?? "";
      let image: string | undefined;
      if (contentType.startsWith("image/")) {
        image = Buffer.from(await upstream.arrayBuffer()).toString("base64");
      } else {
        const payload = await upstream.json() as { result?: { image?: unknown }; image?: unknown };
        const candidate = payload.result?.image ?? payload.image;
        if (typeof candidate === "string" && candidate) image = candidate;
      }
      if (!image) {
        errorClass = "invalid_provider_response";
        throw new HttpError(502, "IMAGE_PROVIDER_ERROR", "Image provider returned no image data.");
      }
      ok = true;
      sendJson(response, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: image }] });
    } catch (error) {
      errorClass ??= error instanceof Error && error.name === "TimeoutError" ? "timeout" : "provider_error";
      throw error;
    } finally {
      const runIdHeader = request.headers["x-seltra-run-id"];
      const runId = typeof runIdHeader === "string" && runIdHeader.length <= 128 ? runIdHeader : modelClaims.workspaceId + "-" + utcDay();
      const usage = {
        tenantId: modelClaims.workspaceId,
        workspaceId: modelClaims.creditWorkspaceId ?? modelClaims.workspaceId,
        userId: modelClaims.sub,
        role: "image",
        model,
        tokensIn: tokenCount(body.prompt),
        tokensOut: 0,
        cached: false,
        ok,
        runId,
      };
      await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/internal/core/usage`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-core-service-secret": config.CORE_SERVICE_SECRET },
        body: JSON.stringify(usage),
        signal: AbortSignal.timeout(5_000),
      }).then((result) => { if (!result.ok) console.error(JSON.stringify({ event: "image_usage_report_failed", status: result.status })); })
        .catch(() => console.error(JSON.stringify({ event: "image_usage_report_failed" })));
      console.log(JSON.stringify({ event: "image_generation_usage", workspaceId: modelClaims.workspaceId, runId, model, ok, errorClass, latencyMs: Date.now() - startedAt }));
    }
  }

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://gateway.invalid");
    if (request.method === "POST" && url.pathname === "/internal/diag/workspace-model-token") {
      const remoteAddress = request.socket.remoteAddress ?? "";
      if (config.NODE_ENV === "production" || config.RENDER !== undefined || process.env.SELTRA_LOCAL_DIAGNOSTICS !== "1" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress))
        throw new HttpError(404, "NOT_FOUND", "Not found.");
      const supplied = Buffer.from(request.headers["x-core-service-secret"] ?? "");
      const expected = Buffer.from(config.CORE_SERVICE_SECRET);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new HttpError(401, "UNAUTHORIZED", "Core service authentication is required.");
      let body: { workspaceId?: unknown };
      try { body = JSON.parse((await readBody(request, 4096)).toString("utf8")) as typeof body; }
      catch { throw new HttpError(400, "INVALID_REQUEST", "A valid diagnostic workspace request is required."); }
      if (typeof body.workspaceId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.workspaceId))
        throw new HttpError(400, "INVALID_REQUEST", "A valid workspace ID is required.");
      const entitlementResponse = await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/internal/core/entitlement/${encodeURIComponent(body.workspaceId)}`, {
        headers: { "x-core-service-secret": config.CORE_SERVICE_SECRET },
        signal: AbortSignal.timeout(5_000),
      });
      if (!entitlementResponse.ok) throw new HttpError(503, "ENTITLEMENT_UNAVAILABLE", "Workspace access could not be verified.");
      const entitlement = await entitlementResponse.json() as { active?: boolean; userId?: string; creditWorkspaceId?: string; coreWorkspaceKey?: string; storeSlug?: string; email?: string; plan?: string; engineApiKey?: string };
      if (!entitlement.active || !entitlement.userId || !entitlement.coreWorkspaceKey || !entitlement.storeSlug || !entitlement.email || !entitlement.plan || !entitlement.engineApiKey)
        throw new HttpError(403, "WORKSPACE_INACTIVE", "Workspace is not available for diagnostics.");
      const claims: SessionClaims = { workspaceId: body.workspaceId, creditWorkspaceId: entitlement.creditWorkspaceId, sub: entitlement.userId, coreWorkspaceKey: entitlement.coreWorkspaceKey, storeSlug: entitlement.storeSlug, email: entitlement.email, plan: entitlement.plan };
      entitlementCache.set(body.workspaceId, { active: true, engineApiKey: entitlement.engineApiKey, expiresAt: Date.now() + 60_000 });
      const runtime = await runtimeFor(claims);
      sendJson(response, 200, { token: runtime.modelToken });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/internal/workspaces/destroy') {
      const supplied = Buffer.from(request.headers['x-core-service-secret'] ?? '');
      const expected = Buffer.from(config.CORE_SERVICE_SECRET);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(401, 'UNAUTHORIZED', 'Core service authentication is required.');
      let body: { workspaceKey?: unknown };
      try { body = JSON.parse((await readBody(request, 4096)).toString('utf8')) as typeof body; }
      catch { throw new HttpError(400, 'INVALID_REQUEST', 'A valid workspace destroy request is required.'); }
      if (typeof body.workspaceKey !== 'string' || !/^[a-f0-9]{12,128}$/i.test(body.workspaceKey)) throw new HttpError(400, 'INVALID_REQUEST', 'A valid workspace key is required.');
      await supervisor.destroyWorkspace(body.workspaceKey);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "OPTIONS") {
      if (!request.headers.origin || !config.allowedOrigins.has(request.headers.origin))
        throw new HttpError(403, "ORIGIN_FORBIDDEN", "Request origin is not allowed.");
      response.writeHead(204, { "access-control-max-age": "600" });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      const executionHealth = await supervisor.executionHealth();
      sendJson(response, 200, {
        ok: true,
        execution: devOnlyHostExecution ? "NOT ISOLATED - DEV ONLY" : supervisor.executionMode,
        isolated: !devOnlyHostExecution,
        gatewayReachable: executionHealth.reachable,
      });
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
      const remoteRuntime = typeof port === "string" ? await runtimeFor(previewClaims) : undefined;
      const internalPreviewHost = remoteRuntime ? undefined : `app-${label.match(/-app-(\d+)$/)?.[1]}.localhost:${port}`;
      // previewProxy.web(request, response, {
      //   target: "http://127.0.0.1:" + port,
      //   headers: { host: `${label}.${config.PREVIEW_BASE_DOMAIN}:${port}` },
      //   proxyTimeout: 120_000,
      // });
      if (remoteRuntime) previewRuntimes.set(request, remoteRuntime);
      previewProxy.web(request, response, {
        target: remoteRuntime ? port as string : "http://127.0.0.1:" + port,
        ...(internalPreviewHost ? { headers: { host: internalPreviewHost } } : {}),
        proxyTimeout: 120_000,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      const executionHealth = await supervisor.executionHealth();
      sendJson(response, 200, {
        ok: true,
        execution: devOnlyHostExecution ? "NOT ISOLATED - DEV ONLY" : supervisor.executionMode,
        isolated: !devOnlyHostExecution,
        gatewayReachable: executionHealth.reachable,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/images/generations") {
      await handleImageGenerationRequest(request, response);
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
      if (request.method === "POST" && url.pathname === "/api/builder/intent") {
        checkOrigin(request);
        let body: { prompt?: unknown };
        try { body = JSON.parse((await readBody(request, 8 * 1024)).toString("utf8")) as typeof body; }
        catch { throw new HttpError(400, "INVALID_REQUEST", "A valid prompt is required."); }
        if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 4_000)
          throw new HttpError(400, "INVALID_REQUEST", "A prompt between 1 and 4000 characters is required.");
        const startedAt = Date.now();
        const intent = await resolvePromptIntent({
          prompt: body.prompt,
          baseUrl: config.modelBaseUrl,
          model: config.AI_MODEL_FAST?.trim() || config.AI_MODEL_DEFAULT,
          apiKey: config.MODEL_API_KEY,
        });
        console.info(JSON.stringify({ event: "prompt_intent_resolved", projectId: claims.workspaceId, durationMs: Date.now() - startedAt, source: intent.intent ? "model" : "fallback" }));
        sendJson(response, 200, intent);
        return;
      }
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
      if (request.method === "POST" && url.pathname === "/api/workspace/save-point") {
        if (!config.publish.persistenceEnabled) throw new HttpError(404, "NOT_FOUND", "Not found.");
        let body: { turnId?: unknown };
        try { body = JSON.parse((await readBody(request, 8 * 1024)).toString("utf8")) as { turnId?: unknown }; }
        catch { throw new HttpError(400, "INVALID_REQUEST", "A valid save point request is required."); }
        const turnId = typeof body.turnId === "string" ? body.turnId.slice(0, 128) : "manual";
        const runtime = await runtimeFor(claims);
        try { await durability.persist(runtime, "manual", turnId); }
        catch (error) { throw new HttpError(503, String((error as { code?: string }).code || "SOURCE_NOT_SAVED"), "Workspace changes could not be saved; the workspace was retained."); }
        sendJson(response, 200, { ok: true });
        return;
      }
      const leaseRoute = url.pathname.match(/^\/api\/workspace\/edit-lease\/(acquire|renew|release)$/);
      if (request.method === "POST" && leaseRoute) {
        if (!config.publish.enabled) throw new HttpError(404, "NOT_FOUND", "Not found.");
        let body: { coreAppId?: unknown; holderSessionId?: unknown; ttlSeconds?: unknown };
        try { body = JSON.parse((await readBody(request, 8 * 1024)).toString("utf8")) as typeof body; }
        catch { throw new HttpError(400, "INVALID_REQUEST", "A valid edit lease request is required."); }
        if (!Number.isSafeInteger(body.coreAppId) || Number(body.coreAppId) < 1) throw new HttpError(400, "INVALID_REQUEST", "coreAppId must be a positive integer.");
        const leaseInput = { userId: claims.sub, workspaceKey: claims.coreWorkspaceKey, coreAppId: Number(body.coreAppId), ...(typeof body.holderSessionId === "string" ? { holderSessionId: body.holderSessionId } : {}), ...(Number.isSafeInteger(body.ttlSeconds) ? { ttlSeconds: Number(body.ttlSeconds) } : {}) };
        try {
          const result = leaseRoute[1] === "acquire"
            ? await editLeases.acquire(leaseInput)
            : leaseRoute[1] === "renew"
              ? await editLeases.renew({ ...leaseInput, holderSessionId: String(body.holderSessionId || "") })
              : await editLeases.release({ ...leaseInput, holderSessionId: String(body.holderSessionId || "") });
          sendJson(response, 200, result);
        } catch (error) {
          const code = String((error as { code?: string }).code || "EDIT_LEASE_UNAVAILABLE");
          throw new HttpError(code === "EDIT_LOCKED" ? 409 : 503, code, (error as Error).message);
        }
        return;
      }
      if (url.pathname === "/api/publish/start" && request.method === "POST") {
        if (!config.publish.enabled) throw new HttpError(404, "NOT_FOUND", "Not found.");
        let body: { appId?: unknown; idempotencyKey?: unknown; confirmReplaceLegacy?: unknown };
        try { body = JSON.parse((await readBody(request, 8 * 1024)).toString("utf8")) as typeof body; }
        catch { throw new HttpError(400, "INVALID_REQUEST", "A valid publish request is required."); }
        if (!Number.isSafeInteger(body.appId) || Number(body.appId) < 1 || typeof body.idempotencyKey !== "string") throw new HttpError(400, "INVALID_REQUEST", "appId and idempotencyKey are required.");
        const runtime = await runtimeFor(claims);
        const result = await publishOrchestrator.start(claims, Number(body.appId), body.idempotencyKey, runtime, body.confirmReplaceLegacy === true);
        sendJson(response, 202, result);
        return;
      }
      if (url.pathname === "/api/publish/rollback" && request.method === "POST") {
        if (!config.publish.enabled) throw new HttpError(404, "NOT_FOUND", "Not found.");
        let body: { appId?: unknown; deploymentId?: unknown; idempotencyKey?: unknown };
        try { body = JSON.parse((await readBody(request, 8 * 1024)).toString("utf8")) as typeof body; }
        catch { throw new HttpError(400, "INVALID_REQUEST", "A valid rollback request is required."); }
        if (!Number.isSafeInteger(body.appId) || Number(body.appId) < 1 || typeof body.deploymentId !== "string" || typeof body.idempotencyKey !== "string") throw new HttpError(400, "INVALID_REQUEST", "appId, deploymentId and idempotencyKey are required.");
        const runtime = await runtimeFor(claims);
        sendJson(response, 202, await publishOrchestrator.rollback(claims, Number(body.appId), body.deploymentId, body.idempotencyKey, runtime));
        return;
      }
      if (url.pathname === "/api/publish/unpublish" && request.method === "POST") {
        if (!config.publish.enabled) throw new HttpError(404, "NOT_FOUND", "Not found.");
        let body: { appId?: unknown; idempotencyKey?: unknown };
        try { body = JSON.parse((await readBody(request, 8 * 1024)).toString("utf8")) as typeof body; }
        catch { throw new HttpError(400, "INVALID_REQUEST", "A valid unpublish request is required."); }
        if (!Number.isSafeInteger(body.appId) || Number(body.appId) < 1 || typeof body.idempotencyKey !== "string") throw new HttpError(400, "INVALID_REQUEST", "appId and idempotencyKey are required.");
        await publishOrchestrator.unpublish(claims, Number(body.appId), body.idempotencyKey);
        sendJson(response, 200, { publicationStatus: "UNPUBLISHED" });
        return;
      }
      if (url.pathname === "/api/publish/status" && request.method === "GET") {
        if (!config.publish.enabled) throw new HttpError(404, "NOT_FOUND", "Not found.");
        const appId = url.searchParams.get("appId");
        if (!appId) throw new HttpError(400, "INVALID_REQUEST", "appId is required.");
        sendJson(response, 200, await publishBackend("publish/status", { userId: claims.sub, appId }));
        return;
      }
      if (url.pathname === "/api/publish/deployments" && request.method === "GET") {
        if (!config.publish.enabled) throw new HttpError(404, "NOT_FOUND", "Not found.");
        const appId = url.searchParams.get("appId");
        if (!appId) throw new HttpError(400, "INVALID_REQUEST", "appId is required.");
        const limit = Number(url.searchParams.get("limit") || 10);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400, "INVALID_REQUEST", "limit must be between 1 and 50.");
        sendJson(response, 200, await publishBackend("publish/history", { userId: claims.sub, appId, limit, ...(url.searchParams.get("cursor") ? { cursor: url.searchParams.get("cursor") } : {}) }));
        return;
      }
      const publishEvents = url.pathname.match(/^\/api\/publish\/([^/]+)\/events$/);
      if (publishEvents && request.method === "GET") {
        if (!config.publish.enabled) throw new HttpError(404, "NOT_FOUND", "Not found.");
        const deploymentId = decodeURIComponent(publishEvents[1]);
        const headerCursor = Number(request.headers["last-event-id"] || 0);
        let cursor = Number.isSafeInteger(headerCursor) && headerCursor > 0 ? headerCursor : Math.max(0, Number(url.searchParams.get("sinceSeq") || 0));
        if (!Number.isSafeInteger(cursor)) cursor = 0;
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
        response.flushHeaders?.();
        let closed = false;
        let lastHeartbeat = Date.now();
        response.once("close", () => { closed = true; });
        while (!closed && !response.writableEnded) {
          let snapshot: { status: string; events?: Array<{ seq: number; status: string; message?: string | null; createdAt?: string }> };
          try { snapshot = await publishBackend("publish/deployment", { userId: claims.sub, deploymentId, sinceSeq: cursor }); }
          catch (error) { sendSse(response, "error", { code: error instanceof HttpError ? error.code : "BACKEND_REJECTED", message: "Deployment progress is temporarily unavailable." }); response.end(); return; }
          for (const event of snapshot.events || []) {
            if (event.seq <= cursor) continue;
            cursor = event.seq;
            sendSse(response, "stage", { seq: event.seq, status: event.status, message: event.message, ts: event.createdAt }, event.seq);
          }
          if (["LIVE", "FAILED", "SUPERSEDED", "DISABLED"].includes(snapshot.status)) {
            sendSse(response, "done", { outcome: snapshot.status, errorCode: snapshot.status === "FAILED" ? "PUBLISH_FAILED" : undefined }, cursor || undefined);
            response.end();
            return;
          }
          if (Date.now() - lastHeartbeat >= 15_000) { response.write(": heartbeat\n\n"); lastHeartbeat = Date.now(); }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        return;
      }
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
        response.once("finish", () =>
          console.log(
            JSON.stringify({
              time: new Date().toISOString(),
              userId: claims.sub,
              channel,
              status: response.statusCode,
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
        const rpcUrl = workspaceRuntime.baseUrl + "/rpc/" + encodeURIComponent(channel);
        let upstream: Response;
        try {
          upstream = await fetch(
            rpcUrl,
            {
              method: "POST",
              headers: {
                authorization: "Bearer " + workspaceRuntime.rpcSecret,
                "content-type": "application/json",
                "x-runtime-session": runtimeSessionId,
                ...(workspaceRuntime.signGatewayRequest?.("POST", new URL(rpcUrl).pathname + new URL(rpcUrl).search) ?? {}),
              },
              body: new Uint8Array(body),
              signal: abort.signal,
            },
          );
        } catch {
          const requestId = randomUUID();
          console.error(JSON.stringify({ event: "runtime_rpc_upstream_failed", requestId, channel }));
          response.setHeader("x-request-id", requestId);
          sendJson(response, 502, {
            ok: false,
            error: { code: "RUNTIME_UPSTREAM_ERROR", message: "Runtime request failed.", requestId },
          });
          return;
        }
        let result: unknown;
        let resultStatus = upstream.status;
        if (upstream.status >= 500) {
          await upstream.body?.cancel().catch(() => undefined);
          const requestId = randomUUID();
          console.error(JSON.stringify({ event: "runtime_rpc_upstream_failed", requestId, channel, status: upstream.status }));
          response.setHeader("x-request-id", requestId);
          resultStatus = 502;
          result = {
            ok: false,
            error: {
              code: "RUNTIME_UPSTREAM_ERROR",
              message: "Runtime request failed.",
              requestId,
            },
          };
        } else {
          try {
            result = JSON.parse(await upstream.text());
          } catch {
            const requestId = randomUUID();
            console.error(JSON.stringify({ event: "runtime_rpc_invalid_response", requestId, channel, status: upstream.status }));
            response.setHeader("x-request-id", requestId);
            resultStatus = 502;
            result = {
              ok: false,
              error: {
                code: "RUNTIME_INVALID_RESPONSE",
                message: "Runtime response was not valid JSON.",
                requestId,
              },
            };
          }
        }
        if ((channel === "create-app" || channel === "list-apps") && result && typeof result === "object") {
          const rpcResponse = result as { ok?: boolean; result?: unknown };
          if (channel === 'create-app' && rpcResponse.ok) console.info(JSON.stringify({ event: 'core_project_phase', projectId: claims.workspaceId, phase: 'create-app done', at: new Date().toISOString() }));
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
            const app = candidate as { id?: unknown; name?: unknown; path?: unknown };
            if (typeof app.id !== "number" || !Number.isSafeInteger(app.id) || typeof app.name !== "string") continue;
            const coreAppId = app.id;
            await fetch(`${config.NEST_INTERNAL_URL.replace(/\/+$/, "")}/api/v5/builder/apps/sync`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-core-service-secret": config.CORE_SERVICE_SECRET },
              body: JSON.stringify({ tenantId: claims.workspaceId, coreAppId, name: app.name, ...(typeof app.path === "string" ? { corePath: app.path } : {}), status: "draft" }),
              signal: AbortSignal.timeout(5_000),
            }).then((sync) => {
              if (!sync.ok) console.error(JSON.stringify({ event: "tenant_app_sync_failed", tenantId: claims.workspaceId, appId: coreAppId, status: sync.status }));
            }).catch(() => console.error(JSON.stringify({ event: "tenant_app_sync_failed", tenantId: claims.workspaceId, appId: coreAppId })));
            const appPath = (candidate as { path?: unknown }).path
            if (typeof appPath === "string" && (channel === "create-app" || channel === "list-apps")) {
              void (async () => {
                const files: Array<{ path: string; content: string }> = []
                const walk = async (root: string, relative = ""): Promise<void> => {
                  let entries: Array<import("node:fs").Dirent>
                  try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { return }
                  for (const entry of entries) {
                    if ((entry.name.startsWith(".") && entry.name !== ".dyad") || files.length >= 2000) continue
                    const absolute = path.join(root, entry.name)
                    const relativePath = path.join(relative, entry.name).replaceAll("\\", "/")
                    if (!isWorkspaceSyncPathAllowed(relativePath)) continue
                    if (entry.isDirectory()) await walk(absolute, relativePath)
                    else if (entry.isFile()) {
                      try {
                        const stat = await fs.stat(absolute)
                        if (isRasterImagePath(relativePath)) {
                          if (stat.size <= 6 * 1024 * 1024) {
                            const content = `base64:${(await fs.readFile(absolute)).toString("base64")}`
                            files.push({ path: path.join("apps", path.basename(appPath), relativePath).replaceAll("\\", "/"), content })
                          }
                          continue
                        }
                        if (stat.size > 10 * 1024 * 1024) continue
                        const content = await fs.readFile(absolute, "utf8")
                        files.push({ path: path.join("apps", path.basename(appPath), relativePath).replaceAll("\\", "/"), content })
                      } catch { /* unreadable files are not part of the durable manifest */ }
                    }
                  }
                }
                await walk(appPath)
                if (!files.length) return
                await syncWorkspaceFileBatches(config, claims, files, coreAppId).catch((error) => console.error(JSON.stringify({ event: "workspace_files_sync_failed", tenantId: claims.workspaceId, appId: coreAppId, reason: error instanceof Error ? error.message : String(error) })))
              })()
            }
          }
        }
        const rewritten = await rewriteWithPreviewTokens(result, claims);
        sendJson(response, resultStatus, rewritten);
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
          await assertEntitlement(claims, true);
          if (url.searchParams.has("preview_token")) {
            url.searchParams.delete("preview_token");
            request.url = url.pathname + url.search;
          }
          const port = await resolvePreviewPort(label, claims);
          const remoteRuntime = typeof port === "string" ? await runtimeFor(claims) : undefined;
          const internalPreviewHost = remoteRuntime ? undefined : `app-${label.match(/-app-(\d+)$/)?.[1]}.localhost:${port}`;
          const internalPreviewOrigin = internalPreviewHost ? "http://" + internalPreviewHost : undefined;
          if (remoteRuntime) previewRuntimes.set(request, remoteRuntime);
          previewProxy.ws(request, socket, head, {
            target: remoteRuntime ? port as string : "http://127.0.0.1:" + port,
            ...(internalPreviewHost && internalPreviewOrigin ? { headers: { host: internalPreviewHost, origin: internalPreviewOrigin } } : {}),
          });
          return;
        }
        if (url.pathname !== "/api/events")
          throw new HttpError(404, "NOT_FOUND", "Not found.");
        checkOrigin(request);
        const ticket = url.searchParams.get("ticket");
        if (!ticket || ticket.length > 4096) throw new HttpError(401, "WS_TICKET_REQUIRED", "A websocket ticket is required.");
        let redeemed: { workspaceId?: string; creditWorkspaceId?: string; userId?: string; coreWorkspaceKey?: string; storeSlug?: string; email?: string; plan?: string; engineApiKey?: string };
        const redeemStartedAt = Date.now();
        const backendUrl = new URL(config.NEST_INTERNAL_URL);
        const backendHostPort = `${backendUrl.hostname}:${backendUrl.port || (backendUrl.protocol === "https:" ? "443" : "80")}`;
        try {
          const result = await fetch(`${backendUrl.origin.replace(/\/+$/, "")}/api/v5/internal/core/ws-ticket/redeem`, {
            method: "POST", headers: { "content-type": "application/json", "x-core-service-secret": config.CORE_SERVICE_SECRET },
            body: JSON.stringify({ ticket }), signal: AbortSignal.timeout(WS_TICKET_REDEEM_TIMEOUT_MS),
          });
          if (!result.ok) {
            console.error(JSON.stringify({
              event: "ws_ticket_redeem_failed",
              failureClass: "backend_http_status",
              backendHostPort,
              backendStatus: result.status,
              elapsedMs: Date.now() - redeemStartedAt,
            }));
            throw new Error("ticket rejected");
          }
          redeemed = await result.json() as typeof redeemed;
        } catch (error) {
          if (!(error instanceof Error && error.message === "ticket rejected")) {
            const cause = error instanceof Error ? (error as Error & { cause?: { code?: unknown } }).cause : undefined;
            const causeCode = typeof cause?.code === "string" && /^[A-Z0-9_]+$/.test(cause.code)
              ? cause.code
              : error instanceof Error ? error.name : "UnknownError";
            console.error(JSON.stringify({
              event: "ws_ticket_redeem_failed",
              failureClass: "network_error",
              failureCode: causeCode,
              backendHostPort,
              elapsedMs: Date.now() - redeemStartedAt,
            }));
          }
          throw new HttpError(401, "WS_TICKET_INVALID", "Websocket ticket is invalid or expired.");
        }
        if (!redeemed.workspaceId || !redeemed.userId || !redeemed.coreWorkspaceKey || !redeemed.storeSlug || !redeemed.email || !redeemed.plan || typeof redeemed.engineApiKey !== "string" || !/^sk_seltra_[A-Za-z0-9_-]{40,}$/.test(redeemed.engineApiKey)) {
          console.error(JSON.stringify({
            event: "ws_ticket_redeem_failed",
            failureClass: "invalid_ticket_claims",
            backendHostPort,
            backendStatus: 200,
            elapsedMs: Date.now() - redeemStartedAt,
          }));
          throw new HttpError(401, "WS_TICKET_INVALID", "Websocket ticket is invalid or expired.");
        }
        const claims: SessionClaims = { workspaceId: redeemed.workspaceId, creditWorkspaceId: redeemed.creditWorkspaceId, sub: redeemed.userId, coreWorkspaceKey: redeemed.coreWorkspaceKey, storeSlug: redeemed.storeSlug, email: redeemed.email, plan: redeemed.plan };
        console.info(JSON.stringify({ event: "core_project_phase", projectId: claims.workspaceId, phase: "ticket redeemed", at: new Date().toISOString(), durationMs: Date.now() - redeemStartedAt }));
        entitlementCache.set(redeemed.workspaceId, { active: true, engineApiKey: redeemed.engineApiKey, expiresAt: Date.now() + 60_000 });
        await assertEntitlement(claims, true);
        console.info(JSON.stringify({ event: "core_project_phase", projectId: claims.workspaceId, phase: "workspace lookup requested", at: new Date().toISOString() }));
        const workspaceRuntime = await runtimeFor(claims);
        console.info(JSON.stringify({ event: "core_project_phase", projectId: claims.workspaceId, phase: "workspace runtime ready", at: new Date().toISOString() }));
        url.searchParams.delete("ticket");
        request.url = url.pathname + url.search;
        wss.handleUpgrade(request, socket, head, (browser) => {
          const eventsUrl = new URL(workspaceRuntime.baseUrl + "/events");
          eventsUrl.protocol = eventsUrl.protocol === "https:" ? "wss:" : "ws:";
          const runtime = new WebSocket(eventsUrl, {
            headers: {
              authorization: "Bearer " + workspaceRuntime.rpcSecret,
              ...(workspaceRuntime.signGatewayRequest?.("GET", eventsUrl.pathname + eventsUrl.search) ?? {}),
            },
          });
          const pair: EventSession = { userId: claims.sub, workspaceId: claims.workspaceId, browser, runtime };
          browser.once("open", () => console.info(JSON.stringify({ event: "core_project_phase", projectId: claims.workspaceId, phase: "browser WS open", at: new Date().toISOString() })));
          console.info(JSON.stringify({ event: "core_project_phase", projectId: claims.workspaceId, phase: "browser WS accepted", at: new Date().toISOString() }));
          eventSessions.add(pair);
          const openedAt = Date.now();
          let runtimeSessionId: string | undefined;
          let closed = false;
          let browserAlive = true;
          let runtimeAlive = true;
          let queuedRuntimeBytes = 0;
          let runtimeMessageQueue = Promise.resolve();
          let workspaceSyncInFlight = false;
          const authLifetimeTimer = setTimeout(() => closeBoth("gateway", 1008, "Builder session expired"), 10 * 60_000);
          authLifetimeTimer.unref();
          const sessionReadyTimer = setTimeout(() => {
            if (!runtimeSessionId) closeBoth("gateway", 1011, "Runtime session handshake timed out");
          }, 20_000);
          sessionReadyTimer.unref();
          const syncWorkspaceFiles = async () => {
            if (workspaceSyncInFlight) return;
            workspaceSyncInFlight = true;
            const appsRoot = path.resolve(config.WORKSPACE_ROOT, "ws", claims.coreWorkspaceKey, "apps");
            const files: Array<{ path: string; content: string }> = [];
            const walk = async (directory: string, relative = ""): Promise<void> => {
              let entries: Array<import("node:fs").Dirent>;
              try {
                entries = await fs.readdir(directory, { withFileTypes: true });
              } catch {
                return;
              }
              for (const entry of entries) {
                    if ((entry.name.startsWith(".") && entry.name !== ".dyad") || files.length >= 2000) continue;
                const absolute = path.join(directory, entry.name);
                const relativePath = path.join(relative, entry.name).replaceAll("\\", "/");
                if (!isWorkspaceSyncPathAllowed(relativePath)) continue;
                if (entry.isDirectory()) {
                  await walk(absolute, relativePath);
                } else if (entry.isFile()) {
                  try {
                    const stat = await fs.stat(absolute);
                    if (stat.size > 10 * 1024 * 1024) continue;
                    if (isRasterImagePath(relativePath)) {
                      if (stat.size <= 6 * 1024 * 1024) files.push({ path: relativePath, content: `base64:${(await fs.readFile(absolute)).toString("base64")}` });
                    } else {
                      files.push({ path: relativePath, content: await fs.readFile(absolute, "utf8") });
                    }
                  } catch {
                    continue;
                  }
                }
              }
            };
            try {
              await walk(appsRoot, "apps");
              if (files.length) {
                await syncWorkspaceFileBatches(config, claims, files).catch((error) => console.error(JSON.stringify({ event: "workspace_files_sync_failed", tenantId: claims.workspaceId, reason: error instanceof Error ? error.message : String(error) })));
              }
            } finally {
              workspaceSyncInFlight = false;
            }
          };
          void syncWorkspaceFiles();
          const workspaceSyncTimer = setInterval(() => {
            if (!closed) void syncWorkspaceFiles();
          }, 8_000);
          workspaceSyncTimer.unref();
          const workspaceLeaseTimer = setInterval(() => {
            if (!closed) supervisor.getByKey(claims.coreWorkspaceKey);
          }, 5_000);
          workspaceLeaseTimer.unref();
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
            clearInterval(workspaceLeaseTimer);
            clearInterval(heartbeatTimer);
            clearInterval(workspaceSyncTimer);
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
                        payload?: { id?: unknown; chatId?: unknown; intentId?: unknown };
                      };
                      if (
                        frame.channel === "web:session" &&
                        typeof frame.payload?.id === "string"
                      ) {
                        runtimeSessionId = frame.payload.id;
                        clearTimeout(sessionReadyTimer);
                        sessionOwners.set(runtimeSessionId, claims);
                        console.info(JSON.stringify({ event: "core_project_phase", projectId: claims.workspaceId, phase: "WS subscribed", at: new Date().toISOString() }));
                      }
                      if (frame.channel === "chat:response:end" || frame.channel === "chat:response:error") {
                        const turnId = typeof frame.payload?.intentId === "string" ? frame.payload.intentId : typeof frame.payload?.chatId === "string" ? frame.payload.chatId : "turn-end";
                        await durability.persist(workspaceRuntime, "turn_end", turnId);
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

  let shuttingDown = false;
  async function onShutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const pair of eventSessions) {
      pair.browser.close(1001, "Gateway shutting down");
      pair.runtime.close(1001, "Gateway shutting down");
    }
    previewProxy.close();
    let shutdownTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        durability.persistAll(supervisor.listRuntimes(), "shutdown"),
        new Promise<never>((_resolve, reject) => { shutdownTimer = setTimeout(() => reject(Object.assign(new Error("Shutdown persistence deadline elapsed."), { code: "SOURCE_NOT_SAVED" })), config.publish.shutdownPersistSeconds * 1000); }),
      ]);
    } catch (error) {
      console.error(JSON.stringify({ event: "shutdown_persistence_blocked", code: (error as { code?: string }).code || "SOURCE_NOT_SAVED" }));
      if (shutdownTimer) clearTimeout(shutdownTimer);
      return;
    }
    if (shutdownTimer) clearTimeout(shutdownTimer);
    durability.close();
    await supervisor.close();
    await prismaClient?.$disconnect();
    await nest.close();
    server.close();
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

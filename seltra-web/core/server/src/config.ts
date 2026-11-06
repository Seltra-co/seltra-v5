import { z } from "zod";
import { createPrivateKey } from "node:crypto";
import os from "node:os";
import path from "node:path";

const optionalPort = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : value;
}, z.number().int().min(1).max(65535).optional());

const schema = z.object({
  GATEWAY_HOST: z.string().default("127.0.0.1"),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  CORE_TOKEN_SECRET: z.string().min(32),
  CORE_SERVICE_SECRET: z.string().min(32),
  NEST_INTERNAL_URL: z.string().url(),
  EXECUTION_PROVIDER: z.enum(["cloudflare", "host"]).default("cloudflare"),
  SANDBOX_GATEWAY_URL: z.string().url().optional(),
  SANDBOX_GATEWAY_SIGNING_SECRET: z.string().optional(),
  CORE_PUBLIC_URL: z.string().url().optional(),
  SELTRA_PUBLIC_API_URL: z.string().url().default("https://api.seltra.co/api/v1"),
  PUBLISH_PUBLIC_API_URL: z.string().url().optional(),
  PUBLISH_ENABLED: z.enum(["true", "false"]).default("false"),
  WORKSPACE_PERSISTENCE_ENABLED: z.enum(["true", "false"]).default("false"),
  WORKSPACE_RESTORE_ENABLED: z.enum(["true", "false"]).default("false"),
  DEPLOY_MODE: z.enum(["hobby", "team"]).default("team"),
  GITHUB_ORG: z.string().optional(),
  GITHUB_APPS_ORG: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_INSTALLATION_ID: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_B64: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
  VERCEL_DEPLOY_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  PUBLISH_MAX_CONCURRENT: z.coerce.number().int().positive().default(3),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_S3_API_ENDPOINT: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_BUCKET_ROUTES: z.string().optional(),
  R2_BUCKET_WORKSPACES: z.string().optional(),
  WORKSPACE_MASTER_KEY: z.string().optional(),
  PUBLISH_GIT_AUTHOR_NAME: z.string().optional(),
  PUBLISH_GIT_AUTHOR_EMAIL: z.string().optional(),
  PUBLISH_ROOT_DOMAIN: z.string().default("seltra.co"),
  PUBLISH_PROTECTED_SLUGS: z.string().default(""),
  PUBLISH_REPO_PREFIX: z.string().optional(),
  SAVEPOINT_IDLE_SECONDS: z.coerce.number().int().positive().default(300),
  SNAPSHOT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(10),
  SHUTDOWN_PERSIST_SECONDS: z.coerce.number().int().positive().default(25),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  GATEWAY_ALLOWED_ORIGINS: z.string().default("http://localhost:8080"),
  PREVIEW_BASE_DOMAIN: z.string().default("localhost"),
  PREVIEW_PUBLIC_SCHEME: z.enum(["http", "https"]).optional(),
  PREVIEW_PUBLIC_PORT: optionalPort,
  PREVIEW_SCHEME: z.enum(["http", "https"]).optional(),
  PREVIEW_PORT: optionalPort,
  PREVIEW_TOKEN_TTL: z.string().default("5m"),
  PREVIEW_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(28_800),
  GATEWAY_PUBLIC_HOSTS: z.string().default(""), //Used for public hostnames that the gateway should respond to, comma-separated
  DATA_ROOT: z.string().default("/var/data"),
  WORKSPACE_ROOT: z.string().default(path.join(os.tmpdir(), "seltra-workspaces")),
  MAX_ACTIVE_WORKSPACES: z.coerce.number().int().positive().default(4),
  WORKSPACE_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  AI_PROVIDER: z.string().default("cloudflare"),
  AI_MODEL_DEFAULT: z.string().default("@cf/moonshotai/kimi-k2.7-code"),
  AI_MODEL_TOOL: z.string().optional(),
  // Fallbacks are opt-in. Silent model changes can use a different provider
  // or billing pool than the model explicitly selected by the workspace.
  AI_MODEL_FALLBACKS: z.string().default(""),
  AI_MODEL_TOOL_FALLBACKS: z.string().default(""),
  AI_MODEL_REASONING: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(),
  AI_MODEL_VISION: z.string().optional(),
  AI_MODEL_IMAGE: z.string().optional(),
  FIGMA_ACCESS_TOKEN: z.string().optional(),
  SELTRA_BUILDER_CONTEXT_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .default(262_144),
  SELTRA_PLANNER_CONTEXT_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .default(24_000),
  SELTRA_FAST_CONTEXT_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .default(64_000),
  SELTRA_VISION_CONTEXT_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .default(64_000),
  SELTRA_BUILDER_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(16_384),
  SELTRA_BUILDER_FALLBACK_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(8_192),
  SELTRA_PLANNER_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(16_384),
  SELTRA_FAST_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(8_192),
  SELTRA_VISION_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(8_192),
  MODEL_API_KEY: z.string().optional(),
  MODEL_ACCOUNT_ID: z.string().optional(),
  MODEL_BASE_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
  MODEL_MAX_TOKENS_PER_RUN: z.coerce
    .number()
    .int()
    .positive()
    .default(6_000_000),
  MODEL_MAX_TOKENS_PER_WORKSPACE: z.coerce
    .number()
    .int()
    .positive()
    .default(6_000_000),
  MODEL_MAX_REQUESTS_PER_RUN: z.coerce.number().int().positive().default(100),
  MODEL_MAX_REQUESTS_PER_WORKSPACE: z.coerce
    .number()
    .int()
    .positive()
    .default(1000),
  MODEL_MAX_WALL_CLOCK_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600),
  MODEL_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().positive().default(4),
  GATEWAY_WS_BUFFER_LIMIT: z.coerce.number().int().positive().default(4194304),
  NODE_ENV: z.string().optional(),
  RENDER: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  CONTROL_DIR: z.string().optional(),
});

export type GatewayConfig = z.infer<typeof schema> & {
  allowedOrigins: Set<string>;
  previewScheme: "http" | "https";
  previewPort?: number;
  modelBaseUrl: string;
  publish: ResolvedPublishConfig;
};

export type ResolvedPublishConfig = {
  enabled: boolean;
  persistenceEnabled: boolean;
  restoreEnabled: boolean;
  deployMode: "hobby" | "team";
  githubOrg?: string;
  githubAppId?: string;
  githubInstallationId?: string;
  githubPrivateKeyPem?: string;
  githubPrivateKeyValid: boolean;
  vercelToken?: string;
  vercelTeamId?: string;
  vercelDeployTimeoutMinutes: number;
  publishMaxConcurrent: number;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2AccountId?: string;
  r2Endpoint?: string;
  routesBucket?: string;
  workspacesBucket?: string;
  masterKey?: Buffer;
  publicApiUrl?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  rootDomain: string;
  protectedSlugs: Set<string>;
  repoPrefix: string;
  snapshotIdleSeconds: number;
  snapshotIntervalMinutes: number;
  shutdownPersistSeconds: number;
  alertWebhookUrl?: string;
  configurationErrors: string[];
};

function resolvePublishConfig(value: z.infer<typeof schema>): ResolvedPublishConfig {
  const enabled = value.PUBLISH_ENABLED === "true";
  const persistenceEnabled = value.WORKSPACE_PERSISTENCE_ENABLED === "true";
  const restoreEnabled = value.WORKSPACE_RESTORE_ENABLED === "true";
  const durabilityEnabled = persistenceEnabled || restoreEnabled;
  const deployMode = value.DEPLOY_MODE;
  const githubPrivateKeyRaw = value.GITHUB_PRIVATE_KEY?.trim() || value.GITHUB_APP_PRIVATE_KEY_B64;
  let githubPrivateKeyPem: string | undefined;
  let githubPrivateKeyValid = false;
  if (githubPrivateKeyRaw) {
    const normalized = githubPrivateKeyRaw.replace(/\\n/g, "\n").trim();
    const candidates = [normalized];
    if (!normalized.includes("-----BEGIN")) {
      try { candidates.push(Buffer.from(normalized, "base64").toString("utf8")); } catch { /* validation below */ }
    }
    for (const candidate of candidates) {
      try {
        const key = createPrivateKey(candidate);
        if (key.asymmetricKeyType !== "rsa") continue;
        githubPrivateKeyPem = candidate;
        githubPrivateKeyValid = true;
        break;
      } catch { /* only report the variable name in configurationErrors */ }
    }
  }
  const accountId = value.R2_ACCOUNT_ID?.trim();
  let r2Endpoint: string | undefined;
  try {
    const rawEndpoint = value.R2_S3_API_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    if (rawEndpoint) r2Endpoint = new URL(rawEndpoint).origin;
  } catch { /* report missing/invalid by variable name */ }
  const routesBucket = value.R2_BUCKET_ROUTES?.trim() || value.R2_BUCKET_NAME?.trim() || undefined;
  const workspacesBucket = value.R2_BUCKET_WORKSPACES?.trim() || value.R2_BUCKET_NAME?.trim() || undefined;
  const configurationErrors: string[] = [];
  if (enabled || durabilityEnabled) {
    for (const [present, name] of [
      [Boolean(value.GITHUB_ORG?.trim() || value.GITHUB_APPS_ORG?.trim()), "GITHUB_ORG"],
      [Boolean(value.GITHUB_APP_ID?.trim()), "GITHUB_APP_ID"],
      [Boolean(value.GITHUB_INSTALLATION_ID?.trim() || value.GITHUB_APP_INSTALLATION_ID?.trim()), "GITHUB_INSTALLATION_ID"],
      [githubPrivateKeyValid, "GITHUB_PRIVATE_KEY"],
      [Boolean(value.R2_ACCESS_KEY_ID?.trim()), "R2_ACCESS_KEY_ID"],
      [Boolean(value.R2_SECRET_ACCESS_KEY?.trim()), "R2_SECRET_ACCESS_KEY"],
      [Boolean(accountId), "R2_ACCOUNT_ID"],
      [Boolean(r2Endpoint), "R2_S3_API_ENDPOINT"],
      [Boolean(workspacesBucket), "R2_BUCKET_WORKSPACES"],
      [Boolean(value.WORKSPACE_MASTER_KEY?.trim()), "WORKSPACE_MASTER_KEY"],
      ...(enabled ? [[Boolean(value.VERCEL_TOKEN?.trim()), "VERCEL_TOKEN"] as const, [Boolean(value.PUBLISH_PUBLIC_API_URL), "PUBLISH_PUBLIC_API_URL"] as const] : []),
    ] as const) if (!present) configurationErrors.push(name);
    if (enabled && deployMode === "team" && !value.VERCEL_TEAM_ID?.trim()) configurationErrors.push("VERCEL_TEAM_ID");
    if (durabilityEnabled) {
      if (!value.PUBLISH_GIT_AUTHOR_NAME?.trim()) configurationErrors.push("PUBLISH_GIT_AUTHOR_NAME");
      if (!value.PUBLISH_GIT_AUTHOR_EMAIL?.trim()) configurationErrors.push("PUBLISH_GIT_AUTHOR_EMAIL");
    }
  }
  let masterKey: Buffer | undefined;
  if (value.WORKSPACE_MASTER_KEY?.trim()) {
    const raw = value.WORKSPACE_MASTER_KEY.trim();
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) masterKey = decoded;
  }
  if (durabilityEnabled && !masterKey && !configurationErrors.includes("WORKSPACE_MASTER_KEY")) configurationErrors.push("WORKSPACE_MASTER_KEY");
  const publicApiUrl = normalizePublicApiUrl(value.PUBLISH_PUBLIC_API_URL);
  if (enabled && publicApiUrl) {
    const error = validatePublicApiUrl(publicApiUrl, value.RENDER !== undefined);
    if (error) configurationErrors.push(error);
  }
  return {
    enabled,
    deployMode,
    githubOrg: value.GITHUB_ORG?.trim() || value.GITHUB_APPS_ORG?.trim(),
    githubAppId: value.GITHUB_APP_ID?.trim(),
    githubInstallationId: value.GITHUB_INSTALLATION_ID?.trim() || value.GITHUB_APP_INSTALLATION_ID?.trim(),
    githubPrivateKeyPem,
    githubPrivateKeyValid,
    vercelToken: value.VERCEL_TOKEN?.trim() || undefined,
    vercelTeamId: value.VERCEL_TEAM_ID?.trim() || undefined,
    vercelDeployTimeoutMinutes: value.VERCEL_DEPLOY_TIMEOUT_MINUTES,
    publishMaxConcurrent: value.PUBLISH_MAX_CONCURRENT,
    r2AccessKeyId: value.R2_ACCESS_KEY_ID?.trim(),
    r2SecretAccessKey: value.R2_SECRET_ACCESS_KEY?.trim(),
    r2AccountId: accountId,
    r2Endpoint,
    routesBucket,
    workspacesBucket,
    masterKey,
    publicApiUrl,
    gitAuthorName: value.PUBLISH_GIT_AUTHOR_NAME?.trim(),
    gitAuthorEmail: value.PUBLISH_GIT_AUTHOR_EMAIL?.trim(),
    rootDomain: value.PUBLISH_ROOT_DOMAIN,
    protectedSlugs: new Set(value.PUBLISH_PROTECTED_SLUGS.split(",").map((slug) => slug.trim().toLowerCase()).filter(Boolean)),
    repoPrefix: "app-",
    persistenceEnabled,
    restoreEnabled,
    snapshotIdleSeconds: value.SAVEPOINT_IDLE_SECONDS,
    snapshotIntervalMinutes: value.SNAPSHOT_INTERVAL_MINUTES,
    shutdownPersistSeconds: value.SHUTDOWN_PERSIST_SECONDS,
    alertWebhookUrl: value.ALERT_WEBHOOK_URL,
    configurationErrors,
  };
}

function normalizePublicApiUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/") url.pathname = "/api/v5";
  else if (pathname !== "/api/v5") url.pathname = `${pathname}/api/v5`;
  return url.toString().replace(/\/$/, "");
}

function validatePublicApiUrl(value: string, isRender: boolean): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return "PUBLISH_PUBLIC_API_URL"; }
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^10\.|^127\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isRender && (url.protocol !== "https:" || host === "localhost" || host === "::1" || privateIpv4)) return "PUBLISH_PUBLIC_API_URL";
  if (!isRender && host === "localhost") console.warn(JSON.stringify({ event: "publish_api_url_localhost", variable: "PUBLISH_PUBLIC_API_URL" }));
  return undefined;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const missing = [
      ...new Set(
        parsed.error.issues.map((issue) => issue.path[0]).filter(Boolean),
      ),
    ].sort();
    throw new Error(
      "Invalid gateway configuration. Set valid values for: " +
        missing.join(", "),
    );
  }
  const value = parsed.data;
  const publish = resolvePublishConfig(value);
  const expandBaseUrlTemplate = (rawUrl: string | undefined): string => {
    if (!rawUrl) return "";
    return rawUrl.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      const replacement = env[name]?.trim();
      return replacement ?? "";
    });
  };
  const modelBaseUrl = (
    expandBaseUrlTemplate(value.MODEL_BASE_URL) ||
    (value.MODEL_ACCOUNT_ID
      ? `https://api.cloudflare.com/client/v4/accounts/${value.MODEL_ACCOUNT_ID}/ai/v1`
      : "")
  ).replace(/\/+$/, "");
  const allowedOrigins = new Set<string>();
  for (const entry of value.GATEWAY_ALLOWED_ORIGINS.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      allowedOrigins.add(new URL(trimmed).origin);
    } catch {
      console.warn(JSON.stringify({
        level: "warn",
        event: "invalid_allowed_origin",
        origin: trimmed,
      }));
    }
  }
  if (modelBaseUrl.includes("${") || modelBaseUrl.includes("}")) {
    throw new Error(
      "MODEL_BASE_URL contains an unresolved environment template. Set MODEL_BASE_URL to an explicit URL or provide every referenced variable, such as MODEL_ACCOUNT_ID.",
    );
  }
  return {
    ...value,
    allowedOrigins,
    previewScheme:
      value.PREVIEW_PUBLIC_SCHEME ??
      value.PREVIEW_SCHEME ??
      (value.NODE_ENV === "production" ? "https" : "http"),
    previewPort:
      value.PREVIEW_PUBLIC_PORT ??
      value.PREVIEW_PORT ??
      (value.NODE_ENV === "production" ? undefined : value.GATEWAY_PORT),
    modelBaseUrl,
    publish,
  };
}

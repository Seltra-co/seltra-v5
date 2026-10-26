import { z } from "zod";

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
  SELTRA_PUBLIC_API_URL: z.string().url().default("https://api.seltra.co/api/v1"),
  GATEWAY_ALLOWED_ORIGINS: z.string().default("http://localhost:8080"),
  PREVIEW_BASE_DOMAIN: z.string().default("localhost"),
  PREVIEW_PUBLIC_SCHEME: z.enum(["http", "https"]).optional(),
  PREVIEW_PUBLIC_PORT: optionalPort,
  PREVIEW_TOKEN_TTL: z.string().default("5m"),
  PREVIEW_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(28_800),
  GATEWAY_PUBLIC_HOSTS: z.string().default(""), //Used for public hostnames that the gateway should respond to, comma-separated
  DATA_ROOT: z.string().default("/var/data"),
  MAX_ACTIVE_WORKSPACES: z.coerce.number().int().positive().default(4),
  WORKSPACE_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  AI_PROVIDER: z.string().default("cloudflare"),
  AI_MODEL_DEFAULT: z.string().default("@cf/moonshotai/kimi-k2.7-code"),
  AI_MODEL_FALLBACKS: z
    .string()
    .default(
      "alibaba/qwen3.5-397b-a17b,@cf/qwen/qwen2.5-coder-32b-instruct,@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    ),
  AI_MODEL_TOOL_FALLBACKS: z
    .string()
    .default("alibaba/qwen3.5-397b-a17b"),
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
  WEB_DIST_DIR: z.string().optional(),
  CONTROL_DIR: z.string().optional(),
});

export type GatewayConfig = z.infer<typeof schema> & {
  allowedOrigins: Set<string>;
  previewScheme: "http" | "https";
  previewPort?: number;
  modelBaseUrl: string;
};

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
  const modelBaseUrl =
    value.MODEL_BASE_URL ??
    (value.MODEL_ACCOUNT_ID
      ? "https://api.cloudflare.com/client/v4/accounts/" +
        value.MODEL_ACCOUNT_ID +
        "/ai/v1"
      : "");
  return {
    ...value,
    allowedOrigins: new Set(
      value.GATEWAY_ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    previewScheme:
      value.PREVIEW_PUBLIC_SCHEME ??
      (value.NODE_ENV === "production" ? "https" : "http"),
    previewPort:
      value.PREVIEW_PUBLIC_PORT ??
      (value.NODE_ENV === "production" ? undefined : value.GATEWAY_PORT),
    modelBaseUrl,
  };
}

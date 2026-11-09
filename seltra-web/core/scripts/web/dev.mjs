//web/dev.mjs
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";
import {
  formatSeltraEngineStartup,
  getSeltraEngineEnv,
} from "./seltra-engine-env.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const envFile = path.resolve(
  process.env.DYAD_WEB_ENV_FILE || path.join(root, ".env.web"),
);
const exampleFile = path.join(root, ".env.web.example");
const defaultStateDir = path.resolve(
  process.env.DATA_ROOT || process.env.DYAD_WEB_STATE_DIR || path.join(root, ".web-dev"),
);
let stateDir = defaultStateDir;
let logsDir = path.join(stateDir, "logs");
const npmCli =
  process.env.npm_execpath ||
  path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );

function systemEnv() {
  const allowed = [
    "PATH",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: systemEnv(),
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("Command failed: node " + args.join(" "));
}

function runNpm(args) {
  if (!fs.existsSync(npmCli))
    throw new Error(
      "Could not locate npm's JavaScript CLI for the runtime native preflight.",
    );
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    env: systemEnv(),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("npm " + args.join(" ") + " failed.");
}

async function canUseRuntimeNative() {
  try {
    const runtimeRequire = createRequire(
      path.join(root, "runtime/native/package.json"),
    );
    const Database = runtimeRequire("better-sqlite3");
    for (const name of ["node-pty", "dugite", "@vscode/ripgrep", "ssh2"])
      runtimeRequire(name);
    const db = new Database(":memory:");
    db.prepare("select 1").get();
    db.close();
    return true;
  } catch {
    return false;
  }
}

async function portIsFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

async function waitForHttp(url, child, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(label + " exited before becoming ready.");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      /* retry until the startup deadline */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(label + " did not become ready within " + timeoutMs + " ms.");
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed || !child.pid)
    return Promise.resolve();
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return Promise.resolve();
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

let runtime;
let gateway;
let cleanupPromise;
const logStreams = [];
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await Promise.all([killTree(gateway), killTree(runtime)]);
    for (const stream of logStreams) stream.end();
  })();
  return cleanupPromise;
}

let signalReceived = false;
const onSignal = () => {
  signalReceived = true;
  void cleanup();
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

try {
  const version = process.versions.node.split(".").map(Number);
  if (version[0] !== 24)
    throw new Error("web:dev requires Node 24; found " + process.version + ".");
  if (!fs.existsSync(envFile)) {
    await fsp.copyFile(exampleFile, envFile);
    console.error(
      "Created .env.web. Set CORE_TOKEN_SECRET and CORE_SERVICE_SECRET to the matching backend values, then rerun npm run web:dev.",
    );
    process.exitCode = 1;
    process.exit();
  }
  const fileConfig = parseDotenv(await fsp.readFile(envFile));
  const config = { ...fileConfig, ...process.env };
  stateDir = path.resolve(config.DATA_ROOT?.trim() || process.env.DYAD_WEB_STATE_DIR || path.join(root, ".web-dev"));
  logsDir = path.join(stateDir, "logs");
  for (const key of ["MODEL_BASE_URL"]) {
    if (typeof config[key] === "string")
      config[key] = config[key].replaceAll(
        "${MODEL_ACCOUNT_ID}",
        config.MODEL_ACCOUNT_ID || "",
      );
  }
  const configuredNames = [
    "MODEL_API_KEY",
    "MODEL_ACCOUNT_ID",
    "MODEL_BASE_URL",
    "AI_MODEL_DEFAULT",
    "AI_MODEL_TOOL",
    "AI_MODEL_FALLBACKS",
    "AI_MODEL_REASONING",
    "AI_MODEL_FAST",
    "AI_MODEL_VISION",
    "AI_MODEL_IMAGE",
  ].filter((name) => Boolean(config[name]?.trim()));
  console.log(
    "Web model configuration set: " + (configuredNames.join(", ") || "none"),
  );
  const builderModel = config.AI_MODEL_DEFAULT?.trim() || "@cf/moonshotai/kimi-k2.7-code";
  const toolModel = config.AI_MODEL_TOOL?.trim() || builderModel;
  const toolFallbackModels = (config.AI_MODEL_TOOL_FALLBACKS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  console.log(
    `Web builder model: ${builderModel}; tool-call model: ${toolModel}; explicit tool fallbacks: ${toolFallbackModels.join(", ") || "none"}`,
  );
  const missing = ["CORE_TOKEN_SECRET", "CORE_SERVICE_SECRET", "NEST_INTERNAL_URL"].filter(
    (key) => !config[key]?.trim(),
  );
  if (missing.length)
    throw new Error(".env.web must set: " + missing.join(", "));
  if (
    !config.MODEL_API_KEY ||
    (!config.MODEL_BASE_URL && !config.MODEL_ACCOUNT_ID)
  ) {
    console.warn(
      "Model chat is not configured; the login and UI will still start.",
    );
  }
  if (
    (config.AI_PROVIDER || "cloudflare") === "cloudflare" &&
    config.MODEL_API_KEY &&
    config.MODEL_ACCOUNT_ID &&
    config.DYAD_WEB_SKIP_MODEL_PROBE !== "1"
  ) {
    const probeEnv = Object.fromEntries(
      [
        "MODEL_API_KEY",
        "MODEL_ACCOUNT_ID",
        "MODEL_BASE_URL",
        "AI_MODEL_DEFAULT",
        "AI_MODEL_FALLBACKS",
        "AI_MODEL_TOOL_FALLBACKS",
        "AI_MODEL_REASONING",
        "AI_MODEL_FAST",
      ]
        .filter((name) => config[name])
        .map((name) => [name, config[name]]),
    );
    runNode(["scripts/web/probe-model.mjs"], {
      env: { ...systemEnv(), DYAD_WEB_ENV_FILE: envFile, ...probeEnv },
    });
  }
  const gatewayPort = Number(config.GATEWAY_PORT || process.env.PORT || 8080);
  const isRenderDeployment = process.env.RENDER === "true";
  const gatewayHost = isRenderDeployment
    ? "0.0.0.0"
    : config.GATEWAY_HOST || "127.0.0.1";
  const gatewayPublicHosts = [
    config.GATEWAY_PUBLIC_HOSTS,
    process.env.RENDER_EXTERNAL_HOSTNAME,
  ]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(",");
  const gatewayOrigin = `http://localhost:${gatewayPort}`;
  if (gatewayPort !== 8080 && config.SELTRA_WEB_E2E !== "1")
    throw new Error(
      "M1 requires GATEWAY_PORT=8080 outside the isolated E2E harness.",
    );
  if (!(await portIsFree(gatewayPort, gatewayHost))) {
    throw new Error(`Gateway port ${gatewayPort} is already in use.`);
  }

  if (!(await canUseRuntimeNative())) {
    console.log(
      "Installing pinned runtime/native modules for Node ABI " +
        process.versions.modules +
        ".",
    );
    runNpm([
      "install",
      "--prefix",
      "runtime/native",
      "--no-audit",
      "--no-fund",
    ]);
    if (!(await canUseRuntimeNative()))
      throw new Error(
        "runtime/native modules are still unavailable after installation.",
      );
  }
  const skipElectronAbiCheck =
    config.SKIP_ELECTRON_ABI_CHECK === "1" ||
    (config.SKIP_ELECTRON_ABI_CHECK !== "0" &&
      config.NODE_ENV !== "production");
  runNode([
    "scripts/web/check-abi.mjs",
    ...(skipElectronAbiCheck ? ["--skip-electron"] : []),
  ]);

  await Promise.all([
    fsp.mkdir(logsDir, { recursive: true }),
  ]);

  if (process.env.DYAD_WEB_SKIP_BUILD === "1") {
    for (const output of [
      "dist/runtime/runtime_main.js",
      "server/dist/main.mjs",
    ]) {
      if (!fs.existsSync(path.join(root, output)))
        throw new Error("Cannot skip web build; missing " + output + ".");
    }
  } else {
    runNode(["scripts/build-runtime.mjs"]);
    runNode(["scripts/web/build-gateway.mjs"]);
  }

  const sharedEnv = systemEnv();
  const isWebDeployment = config.SKIP_ELECTRON_ABI_CHECK === "1";
  const gatewayStartupTimeoutMs = Number.parseInt(
    config.DYAD_WEB_GATEWAY_STARTUP_TIMEOUT_MS || "60000",
    10,
  );
  if (
    !Number.isSafeInteger(gatewayStartupTimeoutMs) ||
    gatewayStartupTimeoutMs <= 0
  )
    throw new Error(
      "DYAD_WEB_GATEWAY_STARTUP_TIMEOUT_MS must be a positive integer.",
    );
  const runtimeEnv = {
    ...sharedEnv,
    NODE_ENV: config.NODE_ENV || "development",
    DYAD_WEB_RUNTIME: "1",
    DYAD_WEB_RUNTIME_ENTRY: "1",
    WEB_APP_READY_TIMEOUT_MS: config.WEB_APP_READY_TIMEOUT_MS || "600000",
    WEB_APP_READY_NO_PROGRESS_MS:
      config.WEB_APP_READY_NO_PROGRESS_MS || "120000",
    SELTRA_BUILDER_CONTEXT_WINDOW:
      config.SELTRA_BUILDER_CONTEXT_WINDOW || "262144",
    SELTRA_PLANNER_CONTEXT_WINDOW:
      config.SELTRA_PLANNER_CONTEXT_WINDOW || "24000",
    SELTRA_FAST_CONTEXT_WINDOW: config.SELTRA_FAST_CONTEXT_WINDOW || "64000",
    SELTRA_VISION_CONTEXT_WINDOW:
      config.SELTRA_VISION_CONTEXT_WINDOW || "64000",
    SELTRA_BUILDER_MAX_OUTPUT_TOKENS:
      config.SELTRA_BUILDER_MAX_OUTPUT_TOKENS || "16384",
    SELTRA_BUILDER_FALLBACK_MAX_OUTPUT_TOKENS:
      config.SELTRA_BUILDER_FALLBACK_MAX_OUTPUT_TOKENS || "8192",
    SELTRA_PLANNER_MAX_OUTPUT_TOKENS:
      config.SELTRA_PLANNER_MAX_OUTPUT_TOKENS || "16384",
    SELTRA_FAST_MAX_OUTPUT_TOKENS:
      config.SELTRA_FAST_MAX_OUTPUT_TOKENS || "8192",
    SELTRA_VISION_MAX_OUTPUT_TOKENS:
      config.SELTRA_VISION_MAX_OUTPUT_TOKENS || "8192",
    SELTRA_ORCHESTRATION_ENABLED:
      config.SELTRA_ORCHESTRATION_ENABLED === "1" ? "1" : "0",
    SELTRA_DESIGN_INTELLIGENCE_ENABLED:
      config.SELTRA_DESIGN_INTELLIGENCE_ENABLED === "1" ? "1" : "0",
    SELTRA_BROWSER_QA_ENABLED:
      config.SELTRA_BROWSER_QA_ENABLED === "1" ? "1" : "0",
    SELTRA_MULTIMODAL_INPUT_ENABLED:
      config.SELTRA_MULTIMODAL_INPUT_ENABLED === "1" ? "1" : "0",
    // The hosted runtime has no interactive TTY; pnpm uses CI mode to make
    // safe dependency-directory reconciliation decisions without prompting.
    CI: "true",
    PREVIEW_BASE_DOMAIN: config.PREVIEW_BASE_DOMAIN || "localhost",
    PREVIEW_PUBLIC_SCHEME: config.PREVIEW_PUBLIC_SCHEME || "http",
    // PREVIEW_PUBLIC_PORT: String(config.PREVIEW_PUBLIC_PORT || gatewayPort),
    PREVIEW_PUBLIC_PORT:
      config.PREVIEW_PUBLIC_SCHEME === "https"
        ? ""
        : String(config.PREVIEW_PUBLIC_PORT || gatewayPort),
    WEB_RUNTIME_FRAME_ANCESTORS: (
      config.GATEWAY_ALLOWED_ORIGINS || gatewayOrigin
    )
      .split(",")
      .map((entry) => {
        const origin = entry.trim();
        if (!origin) return null;
        try {
          return new URL(origin).origin;
        } catch {
          console.warn(JSON.stringify({
            level: "warn",
            event: "invalid_allowed_origin",
            origin,
          }));
          return null;
        }
      })
      .filter(Boolean)
      .join(" "),
    MODEL_GATEWAY_URL: "http://127.0.0.1:" + gatewayPort + "/v1",
    AI_MODEL_DEFAULT:
      config.AI_MODEL_DEFAULT || "@cf/moonshotai/kimi-k2.7-code",
    AI_MODEL_TOOL:
      config.AI_MODEL_TOOL || config.AI_MODEL_DEFAULT || "@cf/moonshotai/kimi-k2.7-code",
    AI_MODEL_FALLBACKS: config.AI_MODEL_FALLBACKS || "",
    AI_MODEL_TOOL_FALLBACKS: config.AI_MODEL_TOOL_FALLBACKS || "",
    AI_MODEL_REASONING: config.AI_MODEL_REASONING || "",
    AI_MODEL_FAST: config.AI_MODEL_FAST || "",
    AI_MODEL_VISION: config.AI_MODEL_VISION || "",
  };
  const gatewayEnv = {
    ...runtimeEnv,
    ...getSeltraEngineEnv(config),
    NODE_ENV: config.NODE_ENV || "development",
    GATEWAY_HOST: gatewayHost,
    GATEWAY_PUBLIC_HOSTS: gatewayPublicHosts,
    GATEWAY_PORT: String(gatewayPort),
    GATEWAY_ALLOWED_ORIGINS: config.GATEWAY_ALLOWED_ORIGINS || gatewayOrigin,
    EXECUTION_PROVIDER: config.EXECUTION_PROVIDER || "cloudflare",
    CORE_TOKEN_SECRET: config.CORE_TOKEN_SECRET,
    CORE_SERVICE_SECRET: config.CORE_SERVICE_SECRET,
    NEST_INTERNAL_URL: config.NEST_INTERNAL_URL,
    DATA_ROOT: stateDir,
    GATEWAY_WS_BUFFER_LIMIT: config.GATEWAY_WS_BUFFER_LIMIT || "4194304",
    PREVIEW_BASE_DOMAIN: config.PREVIEW_BASE_DOMAIN || "localhost",
    PREVIEW_PUBLIC_SCHEME: config.PREVIEW_PUBLIC_SCHEME || "http",
    // PREVIEW_PUBLIC_PORT: String(config.PREVIEW_PUBLIC_PORT || gatewayPort),
    PREVIEW_PUBLIC_PORT:
      config.PREVIEW_PUBLIC_SCHEME === "https"
        ? ""
        : String(config.PREVIEW_PUBLIC_PORT || gatewayPort),
    AI_PROVIDER: config.AI_PROVIDER || "cloudflare",
    AI_MODEL_DEFAULT:
      config.AI_MODEL_DEFAULT || "@cf/moonshotai/kimi-k2.7-code",
    AI_MODEL_TOOL:
      config.AI_MODEL_TOOL || config.AI_MODEL_DEFAULT || "@cf/moonshotai/kimi-k2.7-code",
    AI_MODEL_FALLBACKS: config.AI_MODEL_FALLBACKS || "",
    AI_MODEL_TOOL_FALLBACKS: config.AI_MODEL_TOOL_FALLBACKS || "",
    AI_MODEL_REASONING: config.AI_MODEL_REASONING || "",
    AI_MODEL_FAST: config.AI_MODEL_FAST || "",
    AI_MODEL_VISION: config.AI_MODEL_VISION || "",
    AI_MODEL_IMAGE: config.AI_MODEL_IMAGE || "",
    SELTRA_BUILDER_CONTEXT_WINDOW:
      config.SELTRA_BUILDER_CONTEXT_WINDOW || "262144",
    SELTRA_PLANNER_CONTEXT_WINDOW:
      config.SELTRA_PLANNER_CONTEXT_WINDOW || "24000",
    SELTRA_FAST_CONTEXT_WINDOW: config.SELTRA_FAST_CONTEXT_WINDOW || "64000",
    SELTRA_VISION_CONTEXT_WINDOW:
      config.SELTRA_VISION_CONTEXT_WINDOW || "64000",
    SELTRA_BUILDER_MAX_OUTPUT_TOKENS:
      config.SELTRA_BUILDER_MAX_OUTPUT_TOKENS || "16384",
    SELTRA_PLANNER_MAX_OUTPUT_TOKENS:
      config.SELTRA_PLANNER_MAX_OUTPUT_TOKENS || "16384",
    SELTRA_FAST_MAX_OUTPUT_TOKENS:
      config.SELTRA_FAST_MAX_OUTPUT_TOKENS || "8192",
    SELTRA_VISION_MAX_OUTPUT_TOKENS:
      config.SELTRA_VISION_MAX_OUTPUT_TOKENS || "8192",
    SELTRA_ORCHESTRATION_ENABLED:
      config.SELTRA_ORCHESTRATION_ENABLED === "1" ? "1" : "0",
    SELTRA_DESIGN_INTELLIGENCE_ENABLED:
      config.SELTRA_DESIGN_INTELLIGENCE_ENABLED === "1" ? "1" : "0",
    SELTRA_BROWSER_QA_ENABLED:
      config.SELTRA_BROWSER_QA_ENABLED === "1" ? "1" : "0",
    SELTRA_MULTIMODAL_INPUT_ENABLED:
      config.SELTRA_MULTIMODAL_INPUT_ENABLED === "1" ? "1" : "0",
    MODEL_API_KEY: config.MODEL_API_KEY || "",
    MODEL_ACCOUNT_ID: config.MODEL_ACCOUNT_ID || "",
    MODEL_BASE_URL: config.MODEL_BASE_URL || "",
    MODEL_MAX_TOKENS_PER_RUN: config.MODEL_MAX_TOKENS_PER_RUN || "6000000",
    MODEL_MAX_TOKENS_PER_WORKSPACE:
      config.MODEL_MAX_TOKENS_PER_WORKSPACE || "6000000",
    MODEL_MAX_REQUESTS_PER_RUN: config.MODEL_MAX_REQUESTS_PER_RUN || "100",
    MODEL_MAX_REQUESTS_PER_WORKSPACE:
      config.MODEL_MAX_REQUESTS_PER_WORKSPACE || "1000",
    MODEL_MAX_WALL_CLOCK_SECONDS: config.MODEL_MAX_WALL_CLOCK_SECONDS || "3600",
    MODEL_MAX_CONCURRENT_REQUESTS: config.MODEL_MAX_CONCURRENT_REQUESTS || "4",
    CONTROL_DIR: path.join(stateDir, "control"),
  };
  for (const name of [
    "SANDBOX_GATEWAY_URL",
    "SANDBOX_GATEWAY_SIGNING_SECRET",
    "CORE_PUBLIC_URL",
  ]) {
    if (config[name]?.trim()) gatewayEnv[name] = config[name].trim();
  }
  if (config.SELTRA_LOCAL_DIAGNOSTICS === "1")
    gatewayEnv.SELTRA_LOCAL_DIAGNOSTICS = "1";
  if (config.FIGMA_ACCESS_TOKEN?.trim())
    gatewayEnv.FIGMA_ACCESS_TOKEN = config.FIGMA_ACCESS_TOKEN;
  if (config.DATABASE_URL) gatewayEnv.DATABASE_URL = config.DATABASE_URL;
  const gatewayLog = fs.createWriteStream(path.join(logsDir, "gateway.log"), {
    flags: isWebDeployment ? "a" : "w",
  });
  logStreams.push(gatewayLog);
  gateway = spawn(process.execPath, [path.join(root, "server/dist/main.mjs")], {
    cwd: root,
    env: gatewayEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  gateway.stdout.pipe(gatewayLog);
  gateway.stderr.pipe(gatewayLog);
  gateway.stdout.pipe(process.stdout);
  gateway.stderr.pipe(process.stderr);
  await waitForHttp(
    `http://127.0.0.1:${gatewayPort}/healthz`,
    gateway,
    "Gateway",
    gatewayStartupTimeoutMs,
  );
  if (signalReceived) throw new Error("Startup interrupted.");
  console.log(
    `Seltra web gateway is listening on ${gatewayHost}:${gatewayPort}.`,
  );
  console.log(formatSeltraEngineStartup(config));

  const childExit = new Promise((resolve) => {
    gateway.once("exit", (code) => resolve({ name: "Gateway", code }));
  });
  const signalExit = new Promise((resolve) => {
    if (signalReceived) resolve({ name: "Signal", code: 0 });
    else {
      process.once("SIGINT", () => resolve({ name: "Signal", code: 0 }));
      process.once("SIGTERM", () => resolve({ name: "Signal", code: 0 }));
    }
  });
  const ended = await Promise.race([childExit, signalExit]);
  if (ended.name !== "Signal")
    console.error(ended.name + " exited unexpectedly.");
  await cleanup();
  if (ended.name !== "Signal" || ended.code !== 0) process.exitCode = 1;
} catch (error) {
  const redactSecrets = (text) =>
    text.replace(
      /(?:MODEL_API_KEY|CORE_TOKEN_SECRET|CORE_SERVICE_SECRET|FIGMA_ACCESS_TOKEN)=[^\s]+/g,
      "secret=[redacted]",
    );
  console.error(
    redactSecrets(error instanceof Error ? error.stack ?? error.message : String(error)),
  );
  await new Promise((resolve) => setTimeout(resolve, 500)); // let log streams flush
  for (const name of ["runtime.log", "gateway.log"]) {
    try {
      const text = fs.readFileSync(path.join(logsDir, name), "utf8");
      console.error(
        `--- last lines of ${name} ---\n` +
          text
            .split("\n")
            .slice(-60)
            .join("\n")
            .replace(
              /(?:MODEL_API_KEY|CORE_TOKEN_SECRET|CORE_SERVICE_SECRET|WEB_SEARCH_API_KEY|FIGMA_ACCESS_TOKEN)[=:]\s*\S+/g,
              "secret=[redacted]",
            ),
      );
    } catch {
      /* log may not exist yet */
    }
  }
  await cleanup();
  process.exitCode = 1;
} finally {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}

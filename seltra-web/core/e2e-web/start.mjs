import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const e2eStateDir = path.join(
  process.env.TEMP || os.tmpdir(),
  `seltra-web-e2e-dyad-${process.pid}`,
);
const e2ePort = process.env.SELTRA_E2E_PORT || "8081";
const useCloudflareBenchmark =
  process.env.SELTRA_RUN_CLOUDFLARE_BENCHMARK === "1";
if (
  useCloudflareBenchmark &&
  !(await fs.stat(path.join(root, ".env.web")).catch(() => null))
)
  throw new Error(
    "The Cloudflare benchmark requires the existing .env.web configuration.",
  );
const children = [];
if (!useCloudflareBenchmark) {
  const fakeServerDir = path.join(root, "testing/fake-llm-server");
  const fakeServerEntry = path.join(fakeServerDir, "dist/index.js");
  const outputStat = await fs.stat(fakeServerEntry).catch(() => undefined);
  const sourceNames = (await fs.readdir(fakeServerDir)).filter((name) =>
    name.endsWith(".ts"),
  );
  const sourceStats = await Promise.all(
    sourceNames.map((name) => fs.stat(path.join(fakeServerDir, name))),
  );
  if (
    !outputStat ||
    sourceStats.some((sourceStat) => sourceStat.mtimeMs > outputStat.mtimeMs)
  ) {
    console.log("E2E setup: compiling the fake LLM server.");
    const fakeBuild = spawnSync(
      process.execPath,
      [
        "node_modules/typescript/bin/tsc",
        "-p",
        "testing/fake-llm-server/tsconfig.json",
      ],
      { cwd: root, stdio: "inherit" },
    );
    if (fakeBuild.error) throw fakeBuild.error;
    if (fakeBuild.status !== 0) process.exit(fakeBuild.status ?? 1);
    console.log("E2E setup: fake LLM server compiled.");
  }
}
function start(args, options) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  children.push(child);
  return child;
}
function stop(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  else child.kill("SIGTERM");
}
const fake = useCloudflareBenchmark
  ? null
  : start([path.join(root, "testing/fake-llm-server/dist/index.js")], {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PORT: "3500",
      },
    });
const launcher = start([path.join(root, "scripts/web/dev.mjs")], {
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    DYAD_WEB_ENV_FILE: path.join(
      root,
      useCloudflareBenchmark ? ".env.web" : ".env.web.example",
    ),
    DYAD_WEB_STATE_DIR: e2eStateDir,
    CORE_TOKEN_SECRET: "e2e-core-token-secret-at-least-32-characters",
    CORE_SERVICE_SECRET: "e2e-core-service-secret-at-least-32-characters",
    NEST_INTERNAL_URL: "http://127.0.0.1:3001",
    ...(useCloudflareBenchmark
      ? {}
      : {
          MODEL_API_KEY: "fake-test-key",
          MODEL_BASE_URL: "http://127.0.0.1:3500/v1",
          MODEL_ACCOUNT_ID: "",
        }),
    ...(useCloudflareBenchmark && process.env.SELTRA_E2E_MODEL_DEFAULT
      ? { AI_MODEL_DEFAULT: process.env.SELTRA_E2E_MODEL_DEFAULT }
      : {}),
    NODE_ENV: "test",
    DYAD_WEB_SKIP_BUILD: "1",
    DYAD_WEB_RUNTIME_STARTUP_TIMEOUT_MS: "180000",
    DYAD_WEB_GATEWAY_STARTUP_TIMEOUT_MS: "180000",
    DYAD_WEB_SKIP_MODEL_PROBE: useCloudflareBenchmark ? "1" : "0",
    SELTRA_ORCHESTRATION_ENABLED: "1",
    SELTRA_DESIGN_INTELLIGENCE_ENABLED: "1",
    SELTRA_BROWSER_QA_ENABLED: "1",
    GATEWAY_PORT: e2ePort,
    PREVIEW_PUBLIC_PORT: e2ePort,
    GATEWAY_ALLOWED_ORIGINS: `http://127.0.0.1:${e2ePort}`,
    SELTRA_WEB_E2E: "1",
  },
});
console.log("E2E setup: started the isolated Dyad web launcher.");
const stopAll = () => {
  stop(launcher);
  stop(fake);
};
process.once("SIGINT", stopAll);
process.once("SIGTERM", stopAll);
launcher.once("exit", (code) => {
  stop(fake);
  process.exitCode = code ?? 1;
});
if (fake) {
  fake.once("exit", (code) => {
    if (code !== 0 && launcher.exitCode === null) {
      stop(launcher);
      process.exitCode = code ?? 1;
    }
  });
}
await new Promise(() => undefined);

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const buildGateway = spawnSync(
  process.execPath,
  [path.join(root, "scripts/web/build-gateway.mjs")],
  { cwd: root, stdio: "inherit" },
);
if (buildGateway.error) throw buildGateway.error;
if (buildGateway.status !== 0) process.exit(buildGateway.status ?? 1);
const gatewayTest = spawnSync(
  process.execPath,
  [path.join(root, "scripts/web/test-gateway.mjs")],
  { cwd: root, stdio: "inherit" },
);
if (gatewayTest.error) throw gatewayTest.error;
if (gatewayTest.status !== 0) process.exit(gatewayTest.status ?? 1);
const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
const files = [
  "src/web/workspace_path.test.ts",
  "src/web/app_process_env.test.ts",
  "src/web/figma_reference.test.ts",
  "src/web/client/figma_import.test.ts",
  "src/web/rpc_server.test.ts",
  "src/web/client/install_bridge.test.ts",
  "src/web/client/install_bridge_session.test.ts",
  "src/web/web_runtime_network.test.ts",
];
const modelPreflight = spawnSync(
  process.execPath,
  [
    "--test",
    path.join(root, "scripts/web/model-preflight.test.mjs"),
    path.join(root, "scripts/web/cloudflare-run-probe.test.mjs"),
  ],
  { cwd: root, stdio: "inherit" },
);
if (modelPreflight.error) throw modelPreflight.error;
if (modelPreflight.status !== 0) process.exit(modelPreflight.status ?? 1);
const result = spawnSync(process.execPath, [vitest, "run", ...files], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: "--no-deprecation",
    VITE_CJS_IGNORE_WARNING: "true",
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

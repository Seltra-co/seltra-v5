import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(coreRoot, ".env.web");
const secretDir = path.join(coreRoot, ".sandbox-gateway-secrets");
const devSecretPath = path.join(secretDir, "SANDBOX_GATEWAY_SIGNING_SECRET_DEV");
const prodSecretPath = path.join(secretDir, "SANDBOX_GATEWAY_SIGNING_SECRET_PROD");
const devName = "SANDBOX_GATEWAY_SIGNING_SECRET";
const devValue = randomBytes(48).toString("base64url");
const prodValue = randomBytes(48).toString("base64url");

let envText = "";
try {
  envText = await readFile(envPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const envLines = envText.split(/\r?\n/);
const matchingLines = envLines.filter((line) => /^\s*SANDBOX_GATEWAY_SIGNING_SECRET\s*=/.test(line));
if (matchingLines.length > 1) throw new Error(".env.web contains duplicate SANDBOX_GATEWAY_SIGNING_SECRET entries.");
if (matchingLines.length === 1) {
  const index = envLines.indexOf(matchingLines[0]);
  envLines[index] = `${devName}=${devValue}`;
} else {
  while (envLines.length && envLines.at(-1) === "") envLines.pop();
  envLines.push(`${devName}=${devValue}`);
}

await writeFile(envPath, `${envLines.join("\n")}\n`, { mode: 0o600 });
await mkdir(secretDir, { recursive: true, mode: 0o700 });
await writeFile(devSecretPath, `${devValue}\n`, { mode: 0o600 });
await writeFile(prodSecretPath, `${prodValue}\n`, { mode: 0o600 });
await chmod(envPath, 0o600).catch(() => {});
await chmod(devSecretPath, 0o600).catch(() => {});
await chmod(prodSecretPath, 0o600).catch(() => {});

process.stdout.write([
  "Generated and stored locally (values intentionally not printed):",
  "SANDBOX_GATEWAY_SIGNING_SECRET (dev; seltra-web/core/.env.web and ignored local secret file)",
  "SANDBOX_GATEWAY_SIGNING_SECRET_PROD (seltra-web/core/.sandbox-gateway-secrets/SANDBOX_GATEWAY_SIGNING_SECRET_PROD)",
  "",
  "From the repository root, add the values without displaying them:",
  "gh secret set CLOUDFLARE_API_TOKEN  # paste the scoped deploy token at the hidden prompt",
  "gh secret set CLOUDFLARE_ACCOUNT_ID  # paste the Cloudflare account ID at the prompt",
  "gh secret set SANDBOX_GATEWAY_SIGNING_SECRET_DEV < seltra-web/core/.sandbox-gateway-secrets/SANDBOX_GATEWAY_SIGNING_SECRET_DEV",
  "gh secret set SANDBOX_GATEWAY_SIGNING_SECRET_PROD < seltra-web/core/.sandbox-gateway-secrets/SANDBOX_GATEWAY_SIGNING_SECRET_PROD",
].join("\n") + "\n");

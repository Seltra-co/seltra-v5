import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { execFileSync as execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "seltra-rpc-smoke-"));
const userData = path.join(tempRoot, "userData");
const appsDir = path.join(tempRoot, "apps");
const secret = "web-rpc-smoke-secret-32-bytes-minimum";
const secretsKey = Buffer.alloc(32, 7).toString("hex");
let fake;
let runtime;
let socket;
let runtimePort;
const output = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = (awaitImportNet()).createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function awaitImportNet() {
  return netModule;
}

async function requestJson(url, sessionId, body, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "x-runtime-session": sessionId,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      throw new Error(`RPC ${url} failed (${response.status}): ${JSON.stringify(result)}`);
    }
    const value = result.result;
    if (value?.__dyadIpcEnvelope === "dyad-ipc-envelope-v1") {
      if (!value.ok) throw new Error(`${value.error?.message ?? "IPC failed"} (${value.error?.code ?? "IPC_ERROR"})`);
      return value.value;
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForRuntime(port) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (runtime.exitCode !== null) throw new Error(`Runtime exited early (${runtime.exitCode})`);
    try {
      await new Promise((resolve, reject) => {
        const socket = netModule.connect(port, "127.0.0.1", resolve);
        socket.once("error", reject);
        socket.once("connect", () => socket.end());
      });
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Runtime RPC server did not start within 60 seconds");
}

const netModule = await import("node:net");

try {
  process.env.FAKE_LLM_QUIET = "1";
  execFile(process.execPath, ["scripts/build-runtime.mjs"], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "testing/fake-llm-server/tsconfig.json"], {
    cwd: root,
    stdio: "inherit",
  });
  const fakeModule = await import(pathToFileURL(path.join(root, "testing/fake-llm-server/dist/index.js")));
  fake = await fakeModule.startFakeLlmServer({ port: 0, host: "127.0.0.1" });

  runtimePort = await freePort();
  const runtimeArgs = ["--require", path.join(root, "scripts/web/native-require-hook.cjs"), path.join(root, "dist/runtime/runtime_main.js")];
  const runtimeEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    DYAD_WEB_RUNTIME_ENTRY: "1",
    DYAD_WEB_RUNTIME: "1",
    DYAD_USER_DATA: userData,
    DYAD_APPS_DIR: appsDir,
    DYAD_TMP_DIR: tempRoot,
    RUNTIME_RPC_SECRET: secret,
    RUNTIME_SECRETS_KEY: secretsKey,
    RUNTIME_RPC_HOST: "127.0.0.1",
    RUNTIME_RPC_PORT: String(runtimePort),
    WORKSPACE_MODEL_TOKEN: "smoke-workspace-model-token",
    MODEL_GATEWAY_URL: "http://127.0.0.1:8080/v1",
    LM_STUDIO_BASE_URL_FOR_TESTING: fake.url,
    FAKE_LLM_PORT: String(fake.port),
    NODE_ENV: "test",
    E2E_TEST_BUILD: "true",
  };
  runtime = spawn(process.execPath, runtimeArgs, {
    cwd: root,
    env: runtimeEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  runtime.stdout.on("data", (data) => output.push(data.toString()));
  runtime.stderr.on("data", (data) => output.push(data.toString()));
  await waitForRuntime(runtimePort);

  const frames = [];
  socket = new WebSocket(`ws://127.0.0.1:${runtimePort}/events`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  socket.on("message", (raw) => {
    try { frames.push(JSON.parse(raw.toString())); } catch {}
  });
  await once(socket, "open");
  const deadline = Date.now() + 5_000;
  while (!frames.some((frame) => frame.channel === "web:session") && Date.now() < deadline) await delay(10);
  const sessionId = frames.find((frame) => frame.channel === "web:session")?.payload?.id;
  if (!sessionId) throw new Error("Runtime did not assign an RPC session");
  const rpc = (channel, ...args) => requestJson(`http://127.0.0.1:${runtimePort}/rpc/${encodeURIComponent(channel)}`, sessionId, { args });

  const providers = await rpc("get-language-model-providers");
  if (providers.filter((provider) => provider.id === "custom::seltra").length !== 1) {
    throw new Error("Runtime must seed exactly one Seltra provider");
  }
  const seltraModels = await rpc("get-language-models", { providerId: "custom::seltra" });
  if (seltraModels.length !== 4 || new Set(seltraModels.map((model) => model.apiName)).size !== 4) {
    throw new Error("Runtime must seed exactly four distinct Seltra models");
  }

  await rpc("set-user-settings", {
    enableAppBlueprint: false,
    isTestMode: true,
    selectedChatMode: "local-agent",
    autoApproveChanges: true,
  });
  const appResult = await rpc("create-app", { name: "Web Runtime Smoke", initialChatMode: "local-agent" });
  const appId = appResult.app.id;
  const chatId = appResult.chatId;
  const providerId = "custom::seltra-smoke";
  await rpc("create-custom-language-model-provider", {
    id: "seltra-smoke",
    name: "Seltra Smoke Fake LLM",
    apiBaseUrl: `${fake.url}/v1`,
  });
  const customModelId = await rpc("create-custom-language-model", {
    apiName: "fake-model",
    displayName: "Fake Smoke Model",
    providerId,
  });
  await rpc("set-user-settings", {
    selectedModel: {
      name: "fake-model",
      provider: providerId,
      customModelId,
      effortLevel: "medium",
    },
    providerSettings: { [providerId]: { apiKey: { value: "fake-key" } } },
    autoApproveChanges: true,
    isTestMode: true,
    selectedChatMode: "local-agent",
  });

  const machineAddress = {
    protocolVersion: 1,
    machineId: "chat_stream",
    encodedKey: { chatId },
  };
  const snapshot = await rpc("distributed-machine:subscribe", machineAddress);
  const intentId = randomUUID();
  const invocationRef = { kind: "chat-stream", entityKey: chatId, operationId: randomUUID() };
  const intentPayload = {
    schemaVersion: 1,
    intentId,
    chatId,
    appId,
    invocationRef,
    prompt: "tc=local-agent/main-write",
    selectedComponents: [],
    requestedChatMode: "local-agent",
  };
  const payloadToHash = {
    schemaVersion: intentPayload.schemaVersion,
    intentId: intentPayload.intentId,
    chatId: intentPayload.chatId,
    appId: intentPayload.appId,
    invocationRef: intentPayload.invocationRef,
    prompt: intentPayload.prompt,
    redo: undefined,
    attachments: undefined,
    selectedComponents: intentPayload.selectedComponents,
    requestedChatMode: intentPayload.requestedChatMode,
    userInputRequestId: undefined,
    planAcceptInNewChat: undefined,
    owner: undefined,
  };
  const payloadHash = createHash("sha256").update(JSON.stringify(payloadToHash)).digest("hex");
  await rpc("distributed-machine:dispatch", {
    ...machineAddress,
    expectedActorInstanceId: snapshot.actorInstanceId,
    expectedRevision: snapshot.revision,
    messageId: randomUUID(),
    encodedEvent: {
      type: "SUBMIT",
      intent: { ...intentPayload, payloadHash },
      observedStopPolicyVersion: 0,
    },
  });
  const eventDeadline = Date.now() + 5_000;
  while (!frames.some((frame) => frame.channel === "chat:response:end" || frame.channel === "chat:response:error") && Date.now() < eventDeadline) await delay(10);
  if (!frames.some((frame) => frame.channel === "chat:response:chunk")) {
    throw new Error("No chat response chunks arrived over /events");
  }
  if (!frames.some((frame) => frame.channel === "chat:response:end")) {
    throw new Error("Chat stream did not complete successfully");
  }

  const appRecord = await rpc("get-app", appId);
  const appPath = appRecord.resolvedPath ?? path.join(appsDir, appRecord.path);
  const generatedFile = path.join(appPath, "file1.txt");
  if (!(await fs.stat(generatedFile).catch(() => null))) {
    const files = await fs.readdir(appPath, { recursive: true }).catch(() => []);
    const events = frames.filter((frame) => frame.channel === "chat:response:end" || frame.channel === "chat:response:error");
    const patches = frames.filter((frame) => frame.channel === "chat:response:chunk").map((frame) => frame.payload?.streamingPatch?.content).filter(Boolean);
    throw new Error(`Expected generated file at ${generatedFile}; files=${JSON.stringify(files.filter((file) => !file.startsWith(".git")))}; end=${JSON.stringify(events)}; patches=${JSON.stringify(patches).slice(0, 1_000)}`);
  }
  const commitCount = Number(execFile("git", ["rev-list", "--count", "HEAD"], { cwd: appPath, encoding: "utf8" }).trim());
  if (commitCount < 2) throw new Error(`Expected the generated change to create a Git commit; found ${commitCount} commit(s)`);
  await rpc("get-app", appId);
  socket.close();
  socket = undefined;
  runtime.kill();
  await once(runtime, "exit");
  runtimePort = await freePort();
  runtimeEnv.RUNTIME_RPC_PORT = String(runtimePort);
  runtime = spawn(process.execPath, runtimeArgs, { cwd: root, env: runtimeEnv, stdio: ["ignore", "pipe", "pipe"] });
  runtime.stdout.on("data", (data) => output.push(data.toString()));
  runtime.stderr.on("data", (data) => output.push(data.toString()));
  await waitForRuntime(runtimePort);
  socket = new WebSocket(`ws://127.0.0.1:${runtimePort}/events`, { headers: { authorization: `Bearer ${secret}` } });
  const restartFrames = [];
  socket.on("message", (raw) => restartFrames.push(JSON.parse(raw.toString())));
  await once(socket, "open");
  const restartDeadline = Date.now() + 5_000;
  while (!restartFrames.some((frame) => frame.channel === "web:session") && Date.now() < restartDeadline) await delay(10);
  if (!restartFrames.some((frame) => frame.channel === "web:session")) throw new Error("Restarted runtime did not assign an RPC session");
  const restartSessionId = restartFrames.find((frame) => frame.channel === "web:session").payload.id;
  const restartRpc = (channel, ...args) => requestJson(`http://127.0.0.1:${runtimePort}/rpc/${encodeURIComponent(channel)}`, restartSessionId, { args });
  const restartedProviders = await restartRpc("get-language-model-providers");
  const restartedModels = await restartRpc("get-language-models", { providerId: "custom::seltra" });
  if (restartedProviders.filter((provider) => provider.id === "custom::seltra").length !== 1 || restartedModels.length !== 4) {
    throw new Error("Restart duplicated or lost the Seltra provider/models");
  }
  console.log(JSON.stringify({ ok: true, fakeLlmPath: "testing/fake-llm-server/index.ts", appId, generatedFile, commitCount, seltraModels: restartedModels.length, restartSeedCheck: "passed", streamEvents: frames.filter((frame) => frame.channel.startsWith("chat:response:")).length }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  const relevant = output.join("").split(/\r?\n/).filter((line) => /\b(error|failed|exception|EADDRINUSE)\b/i.test(line)).slice(-20);
  if (relevant.length) console.error(relevant.join("\n").slice(-4_000));
  else if (output.length) console.error(output.join("").slice(-4_000));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (runtime && runtime.exitCode === null) {
    runtime.kill();
    await Promise.race([once(runtime, "exit"), delay(3_000)]);
  }
  await fake?.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

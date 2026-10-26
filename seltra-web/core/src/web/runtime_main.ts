import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import log from "electron-log";
import { BackupManager } from "../backup_manager";
import { db, getDatabasePath, initializeDatabase } from "../db";
import { getSettingsFilePath, readEffectiveSettings } from "../main/settings";
import { registerIpcHandlers } from "../ipc/ipc_host";
import { cleanupOldAiMessagesJson } from "../pro/main/ipc/handlers/local_agent/ai_messages_cleanup";
import { cleanupStaleBuildSnapshots } from "../pro/main/ipc/handlers/local_agent/tools/run_build";
import { recoverInterruptedSubagents } from "../pro/main/ipc/handlers/local_agent/subagents/subagent_manager";
import { startChatSearchIndexer } from "../pro/main/ipc/handlers/local_agent/chat_search_indexer";
import { cleanupOldMediaFiles } from "../ipc/utils/media_cleanup";
import { scrubGithubTokenFromRemotes } from "../ipc/utils/git_remote_token_scrub";
import { encryptStoredMcpSecrets } from "../ipc/utils/mcp_secret_encryption";
import { getDyadAppsBaseDirectory } from "../paths/paths";
import { configureTrustedRenderer } from "../ipc/utils/renderer_security";
import { createRpcServer } from "./rpc_server";
import { seedSeltraModels } from "./seed_seltra_models";

const logger = log.scope("web-runtime");

export async function startRuntime(): Promise<void> {
  process.env.DYAD_WEB_RUNTIME = "1";
  const userData = process.env.DYAD_USER_DATA?.trim();
  if (userData) fs.mkdirSync(path.resolve(userData), { recursive: true });
  fs.mkdirSync(path.join(app.getPath("userData"), "logs"), { recursive: true });
  log.transports.file.resolvePathFn = () =>
    path.join(app.getPath("userData"), "logs", "runtime.log");
  if (!process.env.RUNTIME_SECRETS_KEY?.trim()) {
    throw new Error("RUNTIME_SECRETS_KEY must be configured for encrypted runtime secrets");
  }
  safeStorage.encryptString("");

  // The authenticated RPC boundary is the only renderer entry point in web
  // mode. The shim models the same trusted main frame for existing handlers.
  configureTrustedRenderer({ packagedRendererUrl: "file:///seltra/index.html" });

  // Keep the desktop registration order: main.ts registers handlers before
  // app readiness and before database initialization.
  registerIpcHandlers();

  try {
    const backupManager = new BackupManager({
      settingsFile: path.join(app.getPath("userData"), "settings.json"),
      dbFile: getDatabasePath(),
    });
    await backupManager.initialize();
  } catch (error) {
    logger.error("Error initializing backup manager", error);
  }

  initializeDatabase();
  seedSeltraModels(!fs.existsSync(getSettingsFilePath()));
  void recoverInterruptedSubagents().catch((error) =>
    logger.error("Failed to reconcile interrupted sub-agents", error),
  );
  void cleanupStaleBuildSnapshots().catch((error) =>
    logger.error("Failed to clean stale production build snapshots", error),
  );
  cleanupOldAiMessagesJson();
  startChatSearchIndexer();
  cleanupOldMediaFiles();
  scrubGithubTokenFromRemotes();
  await encryptStoredMcpSecrets();
  await readEffectiveSettings();

  const appsDirectory = getDyadAppsBaseDirectory();
  fs.mkdirSync(appsDirectory, { recursive: true });
  logger.info("Headless runtime initialized", {
    version: app.getVersion(),
    appsDirectory,
    database: getDatabasePath(),
    appCount: await db.query.apps.findMany({ columns: { id: true } }).then((rows) => rows.length),
  });
  const rpc = createRpcServer({
    host: process.env.RUNTIME_RPC_HOST ?? "127.0.0.1",
    port: Number(process.env.RUNTIME_RPC_PORT ?? 0),
    // Applying a template can require installing its dependency tree before
    // the preview server can restart. Keep that lifecycle RPC alive for the
    // duration of the install instead of returning a misleading 120s timeout.
    channelTimeouts: { "restart-app": 15 * 60_000 },
  });
  await new Promise<void>((resolve, reject) => {
    if (rpc.server.listening) resolve();
    else {
      rpc.server.once("listening", resolve);
      rpc.server.once("error", reject);
    }
  });
  const address = rpc.address();
  logger.info("RPC server listening", {
    address: typeof address === "object" && address ? address.address : address,
    port: typeof address === "object" && address ? address.port : undefined,
  });
}

if (process.env.DYAD_WEB_RUNTIME_ENTRY === "1") {
  startRuntime().catch((error) => {
    logger.error("Headless runtime failed to initialize", error);
    process.exitCode = 1;
  });
}

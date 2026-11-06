import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../server/src/config";
import { createArchive, extractArchive } from "../../server/src/publish/archive";
import { GithubPublisher } from "../../server/src/publish/github";
import { R2ObjectStore } from "../../server/src/publish/r2";
import { WorkspaceDurability } from "../../server/src/publish/snapshot";
import { installPlatformFiles, validateAppForPush } from "../../server/src/publish/validator";
import { createRpcServer } from "../web/rpc_server";

const workspaces: string[] = [];
const generatedPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const encodedMasterKey = Buffer.alloc(32, 7).toString("base64");

afterEach(async () => {
  for (const directory of workspaces.splice(0)) await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "seltra-publish-"));
  workspaces.push(directory);
  return directory;
}

function coreEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CORE_TOKEN_SECRET: "a".repeat(40), CORE_SERVICE_SECRET: "b".repeat(40), NEST_INTERNAL_URL: "http://localhost:3001",
    GATEWAY_PORT: "8080", ...extra,
  };
}

function publishingEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return coreEnv({
    PUBLISH_ENABLED: "true", WORKSPACE_PERSISTENCE_ENABLED: "true", WORKSPACE_RESTORE_ENABLED: "true", DEPLOY_MODE: "hobby", GITHUB_ORG: "Seltra-Cloud", GITHUB_APP_ID: "12345",
    GITHUB_INSTALLATION_ID: "67890", GITHUB_PRIVATE_KEY: generatedPrivateKey.replaceAll("\n", "\\n"),
    VERCEL_TOKEN: "test-vercel-token", R2_ACCESS_KEY_ID: "test-access", R2_SECRET_ACCESS_KEY: "test-secret",
    R2_ACCOUNT_ID: "account-id", R2_S3_API_ENDPOINT: "https://account-id.r2.cloudflarestorage.com/workspaces/extra",
    R2_BUCKET_NAME: "test-bucket", WORKSPACE_MASTER_KEY: encodedMasterKey,
    PUBLISH_PUBLIC_API_URL: "https://backend.example.test", PUBLISH_GIT_AUTHOR_NAME: "Test Publisher",
    PUBLISH_GIT_AUTHOR_EMAIL: "publisher@example.test", ...extra,
  });
}

describe("P1B environment and protocol helpers", () => {
  it("normalizes Willy's env names and endpoint paths without reading R2_TOKEN", () => {
    const env = new Proxy(publishingEnv({
      GITHUB_ORG: "", GITHUB_APPS_ORG: "Seltra-Cloud", GITHUB_INSTALLATION_ID: "", GITHUB_APP_INSTALLATION_ID: "67890",
      GITHUB_PRIVATE_KEY: "", GITHUB_APP_PRIVATE_KEY_B64: Buffer.from(generatedPrivateKey).toString("base64"),
      R2_BUCKET_NAME: "single-bucket", R2_BUCKET_ROUTES: "", R2_BUCKET_WORKSPACES: "",
      R2_TOKEN: "must-never-be-read",
    }), { get(target, property, receiver) {
      if (property === "R2_TOKEN") throw new Error("R2_TOKEN must never be read");
      return Reflect.get(target, property, receiver);
    } });
    const config = loadConfig(env).publish;
    expect(config.githubOrg).toBe("Seltra-Cloud");
    expect(config.githubInstallationId).toBe("67890");
    expect(config.githubPrivateKeyValid).toBe(true);
    expect(config.r2Endpoint).toBe("https://account-id.r2.cloudflarestorage.com");
    expect(config.routesBucket).toBe("single-bucket");
    expect(config.workspacesBucket).toBe("single-bucket");
    expect(config.publicApiUrl).toBe("https://backend.example.test/api/v5");
    expect(config.configurationErrors).toEqual([]);
  });

  it("rejects an invalid deployment mode and rejects a private API URL on Render", () => {
    expect(() => loadConfig(coreEnv({ DEPLOY_MODE: "unexpected" }))).toThrow(/DEPLOY_MODE/);
    const config = loadConfig(coreEnv({ DEPLOY_MODE: "team", PUBLISH_ENABLED: "true", RENDER: "true", PUBLISH_PUBLIC_API_URL: "http://127.0.0.1:3001" })).publish;
    expect(config.deployMode).toBe("team");
    expect(config.configurationErrors).toContain("PUBLISH_PUBLIC_API_URL");
    expect(config.configurationErrors).toContain("GITHUB_ORG");
  });

  it("writes and reads a safe gzip tar archive and rejects traversal entries", () => {
    const archive = createArchive([{ path: "userData/settings.json", data: Buffer.from("{}") }, { path: "userData/sqlite.db", data: Buffer.from("sqlite") }]);
    expect(extractArchive(archive).map((item) => [item.path, item.data.toString()])).toEqual([
      ["userData/settings.json", "{}"], ["userData/sqlite.db", "sqlite"],
    ]);
    expect(() => createArchive([{ path: "../outside", data: Buffer.from("no") }])).toThrow();
  });

  it("signs R2 requests without putting credentials in the URL", async () => {
    let requestUrl = "";
    let requestHeaders: HeadersInit = {};
    const store = new R2ObjectStore({ endpoint: "https://account.r2.cloudflarestorage.com", accountId: "account", accessKeyId: "access-id", secretAccessKey: "secret-value" }, async (input, init) => {
      requestUrl = String(input); requestHeaders = init?.headers || {}; return new Response(null, { status: 200 });
    });
    await store.put("bucket", "workspaces/key/snapshots/latest.tgz", Buffer.from("bundle"));
    expect(requestUrl).toBe("https://account.r2.cloudflarestorage.com/bucket/workspaces/key/snapshots/latest.tgz");
    expect(requestUrl).not.toContain("secret-value");
    expect(new Headers(requestHeaders).get("authorization")).toContain("AWS4-HMAC-SHA256");
  });
});

describe("pre-push validator", () => {
  it("writes the platform Vite config and required ignore rules", async () => {
    const root = await tempDirectory();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { vite: "1" } }));
    await installPlatformFiles(root);
    const vercel = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
    expect(vercel.git.deploymentEnabled).toBe(false);
    expect(vercel.rewrites).toEqual([{ source: "/(.*)", destination: "/index.html" }]);
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(".env*");
    expect(await validateAppForPush(root)).toMatchObject({ framework: "vite" });
  });

  it("blocks secrets, crons, external rewrites, and changes to the platform git key", async () => {
    const root = await tempDirectory();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { vite: "1" } }));
    await installPlatformFiles(root);
    await writeFile(path.join(root, "vercel.json"), JSON.stringify({ git: { deploymentEnabled: false }, crons: [] }));
    await expect(validateAppForPush(root)).rejects.toMatchObject({ code: "VERCEL_CONFIG_FORBIDDEN" });
    await writeFile(path.join(root, "vercel.json"), JSON.stringify({ git: { deploymentEnabled: false }, rewrites: [{ source: "/x", destination: "https://evil.example" }] }));
    await expect(validateAppForPush(root)).rejects.toMatchObject({ code: "VERCEL_EXTERNAL_REWRITE" });
    await writeFile(path.join(root, "vercel.json"), JSON.stringify({ git: { deploymentEnabled: true } }));
    await expect(validateAppForPush(root)).rejects.toMatchObject({ code: "PLATFORM_FILE_MODIFIED" });
    await writeFile(path.join(root, "vercel.json"), JSON.stringify({ git: { deploymentEnabled: false } }));
    await writeFile(path.join(root, "index.js"), "const token = 'sk_test_12345678901234567890';");
    await expect(validateAppForPush(root)).rejects.toMatchObject({ code: "SECRET_DETECTED" });
  });

  it("blocks committed environment files and secret-bearing source", async () => {
    const root = await tempDirectory();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "1" } }));
    await installPlatformFiles(root);
    await writeFile(path.join(root, ".env.production"), "SECRET=synthetic");
    await expect(validateAppForPush(root)).rejects.toMatchObject({ code: "SECRET_DETECTED" });
  });

  it("rejects removal of a tracked platform-owned vercel.json", async () => {
    const root = await tempDirectory();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "1" } }));
    await installPlatformFiles(root);
    await import("node:child_process").then(({ execFileSync }) => {
      execFileSync("git", ["init", root], { stdio: "ignore" });
      execFileSync("git", ["-C", root, "add", "vercel.json"], { stdio: "ignore" });
    });
    await rm(path.join(root, "vercel.json"));
    await expect(installPlatformFiles(root)).rejects.toMatchObject({ code: "PLATFORM_FILE_MODIFIED" });
  });
});

describe("GitHub token handling", () => {
  it("keeps credentials out of git remote config and Git command arguments", async () => {
    const root = await tempDirectory();
    await mkdir(root, { recursive: true });
    await import("node:child_process").then(({ execFileSync }) => {
      execFileSync("git", ["init", root], { stdio: "ignore" });
      execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "initial"], { stdio: "ignore" });
    });
    const token = "synthetic-installation-token";
    const captured: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const gitRunner = async (args: string[], env?: NodeJS.ProcessEnv) => {
      captured.push({ args, env });
      return { stdout: args.includes("ls-remote") ? "" : "" };
    };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ token, expires_at: new Date(Date.now() + 3600_000).toISOString() }), { status: 201 });
    const publisher = new GithubPublisher({ org: "Seltra-Cloud", appId: "1", installationId: "2", privateKeyPem: generatedPrivateKey, mode: "hobby", repoPrefix: "app-" }, fetcher, gitRunner);
    await publisher.pushApp(root, { id: "1", fullName: "Seltra-Cloud/app-1", visibility: "private", cloneUrl: "https://github.com/Seltra-Cloud/app-1.git", defaultBranch: "main" });
    const gitConfig = await readFile(path.join(root, ".git", "config"), "utf8");
    expect(gitConfig).not.toContain(token);
    expect(captured.every(({ args }) => args.every((arg) => !arg.includes(token)))).toBe(true);
    expect(captured.every(({ env }) => !env?.GITHUB_PRIVATE_KEY && !env?.VERCEL_TOKEN && !env?.PUBLISH_ENABLED)).toBe(true);
    expect(captured.some(({ args }) => args.includes("push") && args.some((arg) => /force/i.test(arg)))).toBe(false);
  });

  it("reports SOURCE_DIVERGED when fast-forward rebase cannot apply", async () => {
    const root = await tempDirectory();
    await import("node:child_process").then(({ execFileSync }) => execFileSync("git", ["init", root], { stdio: "ignore" }));
    const commands: string[][] = [];
    const gitRunner = async (args: string[]) => {
      commands.push(args);
      if (args.includes("ls-remote")) return { stdout: `${"a".repeat(40)}\trefs/heads/main\n` };
      if (args.includes("rebase")) throw new Error("synthetic conflict");
      return { stdout: "" };
    };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ token: "synthetic-token", expires_at: new Date(Date.now() + 3600_000).toISOString() }), { status: 201 });
    const publisher = new GithubPublisher({ org: "Seltra-Cloud", appId: "1", installationId: "2", privateKeyPem: generatedPrivateKey, mode: "hobby", repoPrefix: "app-" }, fetcher, gitRunner);
    await expect(publisher.pushApp(root, { id: "1", fullName: "Seltra-Cloud/app-1", visibility: "private", cloneUrl: "https://github.com/Seltra-Cloud/app-1.git", defaultBranch: "main" }))
      .rejects.toMatchObject({ code: "SOURCE_DIVERGED" });
    expect(commands.some((args) => args.includes("push"))).toBe(false);
  });
});

class MemoryR2 {
  objects = new Map<string, Buffer>();
  writes: string[] = [];
  async put(_bucket: string, key: string, data: Buffer) { this.objects.set(key, Buffer.from(data)); this.writes.push(key); }
  async get(_bucket: string, key: string) {
    const data = this.objects.get(key);
    if (!data) throw Object.assign(new Error("missing"), { code: "R2_OBJECT_NOT_FOUND" });
    return Buffer.from(data);
  }
  async list(_bucket: string, prefix: string) { return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length, lastModified: "2026-11-05T00:00:00.000Z" })); }
  async delete(_bucket: string, key: string) { this.objects.delete(key); }
}

describe("workspace snapshot and restore", () => {
  it("deletes the source workspace and restores from R2 plus the saved GitHub revision", async () => {
    const root = await tempDirectory();
    vi.stubEnv("WORKSPACE_ROOT", root);
    const workspaceKey = "workspace-123";
    const workspaceRoot = path.join(root, "ws", workspaceKey);
    const userData = path.join(workspaceRoot, "userData");
    const appPath = path.join(workspaceRoot, "apps", "merchant");
    await mkdir(userData, { recursive: true });
    await mkdir(path.join(workspaceRoot, "tmp"), { recursive: true });
    await mkdir(appPath, { recursive: true });
    await writeFile(path.join(appPath, "index.html"), "unsaved source");
    await writeFile(path.join(userData, "settings.json"), "{\"theme\":\"test\"}");
    await writeFile(path.join(workspaceRoot, "tmp", "sqlite-backup"), "sqlite database");
    const runtimeRoot = path.join(root, "runtime");
    const backupPath = path.join(workspaceRoot, "tmp", "sqlite-backup");
    const runtimeHandlers = { snapshotUserData: async () => { await writeFile(backupPath, "sqlite database"); return { backupPath, apps: [{ coreAppId: 9, name: "Store", relPath: "merchant" }] }; }, commitWorkingTree: async () => ({ appId: 9, relPath: "merchant", sha: "a".repeat(40), changed: true }) };
    const rpc = createRpcServer({ secret: "rpc-secret-test", host: "127.0.0.1", port: 0, publishHandlers: runtimeHandlers });
    await new Promise<void>((resolve) => rpc.server.once("listening", resolve));
    const address = rpc.address() as { port: number };
    const runtime = { workspaceId: "tenant-id", workspaceKey, userId: "user-id", storeSlug: "store", baseUrl: `http://127.0.0.1:${address.port}`, rpcSecret: "rpc-secret-test", runtimeSecretsKey: "11".repeat(32), modelToken: "model-token", touchedAt: Date.now(), child: { exitCode: null } } as any;
    const r2 = new MemoryR2();
    const savedSource = new Map<string, string>();
    const gh = {
      ensureRepo: vi.fn(async () => ({ id: "repo-id", fullName: "Seltra-Cloud/app-tenant-app", visibility: "private", cloneUrl: "https://github.com/Seltra-Cloud/app-tenant-app.git", defaultBranch: "main" })),
      pushApp: vi.fn(async (source: string) => { savedSource.set("index.html", await readFile(path.join(source, "index.html"), "utf8")); return "a".repeat(40); }), verifyRemoteSha: vi.fn(async () => true),
      cloneApp: vi.fn(async (_repo: string, _sha: string, destination: string) => { await mkdir(destination, { recursive: true }); await writeFile(path.join(destination, "index.html"), savedSource.get("index.html")!); }),
    };
    const backendCalls: string[] = [];
    let durableRef: Record<string, unknown> = {};
    const backendFetch: typeof fetch = async (input, init) => {
      const route = String(input).split("/").slice(-2).join("/"); backendCalls.push(route);
      const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (route === "workspace-persistence/transition" && payload.status === "SNAPSHOT_VERIFIED") durableRef = { operationId: payload.operationId, status: "SAFE_TO_DESTROY", snapshotVersion: payload.snapshotVersion, manifestKey: payload.manifestKey, bundleKey: payload.bundleKey, bundleSha256: payload.bundleSha256, githubRevisions: { "9": "a".repeat(40) } };
      const body = route === "publish/repository-info" ? { tenantAppId: "tenant-app", tenantId: "tenant-id", coreAppId: 9, name: "Store" }
        : route === "workspace-persistence/begin" ? { status: "PERSISTING" }
        : route === "workspace-persistence/latest" ? durableRef
        : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    const publishConfig = loadConfig(publishingEnv()).publish;
    const durability = new WorkspaceDurability(publishConfig, r2 as any, gh as any, "http://backend.test", "service-secret", backendFetch);
    try {
      await durability.persist(runtime, "turn_end", "turn-1");
      expect(r2.writes.length).toBe(3);
      expect(r2.writes[0]).toContain("/snapshots/");
      expect(r2.writes[1].startsWith(`workspaces/${workspaceKey}/snapshots/`) && r2.writes[1].endsWith(".json")).toBe(true);
      expect(r2.writes[2]).toBe(`workspaces/${workspaceKey}/latest.json`);
      expect(backendCalls).toEqual(["workspace-persistence/begin", "publish/repository-info", "publish/repository-saved", "github/push-result", "workspace-persistence/transition", "workspace-persistence/transition", "workspace-persistence/transition"]);
      const failedDurability = new WorkspaceDurability(publishConfig, new MemoryR2() as any, { ensureRepo: async () => ({ id: "repo-id", fullName: "Seltra-Cloud/app-tenant-app", visibility: "private", cloneUrl: "https://github.com/example/repo.git", defaultBranch: "main" }), pushApp: async () => { throw Object.assign(new Error("synthetic failure"), { code: "GITHUB_PUSH_FAILED" }); } } as any, "http://backend.test", "service-secret", backendFetch);
      await expect(failedDurability.persist(runtime, "periodic")).rejects.toMatchObject({ code: "SOURCE_NOT_SAVED" });
      expect(await readFile(path.join(appPath, "index.html"), "utf8")).toBe("unsaved source");
      failedDurability.close();

      await rm(workspaceRoot, { recursive: true, force: true });
      await expect(readFile(path.join(appPath, "index.html"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      const freshDataRoot = path.join(root, "fresh-instance");
      vi.stubEnv("WORKSPACE_ROOT", freshDataRoot);
      const destination = path.join(freshDataRoot, "ws", workspaceKey);
      await mkdir(path.join(destination, "userData"), { recursive: true });
      await writeFile(path.join(destination, "userData", "sqlite.db"), "stale local database");
      expect(await durability.restoreBeforeStart(workspaceKey, destination)).toBe("11".repeat(32));
      expect(await readFile(path.join(destination, "userData", "settings.json"), "utf8")).toContain("test");
      expect(await readFile(path.join(destination, "userData", "sqlite.db"), "utf8")).toBe("sqlite database");
      expect(await readFile(path.join(destination, "apps", "merchant", "index.html"), "utf8")).toBe("unsaved source");
      await expect(readFile(path.join(destination, "runtime-secrets.key"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally { durability.close(); await rpc.close(); }
  });

  it("fails safely with a wrong master key and retains the existing workspace copy", async () => {
    const root = await tempDirectory();
    const workspaceKey = "workspace-456";
    const archive = createArchive([{ path: "userData/sqlite.db", data: Buffer.from("db") }]);
    const { createCipheriv, hkdfSync, randomBytes } = await import("node:crypto");
    const master = Buffer.alloc(32, 7);
    const derived = Buffer.from(hkdfSync("sha256", master, Buffer.from(workspaceKey), Buffer.from("seltra-workspace-runtime-key-v1"), 32));
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", derived, iv); const ciphertext = Buffer.concat([cipher.update(Buffer.alloc(32, 1)), cipher.final()]);
    const digest = (await import("node:crypto")).createHash("sha256").update(archive).digest("hex");
    const manifest = { version: 1, snapshotVersion: "snapshot-test", operationId: "operation-test", createdAt: new Date().toISOString(), bundleKey: `workspaces/${workspaceKey}/snapshots/test.tgz`, bundleSha256: digest, wrappedRuntimeKey: { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }, apps: [] };
    const r2 = new MemoryR2(); r2.objects.set(manifest.bundleKey, archive); const manifestKey = `workspaces/${workspaceKey}/snapshots/${manifest.snapshotVersion}.json`; r2.objects.set(manifestKey, Buffer.from(JSON.stringify(manifest))); r2.objects.set(`workspaces/${workspaceKey}/latest.json`, Buffer.from(JSON.stringify({ snapshotVersion: manifest.snapshotVersion, operationId: manifest.operationId, manifestKey })));
    const badConfig = { ...loadConfig(publishingEnv()).publish, masterKey: Buffer.alloc(32, 8) };
    const backendFetch: typeof fetch = async () => new Response(JSON.stringify({ operationId: manifest.operationId, status: "SAFE_TO_DESTROY", snapshotVersion: manifest.snapshotVersion, manifestKey, bundleKey: manifest.bundleKey, bundleSha256: manifest.bundleSha256, githubRevisions: {} }), { status: 200, headers: { "content-type": "application/json" } });
    const durability = new WorkspaceDurability(badConfig, r2 as any, { cloneApp: vi.fn() } as any, "http://backend.test", "service-secret", backendFetch);
    const workspaceRoot = path.join(root, "ws", workspaceKey);
    await mkdir(path.join(workspaceRoot, "userData"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "userData", "keep.txt"), "previous copy");
    await expect(durability.restoreBeforeStart(workspaceKey, workspaceRoot)).rejects.toMatchObject({ code: "WORKSPACE_RESTORE_FAILED" });
    expect(await readFile(path.join(workspaceRoot, "userData", "keep.txt"), "utf8")).toBe("previous copy");
    durability.close();
  });
});

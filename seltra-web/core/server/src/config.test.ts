import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importPKCS8 } from "jose";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("normalizes an RSA PKCS#1 key for the GitHub App JWT signer", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
    const config = loadConfig({
      CORE_TOKEN_SECRET: "t".repeat(32),
      CORE_SERVICE_SECRET: "s".repeat(32),
      NEST_INTERNAL_URL: "http://localhost:3001",
      WORKSPACE_PERSISTENCE_ENABLED: "true",
      GITHUB_ORG: "seltra-test",
      GITHUB_APP_ID: "1",
      GITHUB_INSTALLATION_ID: "2",
      GITHUB_APP_PRIVATE_KEY_B64: Buffer.from(privateKeyPem).toString("base64"),
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_ACCOUNT_ID: "account",
      R2_BUCKET_WORKSPACES: "workspaces",
      WORKSPACE_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
      PUBLISH_GIT_AUTHOR_NAME: "Test User",
      PUBLISH_GIT_AUTHOR_EMAIL: "test@example.com",
    });

    expect(config.publish.configurationErrors).toEqual([]);
    expect(config.publish.githubPrivateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    await expect(importPKCS8(config.publish.githubPrivateKeyPem!, "RS256")).resolves.toBeDefined();
  });

  it("accepts localhost and loopback aliases for browser origins", () => {
    const config = loadConfig({
      CORE_TOKEN_SECRET: "t".repeat(32),
      CORE_SERVICE_SECRET: "s".repeat(32),
      NEST_INTERNAL_URL: "http://localhost:3001",
      WORKSPACE_PERSISTENCE_ENABLED: "true",
      GATEWAY_ALLOWED_ORIGINS: "http://localhost:3000",
    });

    expect(config.allowedOrigins.has("http://localhost:3000")).toBe(true);
    expect(config.allowedOrigins.has("http://127.0.0.1:3000")).toBe(true);
    expect(config.allowedOrigins.has("http://[::1]:3000")).toBe(true);
  });

  it("configures a separate durable generated-image bucket", () => {
    const config = loadConfig({
      CORE_TOKEN_SECRET: "t".repeat(32),
      CORE_SERVICE_SECRET: "s".repeat(32),
      NEST_INTERNAL_URL: "http://localhost:3001",
      R2_ACCESS_KEY_ID: "access",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_ACCOUNT_ID: "account",
      R2_BUCKET_WORKSPACES: "workspaces",
      R2_BUCKET_ASSETS: "generated-assets",
    });

    expect(config.publish.assetsBucket).toBe("generated-assets");
  });
});

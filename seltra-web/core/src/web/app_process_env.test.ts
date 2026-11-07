import { describe, expect, it } from "vitest";
import { appProcessEnvironment } from "./app_process_env";

describe("generated app process environment", () => {
  it("removes gateway credentials while preserving Seltra's public storefront settings", () => {
    const environment = appProcessEnvironment({
      PATH: "runtime-path",
      NODE_ENV: "production",
      CORE_TOKEN_SECRET: "core-secret",
      RUNTIME_RPC_SECRET: "rpc-secret",
      RUNTIME_SECRETS_KEY: "encryption-key",
      WORKSPACE_MODEL_TOKEN: "model-token",
      MODEL_API_KEY: "provider-key",
      DATABASE_URL: "database-url",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      VITE_SELTRA_API_URL: "https://api.example.test/api/v1",
      VITE_SELTRA_STORE_SLUG: "merchant-store",
    }, true);

    expect(environment).toMatchObject({
      PATH: "runtime-path",
      NODE_ENV: "production",
      VITE_SELTRA_API_URL: "https://api.example.test/api/v1",
      VITE_SELTRA_STORE_SLUG: "merchant-store",
    });
    expect(environment).not.toHaveProperty("CORE_TOKEN_SECRET");
    expect(environment).not.toHaveProperty("RUNTIME_RPC_SECRET");
    expect(environment).not.toHaveProperty("RUNTIME_SECRETS_KEY");
    expect(environment).not.toHaveProperty("WORKSPACE_MODEL_TOKEN");
    expect(environment).not.toHaveProperty("MODEL_API_KEY");
    expect(environment).not.toHaveProperty("DATABASE_URL");
    expect(environment).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(environment).not.toHaveProperty("SWC_NATIVE_BINDING_CACHE_SKIP_SECURITY_CHECK");
  });

  it("uses the isolated SWC cache mode only in a signed gateway workspace", () => {
    const environment = appProcessEnvironment(
      { DYAD_WORKSPACE_ID: "workspace-id", SWC_NATIVE_BINDING_CACHE: "unsafe" },
      true,
    );

    expect(environment).toMatchObject({
      SWC_NATIVE_BINDING_CACHE: "/opt/dyad/tmp/swc-native-binding",
      SWC_NATIVE_BINDING_CACHE_SKIP_SECURITY_CHECK: "1",
    });
    expect(environment).not.toHaveProperty("DYAD_WORKSPACE_ID");
  });

  it("leaves the desktop process environment unchanged", () => {
    expect(appProcessEnvironment({ CORE_TOKEN_SECRET: "desktop-secret" }, false)).toEqual({
      CORE_TOKEN_SECRET: "desktop-secret",
    });
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSeltraEngineStartup,
  getSeltraEngineEnv,
} from "./seltra-engine-env.mjs";

test("forwards configured Seltra Engine values into the Core environment", () => {
  assert.deepEqual(
    getSeltraEngineEnv({
      SELTRA_ENGINE_URL: " http://localhost:3001/v1 ",
      SELTRA_ENGINE_API_KEY: " sk_seltra_local_test ",
    }),
    {
      SELTRA_ENGINE_URL: "http://localhost:3001/v1",
      SELTRA_ENGINE_API_KEY: "sk_seltra_local_test",
    },
  );
});

test("does not create blank engine settings when values are absent", () => {
  assert.deepEqual(
    getSeltraEngineEnv({ SELTRA_ENGINE_URL: " ", SELTRA_ENGINE_API_KEY: "" }),
    {},
  );
});

test("prints the configured URL and key presence without leaking secrets", () => {
  const line = formatSeltraEngineStartup({
    SELTRA_ENGINE_URL: "https://user:password@engine.example/v1?token=hidden",
    SELTRA_ENGINE_API_KEY: "sk_seltra_never-print-this",
  });

  assert.equal(
    line,
    "Seltra Engine configured: https://engine.example/v1 (key present: yes)",
  );
  assert.equal(line.includes("never-print-this"), false);
  assert.equal(line.includes("hidden"), false);
});

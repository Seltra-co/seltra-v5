import fs from "node:fs";
import path from "node:path";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";

it("unregisters legacy Dyad workers before registering Seltra", async () => {
  const operations: string[] = [];
  const legacyRegistration = {
    active: { scriptURL: "https://preview.example/dyad-sw.js" },
    waiting: null,
    installing: null,
    unregister: vi.fn(async () => {
      operations.push("unregister");
      return true;
    }),
  };
  const otherRegistration = {
    active: { scriptURL: "https://preview.example/other-sw.js" },
    waiting: null,
    installing: null,
    unregister: vi.fn(),
  };
  const seltraRegistration = { addEventListener: vi.fn(), scope: "/" };
  const serviceWorker = {
    getRegistrations: vi
      .fn()
      .mockResolvedValue([legacyRegistration, otherRegistration]),
    register: vi.fn(async () => {
      operations.push("register");
      return seltraRegistration;
    }),
    addEventListener: vi.fn(),
    controller: null,
  };
  const scriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../worker/seltra-sw-register.js",
  );
  const source = fs.readFileSync(scriptPath, "utf8");

  new Script(source).runInNewContext({
    navigator: { serviceWorker },
    window: { parent: { postMessage: vi.fn() }, addEventListener: vi.fn() },
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  await vi.waitFor(() => expect(serviceWorker.register).toHaveBeenCalledOnce());

  expect(legacyRegistration.unregister).toHaveBeenCalledOnce();
  expect(otherRegistration.unregister).not.toHaveBeenCalled();
  expect(serviceWorker.register).toHaveBeenCalledWith("/seltra-sw.js", {
    scope: "/",
  });
  expect(operations).toEqual(["unregister", "register"]);
});

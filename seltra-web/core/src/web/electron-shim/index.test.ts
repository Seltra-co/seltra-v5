import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserWindow,
  UnsupportedInWebError,
  app,
  dialog,
  ipcMain,
  resetForTesting,
  safeStorage,
  setActiveSession,
  shell,
  type WebSession,
} from "./index";
import {
  getDyadAppsBaseDirectory,
  invalidateDyadAppsBaseDirectoryCache,
} from "../../paths/paths";

describe("web Electron shim", () => {
  afterEach(() => {
    resetForTesting();
    invalidateDyadAppsBaseDirectoryCache();
    vi.unstubAllEnvs();
  });

  it("maps app paths to the workspace runtime environment", () => {
    vi.stubEnv("DYAD_USER_DATA", ".runtime-data");
    vi.stubEnv("DYAD_APPS_DIR", ".workspace/apps");

    expect(app.getPath("userData")).toMatch(/\.runtime-data$/);
    expect(app.getPath("home")).toMatch(/\.workspace$/);
    expect(app.isPackaged).toBe(false);
    expect(app.getVersion()).toBe("1.19.0");
  });

  it("prioritizes the runtime apps directory without changing desktop lookup", () => {
    vi.stubEnv("DYAD_WEB_RUNTIME", "1");
    vi.stubEnv("DYAD_APPS_DIR", ".runtime-apps");
    expect(getDyadAppsBaseDirectory()).toMatch(/\.runtime-apps$/);
    vi.stubEnv("DYAD_WEB_RUNTIME", "0");
    invalidateDyadAppsBaseDirectoryCache();
    expect(getDyadAppsBaseDirectory()).not.toMatch(/\.runtime-apps$/);
  });

  it("routes invoke and BrowserWindow sends to the invoking session", async () => {
    const events: Array<[string, unknown]> = [];
    const session: WebSession = {
      id: "session-a",
      send: (channel, payload) => events.push([channel, payload]),
    };
    ipcMain.handle("shim:test", (event) => {
      event.sender.send("shim:event", { ok: true });
      new BrowserWindow().webContents.send("shim:window", "payload");
      return "result";
    });

    await expect(ipcMain.invoke("shim:test", [], { session })).resolves.toBe(
      "result",
    );
    expect(events).toEqual([
      ["shim:event", { ok: true }],
      ["shim:window", "payload"],
    ]);
  });

  it("supports Electron webContents lifecycle listener cleanup", async () => {
    const session: WebSession = { id: "lifecycle", send: vi.fn() };
    ipcMain.handle("shim:lifecycle", (event) => {
      return event.sender;
    });
    const contents = (await ipcMain.invoke("shim:lifecycle", [], {
      session,
    })) as import("./index").WebWebContents;
    const onDestroyed = vi.fn(() =>
      contents.removeListener("destroyed", onDestroyed),
    );
    contents.once("destroyed", onDestroyed);
    expect(() => contents.close()).not.toThrow();
    expect(onDestroyed).toHaveBeenCalledOnce();
  });

  it("emits open-external to the active session and rejects native dialogs", async () => {
    const send = vi.fn();
    setActiveSession({ id: "session-b", send });

    await shell.openExternal("https://example.com");
    expect(send).toHaveBeenCalledWith("web:open-external", {
      url: "https://example.com",
    });
    await expect(dialog.showOpenDialog()).rejects.toBeInstanceOf(
      UnsupportedInWebError,
    );
  });

  it("encrypts secrets with authenticated AES-GCM and rejects tampering", () => {
    vi.stubEnv("RUNTIME_SECRETS_KEY", "a".repeat(64));
    const ciphertext = safeStorage.encryptString("provider-secret");

    expect(ciphertext.toString()).not.toContain("provider-secret");
    expect(safeStorage.decryptString(ciphertext)).toBe("provider-secret");
    ciphertext[ciphertext.length - 1] ^= 1;
    expect(() => safeStorage.decryptString(ciphertext)).toThrow();
  });
});

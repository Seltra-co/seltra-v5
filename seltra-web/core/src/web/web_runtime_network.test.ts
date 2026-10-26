import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { nodeFetch } = vi.hoisted(() => ({
  nodeFetch: vi.fn(async () => {
    throw new Error("unexpected node-fetch request");
  }),
}));
vi.mock("node-fetch", () => ({ default: nodeFetch }));
const tempDirs: string[] = [];

describe("web runtime outbound service guards", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    nodeFetch.mockClear();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  it("serves local catalog fallbacks and performs no Dyad or telemetry requests", async () => {
    vi.stubEnv("DYAD_WEB_RUNTIME", "1");
    const forbiddenHosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const host = new URL(String(input)).hostname;
        if (/dyad\.sh|posthog/i.test(host)) forbiddenHosts.push(host);
        throw new Error("unexpected fetch to " + host);
      }),
    );

    const [
      { getBuiltinLanguageModelCatalog, getCodexClientVersion },
      { getRemoteDesktopConfig },
      { getRemoteMcpCatalog },
      { fetchApiTemplates },
      { fetchUserInfo },
      { ensurePnpmAllowBuildsConfigured },
    ] = await Promise.all([
      import("../ipc/shared/remote_language_model_catalog"),
      import("../ipc/shared/remote_desktop_config"),
      import("../ipc/shared/remote_mcp_catalog"),
      import("../ipc/utils/template_utils"),
      import("../ipc/services/user_budget_service"),
      import("../ipc/utils/socket_firewall"),
    ]);

    expect((await getBuiltinLanguageModelCatalog()).source).toBe("fallback");
    expect(getCodexClientVersion()).toBe("0.155.1");
    expect(await getRemoteDesktopConfig()).toBeNull();
    expect(await getRemoteMcpCatalog()).toEqual([]);
    expect(await fetchApiTemplates()).toEqual([]);
    expect((await fetchUserInfo("unused")).userId).toBe("web-runtime");
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "seltra-web-network-"),
    );
    tempDirs.push(temp);
    await ensurePnpmAllowBuildsConfigured({ appPath: temp });
    expect(forbiddenHosts).toEqual([]);
    expect(nodeFetch).not.toHaveBeenCalled();
  }, 20_000);
});

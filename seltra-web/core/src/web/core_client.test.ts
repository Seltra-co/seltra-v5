import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreSession } from "../../../frontend/lib/core/client";
import { CoreClient } from "../../../frontend/lib/core/client";
import { fetchWithSeltraAuth } from "../../../frontend/lib/auth-session";

vi.mock("../../../frontend/lib/auth-session", () => ({
  fetchWithSeltraAuth: vi.fn(),
}));

const session = (coreToken: string): CoreSession => ({
  coreToken,
  expiresIn: 600,
  workspaceId: "tenant-1",
  coreWorkspaceKey: "0123456789ab",
  storeSlug: "test-store",
  plan: "free",
  limits: {},
});

describe("CoreClient session renewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => "access-token") });
    vi.mocked(fetchWithSeltraAuth).mockImplementation(async () => new Response(JSON.stringify({ ticket: "ticket" }), { status: 200 }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renews the Core session before its ten-minute websocket lifetime expires", async () => {
    const getSession = vi.fn().mockResolvedValue(session("old-core-token"));
    const refreshSession = vi.fn().mockResolvedValue(session("new-core-token"));
    const client = new CoreClient(getSession, refreshSession);

    await client.wsTicket();
    await vi.advanceTimersByTimeAsync(570_001);
    await client.wsTicket();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(fetchWithSeltraAuth).mock.calls;
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({ coreToken: "new-core-token" });
  });
});

describe("CoreClient workspace sync", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CORE_URL", "http://localhost:8080");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries transient sync failures and resolves only after manifest verification", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "temporary_sync_failure" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true, verified: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CoreClient(async () => session("core-token"));

    const pending = client.syncNow("run-1");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toEqual({ ok: true, verified: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ runId: "run-1" });
  });

  it("does not retry a rejected verification response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: { code: "files_verify_rejected" } }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new CoreClient(async () => session("core-token"));

    await expect(client.syncNow("run-1")).rejects.toMatchObject({
      code: "files_verify_rejected",
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful HTTP response without verified manifest evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, verified: false }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CoreClient(async () => session("core-token"));

    await expect(client.syncNow("run-1")).rejects.toMatchObject({ code: "manifest_not_verified" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

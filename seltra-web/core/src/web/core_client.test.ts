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

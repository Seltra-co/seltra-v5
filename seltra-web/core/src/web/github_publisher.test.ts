import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GithubPublisher } from "../../server/src/publish/github.js";

function publisher(mode: "hobby" | "team", fetcher: typeof fetch) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return new GithubPublisher({
    org: "Seltra-Cloud",
    appId: "12345",
    installationId: "67890",
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    mode,
    repoPrefix: "fixture-",
  }, fetcher);
}

describe("GithubPublisher repository visibility", () => {
  it.each([
    ["hobby", false, "public"],
    ["team", true, "private"],
  ] as const)("creates %s repositories as %s", async (mode, isPrivate, visibility) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "installation-token", expires_at: new Date(Date.now() + 60_000).toISOString() }), { status: 201 }))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockImplementationOnce(async (_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ name: "fixture-app-1", private: isPrivate, auto_init: false });
        return new Response(JSON.stringify({ id: 1, full_name: "Seltra-Cloud/fixture-app-1", private: isPrivate, clone_url: "https://github.com/Seltra-Cloud/fixture-app-1.git", default_branch: "main" }), { status: 201 });
      });

    await expect(publisher(mode, fetcher).ensureRepo("APP-1")).resolves.toMatchObject({ visibility });
  });

  it("changes an existing repository to the visibility required by deploy mode", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "installation-token", expires_at: new Date(Date.now() + 60_000).toISOString() }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ private: true }), { status: 200 }))
      .mockImplementationOnce(async (_input, init) => {
        expect(init?.method).toBe("PATCH");
        expect(JSON.parse(String(init?.body))).toEqual({ private: false });
        return new Response(JSON.stringify({ id: 1, full_name: "Seltra-Cloud/fixture-app-1", private: false, clone_url: "https://github.com/Seltra-Cloud/fixture-app-1.git", default_branch: "main" }), { status: 200 });
      });

    await expect(publisher("hobby", fetcher).ensureRepo("APP-1")).resolves.toMatchObject({ visibility: "public" });
  });
});


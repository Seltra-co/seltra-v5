import { describe, expect, it, vi } from "vitest";
import { GithubPublisher } from "./github.js";

const repository = {
  id: "1",
  fullName: "seltra-test/app-123",
  visibility: "private" as const,
  cloneUrl: "https://github.com/seltra-test/app-123.git",
  defaultBranch: "main",
};

function createPublisher(stdout: string) {
  const gitRunner = vi.fn(async () => ({ stdout }));
  const publisher = new GithubPublisher({
    org: "seltra-test",
    appId: "1",
    installationId: "1",
    privateKeyPem: "unused",
    repoPrefix: "app-",
  }, fetch, gitRunner);
  vi.spyOn(publisher, "installationToken").mockResolvedValue("test-token");
  return { publisher, gitRunner };
}

function createRepositoryPublisher(fetcher: typeof fetch) {
  const publisher = new GithubPublisher({
    org: "seltra-test",
    appId: "1",
    installationId: "1",
    privateKeyPem: "unused",
    repoPrefix: "app-",
  }, fetcher, vi.fn(async () => ({ stdout: "" })));
  vi.spyOn(publisher, "installationToken").mockResolvedValue("test-token");
  return publisher;
}

describe("GithubPublisher.hasBranch", () => {
  it("reports an empty branch as absent", async () => {
    const { publisher, gitRunner } = createPublisher("");

    await expect(publisher.hasBranch(repository, "main")).resolves.toBe(false);
    expect(gitRunner).toHaveBeenCalledWith(
      ["ls-remote", repository.cloneUrl, "refs/heads/main"],
      expect.any(Object),
    );
  });

  it("reports a saved branch as present", async () => {
    const { publisher } = createPublisher(`${"a".repeat(40)}\trefs/heads/main\n`);

    await expect(publisher.hasBranch(repository, "main")).resolves.toBe(true);
  });

  it("returns the saved branch revision", async () => {
    const sha = "b".repeat(40);
    const { publisher } = createPublisher(`${sha}\trefs/heads/main\n`);

    await expect(publisher.getBranchSha(repository, "main")).resolves.toBe(sha);
  });
});

describe("GithubPublisher.ensureRepo", () => {
  it("creates private repositories for durable app source", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 7,
        full_name: "seltra-test/app-123",
        private: true,
        clone_url: "https://github.com/seltra-test/app-123.git",
        default_branch: "main",
      }), { status: 201, headers: { "content-type": "application/json" } }));
    const publisher = createRepositoryPublisher(fetcher);

    await expect(publisher.ensureRepo("123")).resolves.toMatchObject({
      fullName: "seltra-test/app-123",
      visibility: "private",
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://api.github.com/orgs/seltra-test/repos", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "app-123", private: true, auto_init: false }),
    }));
  });

  it("makes an existing public repository private", async () => {
    const privateRepo = {
      id: 7,
      full_name: "seltra-test/app-123",
      private: true,
      clone_url: "https://github.com/seltra-test/app-123.git",
      default_branch: "main",
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...privateRepo, private: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(privateRepo), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    const publisher = createRepositoryPublisher(fetcher);

    await expect(publisher.ensureRepo("123")).resolves.toMatchObject({
      visibility: "private",
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://api.github.com/repos/seltra-test/app-123", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ private: true }),
    }));
  });
});

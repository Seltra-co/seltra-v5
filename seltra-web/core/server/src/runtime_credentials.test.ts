import { describe, expect, it } from "vitest";
import { deriveWorkspaceCredential } from "./runtime_credentials.js";

describe("deriveWorkspaceCredential", () => {
  const identity = {
    workspaceId: "tenant-1",
    workspaceKey: "a".repeat(32),
    userId: "user-1",
  };
  const secretsKey = "b".repeat(64);

  it("returns stable workspace credentials across runtime restarts", () => {
    expect(
      deriveWorkspaceCredential(
        secretsKey,
        "rpc",
        identity.workspaceId,
        identity.workspaceKey,
        identity.userId,
      ),
    ).toBe(
      deriveWorkspaceCredential(
        secretsKey,
        "rpc",
        identity.workspaceId,
        identity.workspaceKey,
        identity.userId,
      ),
    );
  });

  it("isolates credentials by purpose and workspace identity", () => {
    const rpcCredential = deriveWorkspaceCredential(
      secretsKey,
      "rpc",
      identity.workspaceId,
      identity.workspaceKey,
      identity.userId,
    );

    expect(
      deriveWorkspaceCredential(
        secretsKey,
        "model",
        identity.workspaceId,
        identity.workspaceKey,
        identity.userId,
      ),
    ).not.toBe(rpcCredential);
    expect(
      deriveWorkspaceCredential(
        secretsKey,
        "rpc",
        identity.workspaceId,
        identity.workspaceKey,
        "other-user",
      ),
    ).not.toBe(rpcCredential);
  });

  it("rejects malformed keys and incomplete identities", () => {
    expect(() =>
      deriveWorkspaceCredential(
        "invalid",
        "rpc",
        identity.workspaceId,
        identity.workspaceKey,
        identity.userId,
      ),
    ).toThrow("Workspace secret key has an invalid format.");
    expect(() =>
      deriveWorkspaceCredential(
        secretsKey,
        "rpc",
        "",
        identity.workspaceKey,
        identity.userId,
      ),
    ).toThrow("Workspace credential identity is incomplete.");
  });
});

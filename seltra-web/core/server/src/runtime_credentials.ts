import { createHmac } from "node:crypto";

type RuntimeCredentialPurpose = "rpc" | "model";

export function deriveWorkspaceCredential(
  secretsKey: string,
  purpose: RuntimeCredentialPurpose,
  workspaceId: string,
  workspaceKey: string,
  userId: string,
): string {
  if (!/^[a-f0-9]{64}$/i.test(secretsKey)) {
    throw new Error("Workspace secret key has an invalid format.");
  }
  if (![workspaceId, workspaceKey, userId].every((value) => value.trim())) {
    throw new Error("Workspace credential identity is incomplete.");
  }

  return createHmac("sha256", Buffer.from(secretsKey, "hex"))
    .update(
      [
        "seltra-workspace-credential-v1",
        purpose,
        workspaceId,
        workspaceKey,
        userId,
      ].join("\0"),
    )
    .digest("hex");
}

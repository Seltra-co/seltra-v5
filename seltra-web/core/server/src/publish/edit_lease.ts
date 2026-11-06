import { randomUUID } from "node:crypto";

export type EditLease = { holderSessionId: string; expiresAt: string };
type LeaseOperation = "acquire" | "renew" | "release";

export class EditLeaseClient {
  constructor(private readonly backendUrl: string, private readonly coreServiceSecret: string, private readonly fetcher: typeof fetch = fetch) {}

  createHolderSessionId(): string { return randomUUID(); }

  acquire(input: { userId: string; workspaceKey: string; coreAppId: number; holderSessionId?: string; ttlSeconds?: number }): Promise<EditLease> {
    return this.call("acquire", { ...input, holderSessionId: input.holderSessionId || this.createHolderSessionId() });
  }

  renew(input: { userId: string; workspaceKey: string; coreAppId: number; holderSessionId: string; ttlSeconds?: number }): Promise<EditLease> {
    return this.call("renew", input);
  }

  async release(input: { userId: string; workspaceKey: string; coreAppId: number; holderSessionId: string }): Promise<boolean> {
    const result = await this.call<{ released: boolean }>("release", input);
    return result.released;
  }

  private async call<T = EditLease>(operation: LeaseOperation, body: unknown): Promise<T> {
    const response = await this.fetcher(`${this.backendUrl.replace(/\/+$/, "")}/api/v5/internal/core/publish/edit-lease/${operation}`, {
      method: "POST", headers: { "content-type": "application/json", "x-core-service-secret": this.coreServiceSecret },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status === 409) throw Object.assign(new Error("Another session currently holds the edit lease."), { code: "EDIT_LOCKED" });
      throw Object.assign(new Error("The Backend could not update the edit lease."), { code: response.status === 403 ? "WORKSPACE_FORBIDDEN" : "EDIT_LEASE_UNAVAILABLE" });
    }
    return await response.json() as T;
  }
}

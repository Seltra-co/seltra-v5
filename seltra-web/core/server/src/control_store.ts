import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type WorkspaceRecord = { workspaceId: string; userId: string; createdAt: string };
export type UsageEvent = {
  workspaceId: string;
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  ok: boolean;
  errorClass?: string;
  latencyMs: number;
  runId: string;
  estimated: boolean;
  createdAt: string;
};

export interface ControlStore {
  getOrCreateWorkspace(userId: string, requestedId?: string, email?: string): Promise<WorkspaceRecord>;
  appendUsage(event: UsageEvent): Promise<void>;
  listUsage(workspaceId: string): Promise<UsageEvent[]>;
}

export class FileControlStore implements ControlStore {
  private readonly filePath: string;
  private queue = Promise.resolve();

  constructor(controlDir: string) {
    this.filePath = path.join(controlDir, "control.jsonl");
  }

  private async readRows(): Promise<Array<Record<string, unknown>>> {
    const text = await fs.readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  private async append(row: Record<string, unknown>): Promise<void> {
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, JSON.stringify(row) + "\n", { encoding: "utf8", mode: 0o600 });
    });
    await this.queue;
  }

  async getOrCreateWorkspace(userId: string, requestedId?: string, _email?: string): Promise<WorkspaceRecord> {
    const existing = (await this.readRows()).find((row) => row.kind === "workspace" &&
      (requestedId ? (row.value as WorkspaceRecord).workspaceId === requestedId : true));
    if (existing) return existing.value as WorkspaceRecord;
    const record = {
      workspaceId: requestedId ?? randomBytes(6).toString("hex"),
      userId,
      createdAt: new Date().toISOString(),
    };
    await this.append({ kind: "workspace", value: record });
    return record;
  }

  async appendUsage(event: UsageEvent): Promise<void> {
    await this.append({ kind: "usage", value: event });
  }

  async listUsage(workspaceId: string): Promise<UsageEvent[]> {
    return (await this.readRows())
      .filter((row) => row.kind === "usage" && (row.value as UsageEvent).workspaceId === workspaceId)
      .map((row) => row.value as UsageEvent);
  }
}

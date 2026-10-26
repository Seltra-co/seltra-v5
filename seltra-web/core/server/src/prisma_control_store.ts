import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ControlStore, UsageEvent, WorkspaceRecord } from "./control_store.js";

type PrismaUsageRow = {
  workspaceId: string; role: string; model: string; inputTokens: number;
  outputTokens: number; cachedInputTokens: number; ok: boolean;
  errorClass: string | null; latencyMs: number; runId: string | null;
  estimated: boolean; createdAt: Date;
};

export class PrismaControlStore implements ControlStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreateWorkspace(userId: string, requestedId?: string, email = userId): Promise<WorkspaceRecord> {
    const userById = await this.prisma.user.findUnique({ where: { id: userId } });
    const userByEmail = userById ? null : await this.prisma.user.findUnique({ where: { email } });
    if (userByEmail && userByEmail.id !== userId) {
      throw new Error("Control-store identity does not match the Seltra user id.");
    }
    if (!userById && !userByEmail) await this.prisma.user.create({ data: { id: userId, email } });
    let workspace = requestedId
      ? await this.prisma.workspace.findUnique({ where: { id: requestedId } })
      : await this.prisma.workspace.findFirst({ where: { userId } });
    if (workspace && workspace.userId !== userId) throw new Error("Workspace belongs to another control-store user.");
    if (!workspace) {
      workspace = await this.prisma.workspace.create({
        data: { id: requestedId ?? randomWorkspaceId(), userId, status: "ready" },
      });
    }
    return { workspaceId: workspace.id, userId, createdAt: workspace.createdAt.toISOString() };
  }

  async appendUsage(event: UsageEvent): Promise<void> {
    await this.prisma.usageEvent.create({
      data: {
        workspaceId: event.workspaceId,
        role: event.role,
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cachedInputTokens: event.cachedInputTokens,
        ok: event.ok,
        errorClass: event.errorClass,
        latencyMs: event.latencyMs,
        runId: event.runId,
        estimated: event.estimated,
        createdAt: new Date(event.createdAt),
      },
    });
  }

  async listUsage(workspaceId: string): Promise<UsageEvent[]> {
    return (await this.prisma.usageEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } })).map((row: PrismaUsageRow) => ({
      workspaceId: row.workspaceId,
      role: row.role,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cachedInputTokens,
      ok: row.ok,
      errorClass: row.errorClass ?? undefined,
      latencyMs: row.latencyMs,
      runId: row.runId ?? "",
      estimated: row.estimated,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

function randomWorkspaceId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12).toLowerCase();
}

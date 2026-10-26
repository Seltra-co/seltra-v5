// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { listExperimentArtifactHistory } from "@/ipc/services/experiment_artifact_store";
import { agentThreads } from "@/db/schema";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { and, eq } from "drizzle-orm";

describe("Experiment 2 orchestration through Dyad's chat flow", () => {
  let harness: ChatFlowHarness;
  const orchestrationEnabledBefore = process.env.SELTRA_ORCHESTRATION_ENABLED;

  beforeAll(async () => {
    vi.stubEnv("SELTRA_ORCHESTRATION_ENABLED", "1");
    harness = await setupChatFlowHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        enableExplorerSubagent: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
    if (orchestrationEnabledBefore === undefined) {
      delete process.env.SELTRA_ORCHESTRATION_ENABLED;
    } else {
      process.env.SELTRA_ORCHESTRATION_ENABLED = orchestrationEnabledBefore;
    }
    vi.unstubAllEnvs();
  });

  it("plans, builds with Dyad, and records evidence-backed task completion", async () => {
    const { result, events, eventsFor } = await harness.streamChat(
      "tc=local-agent/experiment2-orchestration Create a simple portfolio welcome page.",
    );

    expect(result).toBeUndefined();
    expect(harness.readAppFile("src/App.tsx")).toContain(
      "Welcome to my portfolio",
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(events.map((event) => event.channel)).toContain("chat:response:end");

    const artifacts = await listExperimentArtifactHistory({
      appId: harness.appId,
      appPath: harness.appDir,
      chatId: harness.chatId,
      kind: "implementation_plan",
    });
    expect(artifacts).toHaveLength(3);
    expect(artifacts.at(-1)).toMatchObject({
      kind: "implementation_plan",
      content: {
        tasks: [
          {
            id: "build_home",
            status: "completed",
            evidence: expect.stringContaining("src/App.tsx"),
          },
        ],
      },
    });

    const designSpecs = await listExperimentArtifactHistory({
      appId: harness.appId,
      appPath: harness.appDir,
      chatId: harness.chatId,
      kind: "design_spec",
    });
    expect(designSpecs).toHaveLength(1);
    expect(
      designSpecs[0]?.kind === "design_spec" && designSpecs[0].content.routes,
    ).toEqual(["/"]);
    expect(
      await listExperimentArtifactHistory({
        appId: harness.appId,
        appPath: harness.appDir,
        chatId: harness.chatId,
        kind: "commerce_spec",
      }),
    ).toHaveLength(0);
  }, 60_000);

  it("records only relevant commerce workflows and labels demo integrations", async () => {
    const { eventsFor } = await harness.streamChat(
      "tc=local-agent/experiment3-commerce-planning Build a demo handmade-goods store with variants, stock, a cart, pickup, and no real payments.",
    );

    expect(eventsFor("chat:response:error")).toHaveLength(0);
    const commerceSpecs = await listExperimentArtifactHistory({
      appId: harness.appId,
      appPath: harness.appDir,
      chatId: harness.chatId,
      kind: "commerce_spec",
    });
    expect(commerceSpecs).toHaveLength(1);
    expect(commerceSpecs[0]).toMatchObject({
      kind: "commerce_spec",
      status: "ready",
      content: {
        relevantWorkflows: [
          "catalog",
          "variants",
          "inventory",
          "cart",
          "checkout",
          "pickup",
        ],
        acceptanceCriteria: expect.arrayContaining([
          expect.stringContaining("demo checkout"),
        ]),
        demoBehaviors: expect.arrayContaining([
          expect.stringContaining("without processing a payment"),
        ]),
        productionIntegrations: [
          { name: "Payment processing", status: "unconfigured" },
          { name: "Live inventory sync", status: "unconfigured" },
        ],
      },
    });
  }, 60_000);

  it("continues the basic build when an optional specialist fails without a report", async () => {
    const { eventsFor } = await harness.streamChat(
      "tc=local-agent/experiment2-optional-specialist-fails Make a small implementation change.",
    );

    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(
      harness.readAppFile("src/optional-specialist-fallback.ts"),
    ).toContain("implementationContinued = true");
    const specialists = await harness.db.query.agentThreads.findMany({
      where: and(
        eq(agentThreads.chatId, harness.chatId),
        eq(agentThreads.taskName, "Optional design review"),
      ),
    });
    expect(specialists).toHaveLength(1);
    expect(specialists[0]?.status).toBe("partial");
  }, 60_000);

  it("rejects overlapping in-progress writer scopes before implementation", async () => {
    const priorPlans = await listExperimentArtifactHistory({
      appId: harness.appId,
      appPath: harness.appDir,
      chatId: harness.chatId,
      kind: "implementation_plan",
    });
    const { eventsFor } = await harness.streamChat(
      "tc=local-agent/experiment2-overlapping-writers Attempt two independent home-page changes.",
    );

    expect(eventsFor("chat:response:error")).toHaveLength(0);
    const afterPlans = await listExperimentArtifactHistory({
      appId: harness.appId,
      appPath: harness.appDir,
      chatId: harness.chatId,
      kind: "implementation_plan",
    });
    expect(afterPlans).toHaveLength(priorPlans.length);
    expect(
      JSON.stringify(afterPlans.map((artifact) => artifact.content)),
    ).not.toContain("edit_home_copy");
    expect(harness.readAppFile("src/App.tsx")).not.toContain(
      "Edit the home page copy",
    );
  }, 60_000);
});

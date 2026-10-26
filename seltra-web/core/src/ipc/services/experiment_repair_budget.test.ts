import { describe, expect, it } from "vitest";
import type { ExperimentArtifact } from "@/ipc/types/experiment_artifact";
import { getExperimentRepairBudget } from "./experiment_repair_budget";

const critiqueId = "11111111-1111-4111-8111-111111111111";
const nextCritiqueId = "22222222-2222-4222-8222-222222222222";

function artifact(
  kind: "visual_critique" | "repair_plan" | "verification_report",
  version: number,
  createdAt: string,
  options: {
    id?: string;
    basis?: string;
    cap?: number;
    producer?: string;
  } = {},
): ExperimentArtifact {
  const shared = {
    schemaVersion: 1 as const,
    artifactId:
      options.id ??
      `${version}${version}${version}${version}1111-4111-8111-111111111111`,
    runId: "run",
    appId: 1,
    chatId: 1,
    messageId: 1,
    version,
    createdAt,
    producer: options.producer ?? "dyad-local-agent",
  };
  if (kind === "visual_critique") {
    return {
      ...shared,
      kind,
      status: "needs_review",
      content: {
        reviews: [
          {
            route: "/",
            viewport: { width: 390, height: 844 },
            screenshotPath:
              ".dyad/experiment-2/screenshots/chat-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
            strengths: [],
            findings: [],
          },
        ],
        limitations: [],
      },
    } as ExperimentArtifact;
  }
  if (kind === "repair_plan") {
    return {
      ...shared,
      kind,
      status: "needs_review",
      content: {
        basisCritiqueId: options.basis ?? critiqueId,
        maxIterations: options.cap ?? 3,
        findings: [],
      },
    } as ExperimentArtifact;
  }
  return {
    ...shared,
    kind,
    status: "needs_review",
    producer: options.producer ?? "dyad-test-runner",
    content: {
      status: "needs_review",
      routes: [],
      viewports: [],
      findings: [],
      limitations: [],
    },
  } as ExperimentArtifact;
}

describe("getExperimentRepairBudget", () => {
  it("counts only host test reports after the first matching plan and never expands its cap", () => {
    const history = [
      artifact("visual_critique", 1, "2026-01-01T00:00:00.000Z", {
        id: critiqueId,
      }),
      artifact("verification_report", 1, "2026-01-02T00:00:00.000Z"),
      artifact("repair_plan", 1, "2026-01-03T00:00:00.000Z", {
        basis: critiqueId,
        cap: 2,
      }),
      artifact("repair_plan", 2, "2026-01-04T00:00:00.000Z", {
        basis: critiqueId,
        cap: 3,
      }),
      artifact("verification_report", 2, "2026-01-05T00:00:00.000Z"),
      artifact("verification_report", 3, "2026-01-06T00:00:00.000Z", {
        producer: "dyad-local-agent",
      }),
    ];

    expect(getExperimentRepairBudget(history)).toEqual({
      basisCritiqueId: critiqueId,
      maxIterations: 2,
      completedRechecks: 1,
      remaining: 1,
    });
  });

  it("resets only when a newer critique exists and its own plan is saved", () => {
    const history = [
      artifact("visual_critique", 1, "2026-01-01T00:00:00.000Z", {
        id: critiqueId,
      }),
      artifact("repair_plan", 1, "2026-01-02T00:00:00.000Z", {
        basis: critiqueId,
        cap: 1,
      }),
      artifact("verification_report", 1, "2026-01-03T00:00:00.000Z"),
      artifact("visual_critique", 2, "2026-01-04T00:00:00.000Z", {
        id: nextCritiqueId,
      }),
    ];
    expect(getExperimentRepairBudget(history)).toBeUndefined();
    history.push(
      artifact("repair_plan", 2, "2026-01-05T00:00:00.000Z", {
        basis: nextCritiqueId,
        cap: 3,
      }),
    );
    expect(getExperimentRepairBudget(history)?.remaining).toBe(3);
  });
});

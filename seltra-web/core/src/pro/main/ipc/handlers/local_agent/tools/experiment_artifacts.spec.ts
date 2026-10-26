import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";

const { listHistory, saveArtifact } = vi.hoisted(() => ({
  listHistory: vi.fn(),
  saveArtifact: vi.fn(),
}));
vi.mock("@/ipc/services/experiment_artifact_store", () => ({
  listExperimentArtifactHistory: listHistory,
  listExperimentArtifacts: vi.fn(),
  saveExperimentArtifact: saveArtifact,
}));

vi.mock("@/ipc/services/experiment_run_log", () => ({
  logExperimentRunEvent: vi.fn(),
}));
import {
  readExperimentArtifactsTool,
  writeExperimentArtifactsTool,
} from "./experiment_artifacts";

beforeEach(() => {
  listHistory.mockReset().mockResolvedValue([]);
  saveArtifact.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("Experiment 2 artifact tools", () => {
  it("are opt-in, and only the root agent can write artifacts", () => {
    const root = {} as AgentContext;
    const child = {
      mutationActivityOwner: { persona: "implementer" },
    } as AgentContext;

    vi.stubEnv("SELTRA_ORCHESTRATION_ENABLED", "0");
    expect(writeExperimentArtifactsTool.isEnabled?.(root)).toBe(false);
    expect(readExperimentArtifactsTool.isEnabled?.(root)).toBe(false);

    vi.stubEnv("SELTRA_ORCHESTRATION_ENABLED", "1");
    expect(writeExperimentArtifactsTool.isEnabled?.(root)).toBe(true);
    expect(writeExperimentArtifactsTool.isEnabled?.(child)).toBe(false);
    expect(readExperimentArtifactsTool.isEnabled?.(child)).toBe(true);
  });

  it("allows selecting the visual critique artifact when reading saved records", () => {
    expect(
      readExperimentArtifactsTool.inputSchema.safeParse({
        kinds: ["visual_critique"],
      }).success,
    ).toBe(true);
  });

  it("allows selecting a Figma design reference when reading saved records", () => {
    expect(
      readExperimentArtifactsTool.inputSchema.safeParse({
        kinds: ["design_reference"],
      }).success,
    ).toBe(true);
  });

  it("refuses agent-authored passed reports without a host verification path", () => {
    const passed = {
      artifacts: [
        {
          kind: "verification_report",
          status: "needs_review",
          content: {
            status: "passed",
            routes: [
              { path: "/", status: "passed", evidence: ["Opened route"] },
            ],
            viewports: [
              {
                name: "desktop",
                width: 1440,
                height: 900,
                status: "passed",
                screenshotPath: "screenshots/desktop.png",
              },
            ],
            findings: [],
            limitations: [],
          },
        },
      ],
    };
    const review = {
      artifacts: [
        {
          kind: "verification_report",
          status: "needs_review",
          content: {
            ...passed.artifacts[0].content,
            status: "needs_review",
          },
        },
      ],
    };

    expect(
      writeExperimentArtifactsTool.inputSchema.safeParse(passed).success,
    ).toBe(false);
    expect(
      writeExperimentArtifactsTool.inputSchema.safeParse(review).success,
    ).toBe(true);
  });

  it("does not let the agent forge host-attached screenshot paths", () => {
    const candidate = {
      artifacts: [
        {
          kind: "verification_report",
          status: "needs_review",
          content: {
            status: "needs_review",
            routes: [],
            viewports: [],
            findings: [],
            attachedScreenshotPaths: [
              ".dyad/experiment-2/screenshots/chat-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
            ],
            limitations: [],
          },
        },
      ],
    };
    expect(
      writeExperimentArtifactsTool.inputSchema.safeParse(candidate).success,
    ).toBe(false);
  });

  it("requires a complete evidence-based scorecard for every new screenshot critique", () => {
    const dimensions = [
      "composition",
      "typography",
      "brand_coherence",
      "image_quality",
      "interaction_clarity",
      "responsive_adaptation",
      "accessibility",
      "page_consistency",
    ];
    const critique = {
      artifacts: [
        {
          kind: "visual_critique",
          status: "needs_review",
          content: {
            reviews: [
              {
                route: "/",
                viewport: { width: 390, height: 844 },
                screenshotPath:
                  ".dyad/experiment-2/screenshots/chat-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
                strengths: ["Primary action is visible."],
                findings: [],
                scores: dimensions.map((dimension) => ({
                  dimension,
                  score: 4,
                  evidence: `Screenshot supports the ${dimension} score.`,
                })),
              },
            ],
            limitations: ["Automated score still requires human review."],
          },
        },
      ],
    };
    expect(
      writeExperimentArtifactsTool.inputSchema.safeParse(critique).success,
    ).toBe(true);
    expect(
      writeExperimentArtifactsTool.inputSchema.safeParse({
        artifacts: [
          {
            ...critique.artifacts[0],
            content: {
              ...critique.artifacts[0].content,
              reviews: [
                {
                  ...critique.artifacts[0].content.reviews[0],
                  scores: undefined,
                },
              ],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires required routes in a newly written DesignSpec", () => {
    const candidate = {
      artifacts: [
        {
          kind: "design_spec",
          status: "ready",
          content: {
            brandPositioning: "Modern local bakery",
            audience: ["Neighborhood customers"],
            emotionalResponse: ["Welcoming"],
            pageHierarchy: ["Home", "Menu", "Visit"],
            compositions: ["Editorial hero and menu sections"],
            typography: ["Friendly display headings"],
            palette: ["Warm cream and cocoa"],
            spacingAndSurfaces: ["Open spacing, soft surfaces"],
            artDirection: ["Fresh pastry photography"],
            responsiveBehavior: ["Stack menu cards on mobile"],
            accessibility: ["Visible keyboard focus"],
            interactionStates: ["Menu links and ordering CTA"],
            antiPatterns: ["No generic dashboard cards"],
            acceptanceCriteria: ["Menu is easy to scan"],
          },
        },
      ],
    };
    expect(
      writeExperimentArtifactsTool.inputSchema.safeParse(candidate).success,
    ).toBe(false);
  });

  it("host-rejects implementation-plan progress before dependencies complete", async () => {
    const ctx = {
      appId: 1,
      chatId: 2,
      appPath: "C:/fixture/app",
      messageId: 3,
      dyadRequestId: "run-1",
    } as AgentContext;
    const candidate = {
      artifacts: [
        {
          kind: "implementation_plan",
          status: "ready",
          content: {
            tasks: [
              {
                id: "prepare",
                title: "Prepare source context",
                dependsOn: [],
                writerScope: ["src/brief.md"],
                status: "pending",
              },
              {
                id: "build",
                title: "Implement the app",
                dependsOn: ["prepare"],
                writerScope: ["src/App.tsx"],
                status: "in_progress",
              },
            ],
          },
        },
      ],
    };
    const parsed = writeExperimentArtifactsTool.inputSchema.parse(candidate);

    await expect(
      writeExperimentArtifactsTool.execute?.(parsed, ctx),
    ).rejects.toThrow(
      "Task build cannot in_progress before every dependency is completed.",
    );
    expect(saveArtifact).not.toHaveBeenCalled();
  });
});

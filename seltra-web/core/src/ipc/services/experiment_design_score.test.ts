import { describe, expect, it } from "vitest";
import { experimentArtifactInputSchema } from "@/ipc/types/experiment_artifact";
import {
  aggregateExperimentDesignScores,
  EXPERIMENT_VISUAL_DIMENSIONS,
  type ExperimentVisualReview,
} from "./experiment_design_score";

const review = (score = 4): ExperimentVisualReview => ({
  route: "/",
  viewport: { width: 1440, height: 900 },
  screenshotPath:
    ".dyad/experiment-2/screenshots/chat-1/00000000-0000-4000-8000-000000000000.png",
  strengths: ["The primary action has clear contrast."],
  findings: [],
  scores: EXPERIMENT_VISUAL_DIMENSIONS.map((dimension) => ({
    dimension,
    score,
    evidence: `Visible evidence for ${dimension}.`,
  })),
});

describe("Experiment 2 design score aggregation", () => {
  it("aggregates every dimension across screenshots without approving the design", () => {
    const result = aggregateExperimentDesignScores([review(4), review(2)]);
    expect(result).toEqual({
      complete: true,
      screenshotCount: 2,
      overall: 3,
      byDimension: Object.fromEntries(
        EXPERIMENT_VISUAL_DIMENSIONS.map((dimension) => [dimension, 3]),
      ),
    });
  });

  it("withholds the overall score when any screenshot is incompletely scored", () => {
    const incomplete = { ...review(), scores: review().scores?.slice(1) };
    const result = aggregateExperimentDesignScores([incomplete]);
    expect(result.complete).toBe(false);
    expect(result).not.toHaveProperty("overall");
    expect(result.byDimension).not.toHaveProperty("composition");
  });

  it("accepts typed per-screenshot scores while keeping the critique reviewable", () => {
    const artifact = {
      kind: "visual_critique",
      status: "needs_review",
      content: {
        reviews: [review()],
        limitations: ["Model-authored score; human review remains."],
      },
    };
    expect(experimentArtifactInputSchema.safeParse(artifact).success).toBe(
      true,
    );
    expect(
      experimentArtifactInputSchema.safeParse({
        ...artifact,
        content: {
          ...artifact.content,
          reviews: [
            {
              ...review(),
              scores: [...review().scores!.slice(0, 7), review().scores![0]!],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});

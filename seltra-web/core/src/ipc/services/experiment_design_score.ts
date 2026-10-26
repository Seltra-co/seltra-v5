import type { ExperimentArtifact } from "@/ipc/types/experiment_artifact";

export const EXPERIMENT_VISUAL_DIMENSIONS = [
  "composition",
  "typography",
  "brand_coherence",
  "image_quality",
  "interaction_clarity",
  "responsive_adaptation",
  "accessibility",
  "page_consistency",
] as const;

export type ExperimentVisualDimension =
  (typeof EXPERIMENT_VISUAL_DIMENSIONS)[number];

export type ExperimentVisualReview = Extract<
  ExperimentArtifact,
  { kind: "visual_critique" }
>["content"]["reviews"][number];

export interface ExperimentDesignScoreSummary {
  complete: boolean;
  screenshotCount: number;
  overall?: number;
  byDimension: Partial<Record<ExperimentVisualDimension, number>>;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
    ) / 100
  );
}

/** Aggregate model-authored scores without granting host or human approval. */
export function aggregateExperimentDesignScores(
  reviews: ExperimentVisualReview[],
): ExperimentDesignScoreSummary {
  const byDimension: Partial<Record<ExperimentVisualDimension, number>> = {};
  let allScored = reviews.length > 0;

  for (const dimension of EXPERIMENT_VISUAL_DIMENSIONS) {
    const scores = reviews.flatMap((review) => {
      const score = review.scores?.find((item) => item.dimension === dimension);
      return score ? [score.score] : [];
    });
    const dimensionAverage = average(scores);
    if (dimensionAverage === undefined || scores.length !== reviews.length) {
      allScored = false;
    } else {
      byDimension[dimension] = dimensionAverage;
    }
  }

  const allScores = reviews.flatMap((review) =>
    (review.scores ?? []).map((score) => score.score),
  );
  return {
    complete: allScored,
    screenshotCount: reviews.length,
    ...(allScored ? { overall: average(allScores) } : {}),
    byDimension,
  };
}

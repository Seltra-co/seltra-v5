import type { ExperimentArtifact } from "@/ipc/types/experiment_artifact";

export type ExperimentRepairBudget = {
  basisCritiqueId: string;
  maxIterations: number;
  completedRechecks: number;
  remaining: number;
};

/** Return the current critique's bounded, host-counted repair budget, if any. */
export function getExperimentRepairBudget(
  history: ExperimentArtifact[],
): ExperimentRepairBudget | undefined {
  const critique = history
    .filter((artifact) => artifact.kind === "visual_critique")
    .sort((a, b) => b.version - a.version)[0];
  if (!critique || critique.kind !== "visual_critique") return undefined;

  const plans = history.filter(
    (artifact) =>
      artifact.kind === "repair_plan" &&
      artifact.content.basisCritiqueId === critique.artifactId,
  );
  if (plans.length === 0) return undefined;

  const firstPlanAt = plans
    .map((plan) => plan.createdAt)
    .sort((a, b) => a.localeCompare(b))[0];
  const maxIterations = Math.min(
    ...plans.map((plan) =>
      plan.kind === "repair_plan" ? plan.content.maxIterations : 0,
    ),
  );
  const completedRechecks = history.filter(
    (artifact) =>
      artifact.kind === "verification_report" &&
      artifact.producer === "dyad-test-runner" &&
      artifact.content.status !== "cancelled" &&
      artifact.createdAt > firstPlanAt,
  ).length;

  return {
    basisCritiqueId: critique.artifactId,
    maxIterations,
    completedRechecks,
    remaining: Math.max(0, maxIterations - completedRechecks),
  };
}

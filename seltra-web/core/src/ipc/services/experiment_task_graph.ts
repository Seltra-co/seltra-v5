import type { ExperimentImplementationTask } from "@/ipc/types/experiment_artifact";

const terminalStatuses = new Set<ExperimentImplementationTask["status"]>([
  "completed",
  "cancelled",
]);

const allowedTransitions: Record<
  ExperimentImplementationTask["status"],
  ReadonlySet<ExperimentImplementationTask["status"]>
> = {
  pending: new Set([
    "pending",
    "in_progress",
    "blocked",
    "failed",
    "timed_out",
    "cancelled",
  ]),
  in_progress: new Set([
    "in_progress",
    "completed",
    "blocked",
    "failed",
    "timed_out",
    "cancelled",
  ]),
  completed: new Set(["completed"]),
  blocked: new Set([
    "blocked",
    "pending",
    "in_progress",
    "failed",
    "timed_out",
    "cancelled",
  ]),
  failed: new Set(["failed", "pending", "in_progress", "cancelled"]),
  timed_out: new Set(["timed_out", "pending", "in_progress", "cancelled"]),
  cancelled: new Set(["cancelled"]),
};

function normalizeScope(scope: string): string | undefined {
  const normalized = scope.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || !segment)
  ) {
    return undefined;
  }
  return normalized.toLowerCase();
}

function scopesOverlap(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return true;
  const normalizedLeft = left.map(normalizeScope);
  const normalizedRight = right.map(normalizeScope);
  if (
    normalizedLeft.includes(undefined) ||
    normalizedRight.includes(undefined)
  ) {
    return true;
  }
  return normalizedLeft.some((leftPath) =>
    normalizedRight.some(
      (rightPath) =>
        leftPath === rightPath ||
        leftPath!.startsWith(`${rightPath}/`) ||
        rightPath!.startsWith(`${leftPath}/`),
    ),
  );
}

function dependenciesComplete(
  task: ExperimentImplementationTask,
  byId: Map<string, ExperimentImplementationTask>,
) {
  return task.dependsOn.every(
    (dependency) => byId.get(dependency)?.status === "completed",
  );
}

/** Validate host-enforced task status, dependency, retry, and writer-scope rules. */
export function validateImplementationPlanProgress(
  previous: ExperimentImplementationTask[] | undefined,
  next: ExperimentImplementationTask[],
): string[] {
  const errors: string[] = [];
  const nextById = new Map(next.map((task) => [task.id, task]));
  const previousById = new Map((previous ?? []).map((task) => [task.id, task]));

  for (const task of next) {
    if (task.writerScope.length === 0) {
      errors.push(
        `Task ${task.id} must declare at least one relative writerScope path.`,
      );
    }
    if (task.writerScope.some((scope) => !normalizeScope(scope))) {
      errors.push(
        `Task ${task.id} has an absolute or unsafe writerScope path.`,
      );
    }
    if (
      (task.status === "in_progress" || task.status === "completed") &&
      !dependenciesComplete(task, nextById)
    ) {
      errors.push(
        `Task ${task.id} cannot ${task.status} before every dependency is completed.`,
      );
    }
    if (task.status === "completed" && !task.evidence?.trim()) {
      errors.push(
        `Task ${task.id} cannot be completed without implementation or verification evidence.`,
      );
    }

    const prior = previousById.get(task.id);
    if (!prior) continue;
    if (!allowedTransitions[prior.status].has(task.status)) {
      errors.push(
        `Task ${task.id} cannot transition from ${prior.status} to ${task.status}.`,
      );
    }
    const oldAttempt = prior.attempt ?? 1;
    const newAttempt = task.attempt ?? oldAttempt;
    if (
      ["failed", "timed_out"].includes(prior.status) &&
      ["pending", "in_progress"].includes(task.status) &&
      newAttempt !== oldAttempt + 1
    ) {
      errors.push(`Task ${task.id} must increment its attempt when retrying.`);
    }
    if (newAttempt < oldAttempt || newAttempt > oldAttempt + 1) {
      errors.push(
        `Task ${task.id} may advance its attempt count by at most one.`,
      );
    }
    if (
      newAttempt > oldAttempt &&
      !["failed", "timed_out"].includes(prior.status)
    ) {
      errors.push(
        `Task ${task.id} may retry only after a failed or timed-out attempt.`,
      );
    }
    if (newAttempt > 2) {
      errors.push(`Task ${task.id} exceeded the two-attempt limit.`);
    }
    if (
      prior.status === "in_progress" &&
      (JSON.stringify(prior.dependsOn) !== JSON.stringify(task.dependsOn) ||
        JSON.stringify(prior.writerScope) !== JSON.stringify(task.writerScope))
    ) {
      errors.push(
        `Task ${task.id} cannot change dependencies or writerScope after starting.`,
      );
    }
  }

  for (const prior of previous ?? []) {
    if (!nextById.has(prior.id) && !terminalStatuses.has(prior.status)) {
      errors.push(
        `Task ${prior.id} must remain in the plan until it is completed or cancelled.`,
      );
    }
  }

  const active = next.filter((task) => task.status === "in_progress");
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < active.length;
      rightIndex += 1
    ) {
      const left = active[leftIndex]!;
      const right = active[rightIndex]!;
      if (scopesOverlap(left.writerScope, right.writerScope)) {
        errors.push(
          `In-progress tasks ${left.id} and ${right.id} have overlapping writer scopes.`,
        );
      }
    }
  }

  return errors;
}

/** Return dependency-ready tasks that can be worked without writer conflicts. */
export function getReadyImplementationTaskBatch(
  tasks: ExperimentImplementationTask[],
): ExperimentImplementationTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const active = tasks.filter((task) => task.status === "in_progress");
  const batch: ExperimentImplementationTask[] = [];
  for (const task of tasks) {
    if (task.status !== "pending" || !dependenciesComplete(task, byId))
      continue;
    if (
      [...active, ...batch].some((other) =>
        scopesOverlap(other.writerScope, task.writerScope),
      )
    ) {
      continue;
    }
    batch.push(task);
  }
  return batch;
}

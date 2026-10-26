import { describe, expect, it } from "vitest";
import type { ExperimentImplementationTask } from "@/ipc/types/experiment_artifact";
import {
  getReadyImplementationTaskBatch,
  validateImplementationPlanProgress,
} from "./experiment_task_graph";

const task = (
  id: string,
  options: Partial<ExperimentImplementationTask> = {},
): ExperimentImplementationTask => ({
  id,
  title: `Task ${id}`,
  dependsOn: [],
  writerScope: [`src/${id}.tsx`],
  status: "pending",
  ...options,
});

describe("Experiment 2 supervisor task graph", () => {
  it("returns dependency-ready work and separates overlapping writer scopes", () => {
    const tasks = [
      task("requirements", {
        status: "completed",
        evidence: "Requirements recorded.",
      }),
      task("header", {
        dependsOn: ["requirements"],
        writerScope: ["src/components"],
      }),
      task("footer", {
        dependsOn: ["requirements"],
        writerScope: ["src/components"],
      }),
      task("copy", {
        dependsOn: ["requirements"],
        writerScope: ["src/content"],
      }),
      task("verify", { dependsOn: ["header", "footer", "copy"] }),
    ];

    expect(getReadyImplementationTaskBatch(tasks).map(({ id }) => id)).toEqual([
      "header",
      "copy",
    ]);
  });

  it("keeps basic implementation ready when an optional specialist is blocked", () => {
    const tasks = [
      task("requirements", {
        status: "completed",
        evidence: "Brief recorded.",
      }),
      task("design-review", {
        dependsOn: ["requirements"],
        status: "blocked",
      }),
      task("build", { dependsOn: ["requirements"] }),
      task("verify", { dependsOn: ["build"] }),
    ];
    expect(getReadyImplementationTaskBatch(tasks).map(({ id }) => id)).toEqual([
      "build",
    ]);
  });

  it("requires completed dependencies and evidence before completion", () => {
    expect(
      validateImplementationPlanProgress(undefined, [
        task("design", { status: "in_progress", dependsOn: ["brief"] }),
      ]),
    ).toContain(
      "Task design cannot in_progress before every dependency is completed.",
    );
    expect(
      validateImplementationPlanProgress(undefined, [
        task("build", { status: "completed" }),
      ]),
    ).toContain(
      "Task build cannot be completed without implementation or verification evidence.",
    );
  });

  it("rejects illegal transitions, more than one retry, and active task removal", () => {
    const prior = [
      task("build", { status: "failed", attempt: 2 }),
      task("verify", { dependsOn: ["build"] }),
    ];
    const next = [task("build", { status: "in_progress", attempt: 4 })];
    const errors = validateImplementationPlanProgress(prior, next);
    expect(errors).toContain(
      "Task build may advance its attempt count by at most one.",
    );
    expect(errors).toContain("Task build exceeded the two-attempt limit.");
    expect(errors).toContain(
      "Task verify must remain in the plan until it is completed or cancelled.",
    );
    expect(
      validateImplementationPlanProgress(
        [task("retry", { status: "failed" })],
        [task("retry", { status: "in_progress" })],
      ),
    ).toContain("Task retry must increment its attempt when retrying.");
  });

  it("rejects concurrent overlapping writers and unsafe scopes", () => {
    const errors = validateImplementationPlanProgress(undefined, [
      task("one", { status: "in_progress", writerScope: ["src/components"] }),
      task("two", {
        status: "in_progress",
        writerScope: ["src/components/header.tsx"],
      }),
      task("unsafe", { writerScope: ["../outside"] }),
    ]);
    expect(errors).toContain(
      "In-progress tasks one and two have overlapping writer scopes.",
    );
    expect(errors).toContain(
      "Task unsafe has an absolute or unsafe writerScope path.",
    );
  });

  it("requires evidence to complete a task and keeps completed tasks immutable", () => {
    const prior = [
      task("build", { status: "completed", evidence: "Build checked." }),
    ];
    const errors = validateImplementationPlanProgress(prior, [task("build")]);
    expect(errors).toContain(
      "Task build cannot transition from completed to pending.",
    );
  });
});

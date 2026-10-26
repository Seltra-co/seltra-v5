import { beforeEach, describe, expect, it, vi } from "vitest";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info }) },
}));

import { logExperimentRunEvent } from "./experiment_run_log";

describe("Experiment 2 run logging", () => {
  beforeEach(() => info.mockClear());

  it("writes structured allowlisted event metadata", () => {
    logExperimentRunEvent({
      runId: "run-123",
      phase: "build",
      agent: "dyad-local-agent",
      modelId: "cloudflare/kimi-k2.7-code",
      durationMs: 42,
      toolOutcome: "run_tests:completed",
      artifactId: "artifact-123",
      errorClass: "ValidationError",
    });

    expect(JSON.parse(info.mock.calls[0][0])).toEqual({
      event: "experiment_2_run",
      runId: "run-123",
      phase: "build",
      agent: "dyad-local-agent",
      modelId: "cloudflare/kimi-k2.7-code",
      durationMs: 42,
      toolOutcome: "run_tests:completed",
      artifactId: "artifact-123",
      errorClass: "ValidationError",
    });
  });

  it("drops unsafe free-form values before writing logs", () => {
    logExperimentRunEvent({
      runId: "run-123",
      phase: "build",
      agent: "dyad-local-agent",
      modelId: "prompt with private user attachment",
      toolOutcome: "OPENAI_API_KEY=secretvalue",
    });

    const serialized = info.mock.calls[0][0] as string;
    expect(serialized).not.toContain("private user attachment");
    expect(serialized).not.toContain("secretvalue");
    expect(JSON.parse(serialized)).not.toHaveProperty("modelId");
    expect(JSON.parse(serialized)).not.toHaveProperty("toolOutcome");
  });
});

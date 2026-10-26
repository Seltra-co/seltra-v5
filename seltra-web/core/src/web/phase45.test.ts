import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
} from "../../server/src/resilience/circuit_breaker";
import {
  classifyFailure,
  fingerprintFailure,
} from "../../server/src/verify/failure";
import { repairUntilVerified } from "../../server/src/verify/repair_controller";
import {
  runVerificationPlan,
  type AllowlistedCommandRunner,
} from "../../server/src/verify/runner";

describe("web substrate resilience and verification", () => {
  it("opens after retryable failures and blocks during cooldown", async () => {
    let now = 100;
    const breaker = new CircuitBreaker(
      "cloud:model",
      {
        failureThreshold: 1,
        windowMs: 500,
        cooldownMs: 200,
        halfOpenMaxProbes: 1,
      },
      () => now,
    );
    await expect(
      breaker.execute(
        async () => {
          throw Error("server");
        },
        () => "retryable",
      ),
    ).rejects.toThrow("server");
    await expect(
      breaker.execute(
        async () => "no",
        () => "retryable",
      ),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    now = 300;
    await expect(
      breaker.execute(
        async () => "yes",
        () => "retryable",
      ),
    ).resolves.toBe("yes");
    expect(breaker.state).toBe("closed");
  });

  it("classifies stable failures and fingerprints normalized output", () => {
    expect(classifyFailure("TS2322 type error")).toBe("type_error");
    expect(classifyFailure("Cannot find module x")).toBe("missing_dependency");
    expect(fingerprintFailure("TS2322 at 123")).toBe(
      fingerprintFailure("ts2322 at 456"),
    );
  });

  it("stops after a repeated failure and records bounded repair attempts", async () => {
    let records = 0;
    const outcome = await repairUntilVerified({
      verify: async () => ({
        passed: false,
        output: "TS2304 name not found",
        suspectFiles: ["src/page.tsx"],
      }),
      repair: async () => ({ filesTouched: 1, apply: async () => {} }),
      record: async () => {
        records++;
      },
      allowsBudget: () => true,
      limits: { type_error: { maxAttempts: 3, maxFilesTouched: 2 } },
    });
    expect(outcome).toEqual({ ok: false, reason: "same_failure_repeated" });
    expect(records).toBe(2);
  });

  it("runs only fixed verification steps and halts at the first failure", async () => {
    const calls: string[] = [];
    const runner: AllowlistedCommandRunner = {
      run: async (_project, step) => {
        calls.push(step.command);
        return {
          exitCode: step.command === "build" ? 1 : 0,
          stdout: "",
          stderr: "broken",
          durationMs: 1,
        };
      },
    };
    const result = await runVerificationPlan(runner, "/workspace/apps/demo");
    expect(result.passed).toBe(false);
    expect(calls).toEqual(["install", "typecheck", "build"]);
  });
});

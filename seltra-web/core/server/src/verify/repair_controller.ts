import {
  classifyFailure,
  fingerprintFailure,
  type FailureClass,
} from "./failure.js";

export interface VerificationFailure {
  passed: false;
  output: string;
  source?: "command" | "browser" | "runner";
  suspectFiles: string[];
}
export interface RepairPatch {
  filesTouched: number;
  apply(): Promise<void>;
}
export interface RepairDependencies {
  verify(): Promise<{ passed: true } | VerificationFailure>;
  repair(input: {
    failure: VerificationFailure;
    failureClass: FailureClass;
    fingerprint: string;
  }): Promise<RepairPatch>;
  record(input: {
    failureClass: FailureClass;
    fingerprint: string;
    attemptNo: number;
    filesTouched: number;
    outcome: string;
  }): Promise<void>;
  allowsBudget(): boolean;
  limits: Partial<
    Record<FailureClass, { maxAttempts: number; maxFilesTouched: number }>
  >;
}
export type RepairOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "infrastructure"
        | "attempt_limit"
        | "same_failure_repeated"
        | "budget"
        | "patch_too_broad";
    };

export function buildRepairInstruction(input: {
  failure: string;
  expression: string;
  dataContract: string;
}): string {
  return [
    `Failure: ${input.failure}`,
    `Failing expression: ${input.expression}`,
    `Data contract: ${input.dataContract}`,
    "Make the smallest correction that satisfies the data contract. Preserve the page and surrounding components; do not rewrite the page.",
  ].join("\n");
}

export async function repairUntilVerified(
  deps: RepairDependencies,
): Promise<RepairOutcome> {
  const seen = new Map<string, number>();
  for (let attemptNo = 1; ; attemptNo++) {
    const result = await deps.verify();
    if (result.passed) return { ok: true };
    const failureClass = classifyFailure(result.output, result.source);
    const fingerprint = fingerprintFailure(result.output);
    if (failureClass === "infrastructure")
      return { ok: false, reason: "infrastructure" };
    const limit = deps.limits[failureClass] ?? {
      maxAttempts: 0,
      maxFilesTouched: 0,
    };
    if (attemptNo > limit.maxAttempts)
      return { ok: false, reason: "attempt_limit" };
    const repeats = seen.get(fingerprint) ?? 0;
    if (repeats >= 2) return { ok: false, reason: "same_failure_repeated" };
    if (!deps.allowsBudget()) return { ok: false, reason: "budget" };
    seen.set(fingerprint, repeats + 1);
    const patch = await deps.repair({
      failure: result,
      failureClass,
      fingerprint,
    });
    if (patch.filesTouched > limit.maxFilesTouched) {
      await deps.record({
        failureClass,
        fingerprint,
        attemptNo,
        filesTouched: patch.filesTouched,
        outcome: "patch_too_broad",
      });
      return { ok: false, reason: "patch_too_broad" };
    }
    await patch.apply();
    await deps.record({
      failureClass,
      fingerprint,
      attemptNo,
      filesTouched: patch.filesTouched,
      outcome: "applied",
    });
  }
}

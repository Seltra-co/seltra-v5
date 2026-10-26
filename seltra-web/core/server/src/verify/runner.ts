export const VERIFY_COMMANDS = [
  "install",
  "typecheck",
  "build",
  "browser",
] as const;
export type VerifyCommand = (typeof VERIFY_COMMANDS)[number];

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface VerifyStep {
  command: VerifyCommand;
  args?: string[];
  timeoutMs?: number;
}

/** Adapter implementations must map these names to fixed executables and argv. */
export interface AllowlistedCommandRunner {
  run(
    projectPath: string,
    step: VerifyStep,
    signal?: AbortSignal,
  ): Promise<CommandResult>;
}

export async function runVerificationPlan(
  runner: AllowlistedCommandRunner,
  projectPath: string,
  signal?: AbortSignal,
): Promise<{
  passed: boolean;
  source?: "runner";
  results: Array<VerifyStep & { result: CommandResult }>;
}> {
  const steps: VerifyStep[] = [
    { command: "install", timeoutMs: 10 * 60_000 },
    { command: "typecheck", timeoutMs: 3 * 60_000 },
    { command: "build", timeoutMs: 10 * 60_000 },
    { command: "browser", args: ["desktop", "mobile"], timeoutMs: 5 * 60_000 },
  ];
  const results: Array<VerifyStep & { result: CommandResult }> = [];
  for (const step of steps) {
    if (signal?.aborted) throw signal.reason;
    try {
      const result = await runner.run(projectPath, step, signal);
      results.push({ ...step, result });
      if (result.exitCode !== 0) return { passed: false, results };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        ...step,
        result: { exitCode: -1, stdout: "", stderr: message, durationMs: 0 },
      });
      return { passed: false, source: "runner", results };
    }
  }
  return { passed: true, results };
}

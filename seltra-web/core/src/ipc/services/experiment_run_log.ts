import log from "electron-log";

const logger = log.scope("experiment_2_run");

export type ExperimentRunLogEvent = {
  runId: string;
  phase: string;
  agent: string;
  modelId?: string;
  durationMs?: number;
  toolOutcome?: string;
  artifactId?: string;
  errorClass?: string;
};

const SAFE_ID = /^[\w./:@-]{1,160}$/;

/** Emit allowlisted run metadata only; never pass prompts, tool arguments, or errors. */
export function logExperimentRunEvent(event: ExperimentRunLogEvent): void {
  const safeEvent = Object.fromEntries(
    Object.entries(event).filter(
      ([key, value]) =>
        value !== undefined &&
        (key === "durationMs" || key === "errorClass"
          ? typeof value === "number" || SAFE_ID.test(String(value))
          : SAFE_ID.test(String(value))),
    ),
  );
  logger.info(JSON.stringify({ event: "experiment_2_run", ...safeEvent }));
}

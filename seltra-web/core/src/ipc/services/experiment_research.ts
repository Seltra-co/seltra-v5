import {
  listExperimentArtifacts,
  saveExperimentArtifact,
} from "./experiment_artifact_store";
import type { ExperimentResearchSource } from "@/ipc/types/experiment_artifact";

const MAX_RESEARCH_SOURCES = 32;
const researchWriteTails = new Map<string, Promise<void>>();

async function withResearchWriteLock<T>(
  key: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = researchWriteTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  researchWriteTails.set(key, current);
  await previous;
  try {
    return await write();
  } finally {
    release();
    if (researchWriteTails.get(key) === current) {
      researchWriteTails.delete(key);
    }
  }
}

/**
 * Create a root-turn writer that appends bounded, deduplicated source
 * provenance to the current chat's ResearchArtifact. Callers must only expose
 * this writer in writable Agent/Build turns.
 */
export function createExperimentResearchWriter(params: {
  appId: number;
  appPath: string;
  chatId: number;
  messageId: number;
  runId: string;
  modelId?: string;
}): (sources: ExperimentResearchSource[]) => Promise<void> {
  return async (incoming) => {
    const sources = incoming.slice(0, MAX_RESEARCH_SOURCES);
    if (sources.length === 0) return;
    const lockKey = `${params.appId}:${params.chatId}`;
    await withResearchWriteLock(lockKey, async () => {
      const existing = await listExperimentArtifacts(params);
      const previous = existing.find(
        (artifact) => artifact.kind === "research_artifact",
      );
      const merged = new Map<string, ExperimentResearchSource>();
      if (previous?.kind === "research_artifact") {
        for (const source of previous.content.sources) {
          merged.set(source.url, source);
        }
      }
      for (const source of sources) merged.set(source.url, source);

      await saveExperimentArtifact({
        ...params,
        producer: "dyad-local-agent",
        artifact: {
          kind: "research_artifact",
          status: "needs_review",
          content: {
            sources: [...merged.values()].slice(-MAX_RESEARCH_SOURCES),
          },
        },
      });
    });
  };
}

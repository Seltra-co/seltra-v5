import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import {
  experimentArtifactSchema,
  type ExperimentArtifact,
  type ExperimentArtifactInput,
} from "@/ipc/types/experiment_artifact";

const MAX_ARTIFACT_BYTES = 64 * 1024;
const MAX_EXPERIMENT_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_VERSION_ATTEMPTS = 1_000;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const SENSITIVE_VALUE_PATTERNS = [
  /\b(?:sk|pk)-[A-Za-z0-9]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9+/_=.-]{8,}/i,
];

function artifactDirectory(appPath: string, chatId: number): string {
  return path.join(
    appPath,
    ".dyad",
    "experiment-2",
    "artifacts",
    `chat-${chatId}`,
  );
}

function artifactFileName(kind: string, version: number): string {
  return `${kind}-v${version}.json`;
}

function parseArtifact(text: string): ExperimentArtifact {
  return experimentArtifactSchema.parse(JSON.parse(text));
}

export async function listExperimentArtifacts(params: {
  appId: number;
  appPath: string;
  chatId: number;
}): Promise<ExperimentArtifact[]> {
  const directory = artifactDirectory(params.appPath, params.chatId);
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const latestByKind = new Map<string, { name: string; version: number }>();
  for (const name of names) {
    const match = /^([a-z_]+)-v(\d+)\.json$/.exec(name);
    if (!match) continue;
    const version = Number(match[2]);
    const previous = latestByKind.get(match[1]);
    if (!previous || version > previous.version) {
      latestByKind.set(match[1], { name, version });
    }
  }

  const artifacts = await Promise.all(
    [...latestByKind.values()].map(async ({ name }) =>
      parseArtifact(await fs.readFile(path.join(directory, name), "utf8")),
    ),
  );
  return artifacts
    .filter(
      (artifact) =>
        artifact.appId === params.appId && artifact.chatId === params.chatId,
    )
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.artifactId.localeCompare(b.artifactId),
    );
}

export async function listExperimentArtifactHistory(params: {
  appId: number;
  appPath: string;
  chatId: number;
  kind: ExperimentArtifact["kind"];
}): Promise<ExperimentArtifact[]> {
  const directory = artifactDirectory(params.appPath, params.chatId);
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const matchingNames = names
    .map((name) => ({ name, match: /^([a-z_]+)-v(\d+)\.json$/.exec(name) }))
    .filter(({ match }) => match?.[1] === params.kind)
    .sort((a, b) => Number(a.match![2]) - Number(b.match![2]));
  const artifacts = await Promise.all(
    matchingNames.map(async ({ name }) =>
      parseArtifact(await fs.readFile(path.join(directory, name), "utf8")),
    ),
  );
  return artifacts.filter(
    (artifact) =>
      artifact.appId === params.appId &&
      artifact.chatId === params.chatId &&
      artifact.kind === params.kind,
  );
}

export async function saveExperimentArtifact(params: {
  appId: number;
  appPath: string;
  chatId: number;
  messageId: number;
  runId: string;
  artifact: ExperimentArtifactInput;
  producer?: ExperimentArtifact["producer"];
  modelId?: string;
}): Promise<ExperimentArtifact> {
  if (
    !Number.isSafeInteger(params.appId) ||
    params.appId <= 0 ||
    !Number.isSafeInteger(params.chatId) ||
    params.chatId <= 0 ||
    !Number.isSafeInteger(params.messageId) ||
    params.messageId <= 0
  ) {
    throw new Error(
      "Invalid app, chat, or message identity for artifact storage",
    );
  }
  const contentText = JSON.stringify(params.artifact.content);
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(contentText))) {
    throw new Error(
      "Artifact content appears to contain a credential or private key",
    );
  }

  const directory = artifactDirectory(params.appPath, params.chatId);
  await ensureDyadGitignored(params.appPath);
  await fs.mkdir(directory, { recursive: true });

  for (let version = 1; version <= MAX_VERSION_ATTEMPTS; version += 1) {
    const artifact = experimentArtifactSchema.parse({
      schemaVersion: 1,
      artifactId: randomUUID(),
      runId: params.runId,
      appId: params.appId,
      chatId: params.chatId,
      messageId: params.messageId,
      version,
      createdAt: new Date().toISOString(),
      producer: params.producer ?? "dyad-local-agent",
      ...(params.modelId ? { modelId: params.modelId } : {}),
      ...params.artifact,
    });
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `Experiment artifact exceeds the ${MAX_ARTIFACT_BYTES}-byte limit`,
      );
    }

    const finalPath = path.join(
      directory,
      artifactFileName(artifact.kind, version),
    );
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      // Linking is atomic and refuses to replace an existing version, including
      // when more than one Dyad process writes artifacts for this chat.
      await fs.link(temporaryPath, finalPath);
      return artifact;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }

  throw new Error("Could not allocate a unique Experiment 2 artifact version");
}

/** Persist a screenshot already validated by Dyad's contained test reader. */
export async function saveExperimentScreenshot(params: {
  appPath: string;
  chatId: number;
  pngDataUrl: string;
}): Promise<string> {
  if (!Number.isSafeInteger(params.chatId) || params.chatId <= 0) {
    throw new Error("Invalid chat identity for screenshot storage");
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(
    params.pngDataUrl,
  );
  if (!match) throw new Error("Experiment evidence must be a PNG data URL");
  const bytes = Buffer.from(match[1], "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_EXPERIMENT_SCREENSHOT_BYTES ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("Experiment screenshot is invalid or exceeds 5 MiB");
  }

  const relativePath = path.posix.join(
    ".dyad",
    "experiment-2",
    "screenshots",
    `chat-${params.chatId}`,
    `${randomUUID()}.png`,
  );
  const destination = path.join(params.appPath, ...relativePath.split("/"));
  const directory = path.dirname(destination);
  await ensureDyadGitignored(params.appPath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, bytes, { mode: 0o600 });
  try {
    await fs.link(temporaryPath, destination);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return relativePath;
}

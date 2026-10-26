import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listExperimentArtifacts } from "./experiment_artifact_store";
import { createExperimentResearchWriter } from "./experiment_research";

describe("Experiment 2 research artifact writer", () => {
  let tempRoot: string;
  let appPath: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-research-"));
    appPath = path.join(tempRoot, "app");
    await fs.mkdir(appPath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("merges source provenance by URL without claiming excerpts are verified", async () => {
    const writer = createExperimentResearchWriter({
      appId: 3,
      appPath,
      chatId: 4,
      messageId: 5,
      runId: "research-run",
      modelId: "provider/model",
    });
    const source = {
      url: "https://docs.example.com/api",
      title: "API docs",
      retrievedAt: "2026-10-18T00:00:00.000Z",
      sourceStatements: ["Source supplied statement."],
      verifiedFacts: [],
      designInferences: [],
      confidence: "low" as const,
    };
    await writer([source]);
    await writer([
      {
        ...source,
        title: "Updated API docs",
        retrievedAt: "2026-10-18T01:00:00.000Z",
      },
      {
        ...source,
        url: "https://example.com/other",
        title: "Other docs",
      },
    ]);

    const artifacts = await listExperimentArtifacts({
      appId: 3,
      appPath,
      chatId: 4,
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: "research_artifact",
      status: "needs_review",
      producer: "dyad-local-agent",
      modelId: "provider/model",
      version: 2,
    });
    if (artifacts[0].kind !== "research_artifact") {
      throw new Error("Expected a ResearchArtifact");
    }
    expect(artifacts[0].content.sources).toHaveLength(2);
    expect(artifacts[0].content.sources[0]).toMatchObject({
      url: "https://docs.example.com/api",
      title: "Updated API docs",
      verifiedFacts: [],
    });
  });

  it("preserves concurrent captures from the same app and chat", async () => {
    const writer = createExperimentResearchWriter({
      appId: 3,
      appPath,
      chatId: 4,
      messageId: 5,
      runId: "research-run",
    });
    const source = (url: string) => ({
      url,
      title: "Source",
      retrievedAt: "2026-10-18T00:00:00.000Z",
      sourceStatements: [],
      verifiedFacts: [],
      designInferences: [],
      confidence: "low" as const,
    });
    await Promise.all([
      writer([source("https://example.com/one")]),
      writer([source("https://example.com/two")]),
    ]);

    const [artifact] = await listExperimentArtifacts({
      appId: 3,
      appPath,
      chatId: 4,
    });
    expect(artifact.kind).toBe("research_artifact");
    if (artifact.kind !== "research_artifact") {
      throw new Error("Expected a ResearchArtifact");
    }
    expect(artifact.content.sources.map(({ url }) => url)).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
  });
});

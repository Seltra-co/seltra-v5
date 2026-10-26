import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listExperimentArtifactHistory,
  listExperimentArtifacts,
  saveExperimentArtifact,
  saveExperimentScreenshot,
} from "./experiment_artifact_store";

describe("Experiment 2 artifact storage", () => {
  let tempRoot: string;
  let appPath: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-experiment-artifacts-"),
    );
    appPath = path.join(tempRoot, "app");
    await fs.mkdir(appPath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("versions records by artifact kind under ignored app metadata scoped to app/chat", async () => {
    const params = {
      appId: 7,
      appPath,
      chatId: 11,
      messageId: 13,
      runId: "run-1",
      artifact: {
        kind: "business_brief" as const,
        status: "ready" as const,
        content: {
          business: "A local bakery",
          audience: ["Neighborhood customers"],
          goals: ["Accept pickup orders"],
          entities: ["Products", "Orders"],
          journeys: ["Browse menu and request pickup"],
          constraints: ["Demo checkout only"],
          unknowns: [],
        },
      },
    };

    const first = await saveExperimentArtifact(params);
    const second = await saveExperimentArtifact({ ...params, runId: "run-2" });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.artifactId).not.toBe(first.artifactId);
    const latest = await listExperimentArtifacts({
      appId: 7,
      appPath,
      chatId: 11,
    });
    expect(latest).toHaveLength(1);
    expect(latest[0].version).toBe(2);
    expect(
      await listExperimentArtifactHistory({
        appId: 7,
        appPath,
        chatId: 11,
        kind: "business_brief",
      }),
    ).toEqual([first, second]);
    expect(
      await listExperimentArtifacts({ appId: 7, appPath, chatId: 12 }),
    ).toEqual([]);
    expect(
      await listExperimentArtifacts({ appId: 8, appPath, chatId: 11 }),
    ).toEqual([]);
    expect(
      (
        await fs.readdir(
          path.join(appPath, ".dyad", "experiment-2", "artifacts", "chat-11"),
        )
      ).sort(),
    ).toEqual(["business_brief-v1.json", "business_brief-v2.json"]);
    expect(
      await fs.readFile(path.join(appPath, ".gitignore"), "utf8"),
    ).toContain(".dyad/");
  });

  it("rejects invalid artifact data before writing it", async () => {
    await expect(
      saveExperimentArtifact({
        appId: 7,
        appPath,
        chatId: 11,
        messageId: 13,
        runId: "run-1",
        artifact: {
          kind: "commerce_spec",
          status: "ready",
          content: {
            relevantWorkflows: ["charge_card"],
            acceptanceCriteria: [],
            demoBehaviors: [],
            productionIntegrations: [],
          },
        } as never,
      }),
    ).rejects.toThrow();
    expect(
      await listExperimentArtifacts({ appId: 7, appPath, chatId: 11 }),
    ).toEqual([]);
  });

  it("round-trips host-authored verification evidence", async () => {
    const saved = await saveExperimentArtifact({
      appId: 7,
      appPath,
      chatId: 11,
      messageId: 13,
      runId: "test-run-1",
      producer: "dyad-test-runner",
      artifact: {
        kind: "verification_report",
        status: "needs_review",
        content: {
          status: "needs_review",
          routes: [],
          viewports: [],
          findings: [],
          automatedTests: [
            {
              specPath: "e2e-tests/cart.spec.ts",
              status: "passed",
              total: 2,
              passed: 2,
              failed: 0,
              blocked: 0,
              skipped: 0,
            },
          ],
          limitations: ["Route and viewport evidence is not available."],
        },
      },
    });

    expect(saved.producer).toBe("dyad-test-runner");
    expect(
      await listExperimentArtifacts({ appId: 7, appPath, chatId: 11 }),
    ).toEqual([saved]);
  });

  it("refuses to persist likely credential values", async () => {
    await expect(
      saveExperimentArtifact({
        appId: 7,
        appPath,
        chatId: 11,
        messageId: 13,
        runId: "run-1",
        artifact: {
          kind: "business_brief",
          status: "ready",
          content: {
            business: "A local bakery",
            audience: [],
            goals: [],
            entities: [],
            journeys: [],
            constraints: ["api_key=abcdefghijklmnop123456"],
            unknowns: [],
          },
        },
      }),
    ).rejects.toThrow("credential or private key");
    expect(
      await listExperimentArtifacts({ appId: 7, appPath, chatId: 11 }),
    ).toEqual([]);
  });

  it("stores screenshots under the app's ignored chat-scoped directory", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const screenshotPath = await saveExperimentScreenshot({
      appPath,
      chatId: 11,
      pngDataUrl: `data:image/png;base64,${png.toString("base64")}`,
    });
    expect(screenshotPath).toMatch(
      /^\.dyad\/experiment-2\/screenshots\/chat-11\/.+\.png$/,
    );
    expect(
      await fs.readFile(path.join(appPath, screenshotPath), "binary"),
    ).toBe(png.toString("binary"));
    expect(
      await fs.readFile(path.join(appPath, ".gitignore"), "utf8"),
    ).toContain(".dyad/");
    await expect(
      saveExperimentScreenshot({
        appPath,
        chatId: 11,
        pngDataUrl: "data:image/png;base64,not-a-png",
      }),
    ).rejects.toThrow("PNG");
  });
});

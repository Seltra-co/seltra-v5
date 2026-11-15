import { describe, expect, it } from "vitest";
import {
  ImageGenerationIntentEventSchema,
  ImageGenerationRemoteSnapshotSchema,
  projectImageGenerationRemoteSnapshot,
} from "./transport";
import type { ImageGenerationActorState } from "./state";
import type { RequestId } from "@/distributed_machines/request_identity";

describe("image generation transport", () => {
  it("publishes a safe job-list projection without absolute file paths", () => {
    const state: ImageGenerationActorState = {
      jobs: [
        {
          requestId: "request-1" as RequestId,
          job: {
            id: "job-1",
            prompt: "A lighthouse",
            themeMode: "plain",
            targetAppId: 7,
            targetAppName: "App",
            startedAt: 10,
            status: "success",
            result: {
              fileName: "generated.png",
              filePath: "/secret/absolute/path/generated.png",
              appPath: "app",
              appId: 7,
              appName: "App",
            },
          },
          activeInvocationRef: null,
        },
      ],
    };

    const projection = projectImageGenerationRemoteSnapshot(state, 3);
    expect(ImageGenerationRemoteSnapshotSchema.parse(projection)).toEqual(
      projection,
    );
    expect(projection.jobs[0]?.result).toEqual({
      fileName: "generated.png",
      appId: 7,
      appName: "App",
    });
  });

  it("admits renderer intents and rejects host-only settlement events", () => {
    expect(
      ImageGenerationIntentEventSchema.safeParse({
        type: "CANCEL_REQUESTED",
        jobId: "job-1",
        activeInvocationRef: {
          kind: "image-generation",
          entityKey: "job-1",
          operationId: "operation-1",
        },
      }).success,
    ).toBe(true);
    expect(
      ImageGenerationIntentEventSchema.safeParse({
        type: "JOB_SUCCEEDED",
        jobId: "job-1",
        invocationRef: {
          kind: "image-generation",
          entityKey: "job-1",
          operationId: "operation-1",
        },
        result: {},
      }).success,
    ).toBe(false);
  });

  it("accepts semantic asset slots while rejecting path-like values", () => {
    const base = {
      type: "SUBMIT" as const,
      requestId: "request-asset",
      operationId: "operation-asset",
      job: {
        id: "job-asset",
        startedAt: 10,
        prompt: "Premium editorial product photography",
        themeMode: "real-photography" as const,
        targetAppId: 7,
        targetAppName: "Atelier Noor",
        source: "chat" as const,
      },
    };
    expect(ImageGenerationIntentEventSchema.safeParse({
      ...base,
      job: { ...base.job, assetSlot: "best-sellers" },
    }).success).toBe(true);
    expect(ImageGenerationIntentEventSchema.safeParse({
      ...base,
      job: { ...base.job, assetSlot: "../hero" },
    }).success).toBe(false);
  });
});

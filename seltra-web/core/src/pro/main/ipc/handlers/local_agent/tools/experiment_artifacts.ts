import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  listExperimentArtifactHistory,
  listExperimentArtifacts,
  saveExperimentArtifact,
} from "@/ipc/services/experiment_artifact_store";
import {
  experimentArtifactInputSchema,
  type ExperimentArtifact,
  type ExperimentArtifactInput,
} from "@/ipc/types/experiment_artifact";
import { logExperimentRunEvent } from "@/ipc/services/experiment_run_log";
import {
  getReadyImplementationTaskBatch,
  validateImplementationPlanProgress,
} from "@/ipc/services/experiment_task_graph";
import { aggregateExperimentDesignScores } from "@/ipc/services/experiment_design_score";
import { AgentContext, escapeXmlAttr, ToolDefinition } from "./types";

const agentArtifactInputSchema = experimentArtifactInputSchema.superRefine(
  (artifact, ctx) => {
    if (
      artifact.kind === "verification_report" &&
      artifact.content.status === "passed"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "status"],
        message:
          "The agent cannot mark verification passed without host-verified browser evidence",
      });
    }
    if (
      artifact.kind === "verification_report" &&
      artifact.content.attachedScreenshotPaths !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "attachedScreenshotPaths"],
        message:
          "Only Dyad's host test runner may record attached screenshot paths",
      });
    }
    if (artifact.kind === "design_spec" && !artifact.content.routes?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "routes"],
        message:
          "A new DesignSpec must include its required application routes",
      });
    }
    if (artifact.kind === "visual_critique") {
      artifact.content.reviews.forEach((review, index) => {
        if (!review.scores || review.scores.length !== 8) {
          ctx.addIssue({
            code: "custom",
            path: ["content", "reviews", index, "scores"],
            message:
              "Every screenshot review must score all eight visual dimensions",
          });
        }
      });
    }
  },
);

const writeArtifactsSchema = z.object({
  artifacts: z.array(agentArtifactInputSchema).min(1).max(8),
});

const readArtifactsSchema = z.object({
  kinds: z
    .array(
      z.enum([
        "business_brief",
        "requirements_spec",
        "implementation_plan",
        "design_spec",
        "commerce_spec",
        "content_asset_plan",
        "verification_report",
        "repair_plan",
        "visual_critique",
        "research_artifact",
        "design_reference",
      ]),
    )
    .max(10)
    .optional(),
});

const orchestrationEnabled = () =>
  process.env.SELTRA_ORCHESTRATION_ENABLED === "1";
const MAX_ARTIFACT_READ_BYTES = 80 * 1024;

export const writeExperimentArtifactsTool: ToolDefinition<
  z.infer<typeof writeArtifactsSchema>
> = {
  name: "write_experiment_artifacts",
  description: `Persist concise, typed Experiment 2 planning, design, commerce, research, and verification artifacts for the current app and chat. Use before implementation for complex/new app requests to save the BusinessBrief, RequirementsSpec, ImplementationPlan, and (when presentation matters) DesignSpec; include CommerceSpec only when relevant. New DesignSpecs require path-only route coverage. The host validates ImplementationPlan status changes, dependency readiness, two-attempt maximum, completion evidence, and overlapping active writer scopes. If the user supplies a Figma URL and has authorized using it, use available Figma MCP tools to inspect it and save a concise design_reference before the DesignSpec; record only retrieved structure/tokens/assets and note unavailable details as limitations. Do not claim a Figma import succeeded if no Figma tool returned its data. Update RequirementsSpec, VerificationReport, and RepairPlan only when there is real implementation or browser evidence. New visual critiques must score each attached screenshot across eight dimensions with evidence; aggregate scores do not grant human or host approval. A RepairPlan must name the latest visual critique's artifactId as basisCritiqueId and may not expand a previously saved iteration cap for that critique. A visual_critique must review exactly the screenshots in Dyad's latest host-authored VerificationReport attachedScreenshotPaths; create a new critique only after Dyad attaches fresh screenshots. Never include credentials, attachment contents, or unsupported success claims. Only Dyad's host test runner records attached screenshot paths. These records are versioned private Dyad metadata under the app's ignored .dyad directory. This tool is available only when SELTRA_ORCHESTRATION_ENABLED is enabled.`,
  inputSchema: writeArtifactsSchema,
  defaultConsent: "always",
  modifiesState: true,
  requiresBlueprintApproval: false,
  isEnabled: (ctx) =>
    orchestrationEnabled() && !ctx.mutationActivityOwner?.persona,
  getConsentPreview: (args) => {
    const count = args.artifacts?.length ?? 0;
    return `Save ${count} Experiment 2 artifact${count === 1 ? "" : "s"}`;
  },
  buildXml: (args, isComplete) =>
    `<dyad-experiment-artifacts count="${args.artifacts?.length ?? 0}" complete="${isComplete}"></dyad-experiment-artifacts>`,
  execute: async (args, ctx: AgentContext) => {
    const saved = [];
    for (const artifact of args.artifacts as ExperimentArtifactInput[]) {
      if (artifact.kind === "implementation_plan") {
        const planHistory = await listExperimentArtifactHistory({
          appId: ctx.appId,
          appPath: ctx.appPath,
          chatId: ctx.chatId,
          kind: "implementation_plan",
        });
        const previousPlan = planHistory.at(-1);
        const errors = validateImplementationPlanProgress(
          previousPlan?.kind === "implementation_plan"
            ? previousPlan.content.tasks
            : undefined,
          artifact.content.tasks,
        );
        if (errors.length > 0) {
          throw new DyadError(
            `Implementation plan rejected: ${errors.join(" ")}`,
            DyadErrorKind.Validation,
          );
        }
      }
      if (
        artifact.kind === "verification_report" &&
        artifact.content.status === "passed"
      ) {
        throw new DyadError(
          "Agent-authored verification reports cannot be marked passed without host-verified browser evidence.",
          DyadErrorKind.Validation,
        );
      }
      if (artifact.kind === "visual_critique") {
        const reports = await listExperimentArtifactHistory({
          appId: ctx.appId,
          appPath: ctx.appPath,
          chatId: ctx.chatId,
          kind: "verification_report",
        });
        const latestHostReport = reports
          .filter((report) => report.producer === "dyad-test-runner")
          .sort((a, b) => b.version - a.version)[0];
        const attached =
          latestHostReport?.kind === "verification_report"
            ? (latestHostReport.content.attachedScreenshotPaths ?? [])
            : [];
        const reviewed = artifact.content.reviews.map(
          (review) => review.screenshotPath,
        );
        if (
          attached.length === 0 ||
          new Set(attached).size !== attached.length ||
          new Set(reviewed).size !== reviewed.length ||
          attached.length !== reviewed.length ||
          attached.some((screenshotPath) => !reviewed.includes(screenshotPath))
        ) {
          throw new DyadError(
            "A visual critique must review exactly the unique screenshots attached by Dyad in its latest host VerificationReport.",
            DyadErrorKind.Validation,
          );
        }
        const critiques = await listExperimentArtifactHistory({
          appId: ctx.appId,
          appPath: ctx.appPath,
          chatId: ctx.chatId,
          kind: "visual_critique",
        });
        const screenshotKey = [...reviewed].sort().join("\n");
        if (
          critiques.some(
            (critique) =>
              critique.kind === "visual_critique" &&
              [...critique.content.reviews]
                .map((review) => review.screenshotPath)
                .sort()
                .join("\n") === screenshotKey,
          )
        ) {
          throw new DyadError(
            "This screenshot set already has a visual critique. Run Dyad browser tests and use the newly attached screenshots for another critique.",
            DyadErrorKind.Validation,
          );
        }
      }
      if (artifact.kind === "repair_plan") {
        const critiques = await listExperimentArtifactHistory({
          appId: ctx.appId,
          appPath: ctx.appPath,
          chatId: ctx.chatId,
          kind: "visual_critique",
        });
        const latestCritique = critiques.sort(
          (a, b) => b.version - a.version,
        )[0];
        if (
          latestCritique?.kind !== "visual_critique" ||
          artifact.content.basisCritiqueId !== latestCritique.artifactId
        ) {
          throw new DyadError(
            "A RepairPlan must reference the latest saved visual critique artifactId as basisCritiqueId.",
            DyadErrorKind.Validation,
          );
        }
        const existingPlans = await listExperimentArtifactHistory({
          appId: ctx.appId,
          appPath: ctx.appPath,
          chatId: ctx.chatId,
          kind: "repair_plan",
        });
        const previousCap = Math.min(
          ...existingPlans
            .filter(
              (plan) =>
                plan.kind === "repair_plan" &&
                plan.content.basisCritiqueId === latestCritique.artifactId,
            )
            .map((plan) =>
              plan.kind === "repair_plan" ? plan.content.maxIterations : 3,
            ),
          3,
        );
        if (artifact.content.maxIterations > previousCap) {
          throw new DyadError(
            `A RepairPlan cannot increase this critique's iteration cap above ${previousCap}.`,
            DyadErrorKind.Validation,
          );
        }
      }
      const savedArtifact = await saveExperimentArtifact({
        appId: ctx.appId,
        appPath: ctx.appPath,
        chatId: ctx.chatId,
        messageId: ctx.messageId,
        runId: ctx.dyadRequestId,
        artifact,
        modelId: ctx.inferenceSettings?.selectedModel
          ? `${ctx.inferenceSettings.selectedModel.provider}/${ctx.inferenceSettings.selectedModel.name}`
          : undefined,
      });
      saved.push(savedArtifact);
      logExperimentRunEvent({
        runId: ctx.dyadRequestId,
        phase: "artifact_persistence",
        agent: "dyad-local-agent",
        modelId: ctx.inferenceSettings?.selectedModel
          ? `${ctx.inferenceSettings.selectedModel.provider}/${ctx.inferenceSettings.selectedModel.name}`
          : undefined,
        artifactId: savedArtifact.artifactId,
        toolOutcome: "artifact_saved",
      });
    }
    const savedPlan = saved.find(
      (artifact) => artifact.kind === "implementation_plan",
    );
    const readyTasks =
      savedPlan?.kind === "implementation_plan"
        ? getReadyImplementationTaskBatch(savedPlan.content.tasks)
        : [];
    const readySummary =
      readyTasks.length > 0
        ? ` Dependency-ready tasks that can proceed without overlapping writer scopes: ${readyTasks.map((task) => task.id).join(", ")}.`
        : " No dependency-ready implementation tasks are available yet.";
    const savedCritique = saved.find(
      (artifact) => artifact.kind === "visual_critique",
    );
    const scoreSummary =
      savedCritique?.kind === "visual_critique"
        ? aggregateExperimentDesignScores(savedCritique.content.reviews)
        : undefined;
    const scoreText = scoreSummary?.complete
      ? ` Screenshot scorecard average: ${scoreSummary.overall}/5 across ${scoreSummary.screenshotCount} screenshot(s); this remains model-authored and needs human review.`
      : "";
    return `Saved ${saved.map((artifact) => `${escapeXmlAttr(artifact.kind)} v${artifact.version} (artifactId ${artifact.artifactId})`).join(", ")}.${savedPlan ? readySummary : ""}${scoreText}`;
  },
};

export const readExperimentArtifactsTool: ToolDefinition<
  z.infer<typeof readArtifactsSchema>
> = {
  name: "read_experiment_artifacts",
  description:
    "Read the latest Experiment 2 artifact records for the current app and chat. Use existing records as source context when continuing a task; never imply an artifact exists unless this tool returns it. Private Dyad metadata only. Available when SELTRA_ORCHESTRATION_ENABLED is enabled.",
  inputSchema: readArtifactsSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: orchestrationEnabled,
  getConsentPreview: (args) =>
    args.kinds?.length
      ? `Read ${args.kinds.join(", ")} artifacts`
      : "Read Experiment 2 artifacts",
  buildXml: (args, isComplete) =>
    `<dyad-experiment-artifact-read${args.kinds ? ` kinds="${escapeXmlAttr(args.kinds.join(","))}"` : ""} complete="${isComplete}"></dyad-experiment-artifact-read>`,
  execute: async (args, ctx: AgentContext) => {
    const artifacts = await listExperimentArtifacts({
      appId: ctx.appId,
      appPath: ctx.appPath,
      chatId: ctx.chatId,
    });
    const kinds = args.kinds ? new Set(args.kinds) : undefined;
    const latestByKind = new Map<string, (typeof artifacts)[number]>();
    for (const artifact of artifacts) {
      if (kinds && !kinds.has(artifact.kind)) continue;
      const previous = latestByKind.get(artifact.kind);
      if (!previous || artifact.version > previous.version) {
        latestByKind.set(artifact.kind, artifact);
      }
    }
    if (latestByKind.size === 0)
      return "No Experiment 2 artifacts are saved for this chat.";
    const selected = [...latestByKind.values()].sort((a, b) =>
      a.kind.localeCompare(b.kind),
    );
    const included: ExperimentArtifact[] = [];
    let serializedBytes = 2;
    for (const artifact of selected) {
      const serialized = JSON.stringify(artifact);
      const bytes = Buffer.byteLength(serialized, "utf8") + 1;
      if (serializedBytes + bytes > MAX_ARTIFACT_READ_BYTES) continue;
      included.push(artifact);
      serializedBytes += bytes;
    }
    const omittedKinds = selected
      .filter((artifact) => !included.includes(artifact))
      .map((artifact) => artifact.kind);
    return JSON.stringify({ artifacts: included, omittedKinds }, null, 2);
  },
};

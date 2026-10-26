import { z } from "zod";

const shortText = z.string().trim().min(1).max(2_000);
const textList = z.array(shortText).max(32);
const artifactStatus = z.enum([
  "draft",
  "ready",
  "blocked",
  "needs_review",
  "failed",
  "cancelled",
  "timed_out",
]);

const implementationTasksSchema = z
  .array(
    z.object({
      id: shortText,
      title: shortText,
      dependsOn: z.array(shortText).max(32),
      writerScope: textList,
      /** Required for a completed task; retained as text for auditability. */
      evidence: shortText.optional(),
      /** Task attempt number. Attempt 2 is the only permitted retry. */
      attempt: z.number().int().min(1).max(2).optional(),
      status: z.enum([
        "pending",
        "in_progress",
        "completed",
        "blocked",
        "failed",
        "timed_out",
        "cancelled",
      ]),
    }),
  )
  .min(1)
  .max(64)
  .superRefine((tasks, ctx) => {
    const taskIds = new Set<string>();
    for (const [index, task] of tasks.entries()) {
      if (taskIds.has(task.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate task id: ${task.id}`,
        });
      }
      taskIds.add(task.id);
    }

    const dependencies = new Map(
      tasks.map((task) => [task.id, task.dependsOn]),
    );
    for (const [index, task] of tasks.entries()) {
      for (const dependency of task.dependsOn) {
        if (!dependencies.has(dependency)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "dependsOn"],
            message: `Unknown task dependency: ${dependency}`,
          });
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const cycle = (dependencies.get(id) ?? []).some((dependency) =>
        dependencies.has(dependency) ? hasCycle(dependency) : false,
      );
      visiting.delete(id);
      visited.add(id);
      return cycle;
    };
    if ([...dependencies.keys()].some(hasCycle)) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Implementation plan dependencies must be acyclic",
      });
    }
  });

export type ExperimentImplementationTask = z.infer<
  typeof implementationTasksSchema
>[number];

export const experimentResearchSourceSchema = z.object({
  url: z.string().url().max(2_000),
  title: shortText,
  retrievedAt: z.string().datetime(),
  /** Text extracted from the source; it is not independently verified. */
  sourceStatements: textList.optional(),
  verifiedFacts: textList,
  designInferences: textList,
  confidence: z.enum(["low", "medium", "high"]),
});
export type ExperimentResearchSource = z.infer<
  typeof experimentResearchSourceSchema
>;

const artifactPayloadSchemas = {
  business_brief: z.object({
    business: shortText,
    audience: textList,
    goals: textList,
    entities: textList,
    journeys: textList,
    constraints: textList,
    unknowns: textList,
  }),
  requirements_spec: z.object({
    criteria: z
      .array(
        z.object({
          id: shortText,
          criterion: shortText,
          status: z.enum([
            "planned",
            "implemented",
            "verified",
            "blocked",
            "not_applicable",
          ]),
          evidence: z.string().trim().max(2_000).optional(),
        }),
      )
      .min(1)
      .max(64)
      .superRefine((criteria, ctx) => {
        criteria.forEach((item, index) => {
          if (item.status === "verified" && !item.evidence?.trim()) {
            ctx.addIssue({
              code: "custom",
              path: [index, "evidence"],
              message: "Verified criteria require evidence",
            });
          }
        });
      }),
  }),
  implementation_plan: z.object({ tasks: implementationTasksSchema }),
  design_spec: z.object({
    brandPositioning: shortText,
    audience: textList,
    emotionalResponse: textList,
    pageHierarchy: textList,
    routes: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(512)
          .regex(/^\/[^?#\s]*$/),
      )
      .min(1)
      .max(64)
      .optional(),
    compositions: textList,
    typography: textList,
    palette: textList,
    spacingAndSurfaces: textList,
    artDirection: textList,
    responsiveBehavior: textList,
    accessibility: textList,
    interactionStates: textList,
    antiPatterns: textList,
    acceptanceCriteria: z.array(shortText).min(1).max(64),
  }),
  commerce_spec: z.object({
    relevantWorkflows: z
      .array(
        z.enum([
          "catalog",
          "variants",
          "inventory",
          "discovery",
          "cart",
          "checkout",
          "orders",
          "returns",
          "shipping",
          "delivery",
          "pickup",
          "booking",
          "merchant_operations",
          "payments",
          "tax",
          "currency",
          "notifications",
        ]),
      )
      .max(17),
    acceptanceCriteria: textList,
    demoBehaviors: textList,
    productionIntegrations: z
      .array(
        z.object({
          name: shortText,
          status: z.enum(["unconfigured", "configured", "verified"]),
          evidence: z.string().trim().max(2_000).optional(),
        }),
      )
      .max(32)
      .superRefine((integrations, ctx) => {
        integrations.forEach((integration, index) => {
          if (
            integration.status === "verified" &&
            !integration.evidence?.trim()
          ) {
            ctx.addIssue({
              code: "custom",
              path: [index, "evidence"],
              message: "Verified production integrations require evidence",
            });
          }
        });
      }),
  }),
  content_asset_plan: z.object({
    pages: textList,
    assets: z
      .array(
        z.object({
          placement: shortText,
          subject: shortText,
          aspectRatio: shortText,
          altText: shortText,
          source: shortText,
          fallback: shortText,
        }),
      )
      .max(64),
  }),
  verification_report: z
    .object({
      status: z.enum([
        "passed",
        "failed",
        "blocked",
        "needs_review",
        "cancelled",
      ]),
      routes: z
        .array(
          z.object({
            path: shortText,
            status: z.enum(["passed", "failed", "blocked", "not_checked"]),
            evidence: textList,
          }),
        )
        .max(64),
      viewports: z
        .array(
          z.object({
            name: shortText,
            route: z.string().trim().min(1).max(2_000).optional(),
            width: z.number().int().positive().max(10_000),
            height: z.number().int().positive().max(10_000),
            status: z.enum(["passed", "failed", "blocked", "not_checked"]),
            screenshotPath: z.string().trim().max(2_000).optional(),
          }),
        )
        .max(32),
      findings: z
        .array(
          z.object({
            severity: z.enum(["low", "medium", "high", "critical"]),
            route: z.string().trim().max(2_000).optional(),
            viewport: z.string().trim().max(128).optional(),
            evidence: shortText,
          }),
        )
        .max(64),
      automatedTests: z
        .array(
          z.object({
            specPath: shortText,
            status: z.enum(["passed", "failed", "blocked"]),
            total: z.number().int().nonnegative(),
            passed: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
            blocked: z.number().int().nonnegative(),
            skipped: z.number().int().nonnegative(),
          }),
        )
        .max(32)
        .optional(),
      attachedScreenshotPaths: z.array(z.string().max(2_000)).max(6).optional(),
      limitations: textList,
    })
    .superRefine((report, ctx) => {
      if (report.status !== "passed") return;
      if (
        report.routes.length === 0 ||
        report.routes.some((route) => route.status !== "passed")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["routes"],
          message: "A passed report requires at least one passing route",
        });
      }
      if (
        report.viewports.length === 0 ||
        report.viewports.some(
          (viewport) =>
            viewport.status !== "passed" || !viewport.screenshotPath,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["viewports"],
          message:
            "A passed report requires passing viewports with screenshots",
        });
      }
      if (
        report.findings.some(
          (finding) =>
            finding.severity === "high" || finding.severity === "critical",
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["findings"],
          message: "High-severity findings prevent a passed report",
        });
      }
    }),
  repair_plan: z.object({
    basisCritiqueId: z.string().uuid(),
    findings: z
      .array(
        z.object({
          severity: z.enum(["low", "medium", "high", "critical"]),
          evidence: shortText,
          target: shortText,
          change: shortText,
          recheck: shortText,
        }),
      )
      .max(64),
    maxIterations: z.number().int().min(0).max(3),
  }),
  visual_critique: z.object({
    reviews: z
      .array(
        z
          .object({
            route: z
              .string()
              .trim()
              .min(1)
              .max(512)
              .regex(/^\/[^?#\s]*$/),
            viewport: z.object({
              width: z.number().int().positive().max(10_000),
              height: z.number().int().positive().max(10_000),
            }),
            screenshotPath: z
              .string()
              .regex(
                /^\.dyad\/experiment-2\/screenshots\/chat-\d+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i,
              ),
            strengths: textList,
            /** Comparable 1–5 evidence scores; optional only for legacy records. */
            scores: z
              .array(
                z.object({
                  dimension: z.enum([
                    "composition",
                    "typography",
                    "brand_coherence",
                    "image_quality",
                    "interaction_clarity",
                    "responsive_adaptation",
                    "accessibility",
                    "page_consistency",
                  ]),
                  score: z.number().min(1).max(5),
                  evidence: shortText,
                }),
              )
              .length(8)
              .optional(),
            findings: z
              .array(
                z.object({
                  severity: z.enum(["low", "medium", "high", "critical"]),
                  criterion: shortText,
                  evidence: shortText,
                  recommendation: shortText,
                }),
              )
              .max(32),
          })
          .superRefine((review, ctx) => {
            if (!review.scores) return;
            const dimensions = review.scores.map((score) => score.dimension);
            if (new Set(dimensions).size !== dimensions.length) {
              ctx.addIssue({
                code: "custom",
                path: ["scores"],
                message:
                  "Visual score dimensions must be unique per screenshot",
              });
            }
          }),
      )
      .min(1)
      .max(12),
    limitations: textList,
  }),
  research_artifact: z.object({
    sources: z.array(experimentResearchSourceSchema).max(32),
  }),
  design_reference: z.object({
    sourceUrl: z
      .string()
      .url()
      .max(2_000)
      .refine((value) => {
        const hostname = new URL(value).hostname.toLowerCase();
        return hostname === "figma.com" || hostname.endsWith(".figma.com");
      }, "Design references must come from a Figma URL"),
    fileName: shortText,
    retrievedAt: z.string().datetime(),
    pages: z
      .array(
        z.object({
          name: shortText,
          nodeId: z.string().trim().max(256).optional(),
          summary: z.string().trim().max(2_000).optional(),
        }),
      )
      .max(64),
    tokens: z
      .array(
        z.object({
          name: shortText,
          value: shortText,
          category: z.enum([
            "color",
            "typography",
            "spacing",
            "effect",
            "other",
          ]),
        }),
      )
      .max(256),
    components: z
      .array(
        z.object({
          name: shortText,
          description: z.string().trim().max(2_000).optional(),
        }),
      )
      .max(256),
    assets: z
      .array(
        z.object({
          name: shortText,
          nodeId: z.string().trim().max(256).optional(),
          description: z.string().trim().max(2_000).optional(),
        }),
      )
      .max(256),
    limitations: textList,
  }),
} as const;

export const experimentArtifactInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("business_brief"),
    status: artifactStatus,
    content: artifactPayloadSchemas.business_brief,
  }),
  z.object({
    kind: z.literal("requirements_spec"),
    status: artifactStatus,
    content: artifactPayloadSchemas.requirements_spec,
  }),
  z.object({
    kind: z.literal("implementation_plan"),
    status: artifactStatus,
    content: artifactPayloadSchemas.implementation_plan,
  }),
  z.object({
    kind: z.literal("design_spec"),
    status: artifactStatus,
    content: artifactPayloadSchemas.design_spec,
  }),
  z.object({
    kind: z.literal("commerce_spec"),
    status: artifactStatus,
    content: artifactPayloadSchemas.commerce_spec,
  }),
  z.object({
    kind: z.literal("content_asset_plan"),
    status: artifactStatus,
    content: artifactPayloadSchemas.content_asset_plan,
  }),
  z.object({
    kind: z.literal("verification_report"),
    status: artifactStatus,
    content: artifactPayloadSchemas.verification_report,
  }),
  z.object({
    kind: z.literal("repair_plan"),
    status: artifactStatus,
    content: artifactPayloadSchemas.repair_plan,
  }),
  z.object({
    kind: z.literal("visual_critique"),
    status: artifactStatus,
    content: artifactPayloadSchemas.visual_critique,
  }),
  z.object({
    kind: z.literal("research_artifact"),
    status: artifactStatus,
    content: artifactPayloadSchemas.research_artifact,
  }),
  z.object({
    kind: z.literal("design_reference"),
    status: artifactStatus,
    content: artifactPayloadSchemas.design_reference,
  }),
]);

export type ExperimentArtifactInput = z.infer<
  typeof experimentArtifactInputSchema
>;

const experimentArtifactMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  artifactId: z.string().uuid(),
  runId: shortText,
  appId: z.number().int().positive(),
  chatId: z.number().int().positive(),
  messageId: z.number().int().positive(),
  version: z.number().int().positive(),
  status: artifactStatus,
  createdAt: z.string().datetime(),
  producer: z.enum(["dyad-local-agent", "dyad-test-runner"]),
  modelId: z.string().trim().max(256).optional(),
});

export const experimentArtifactSchema = z.discriminatedUnion("kind", [
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("business_brief"),
    content: artifactPayloadSchemas.business_brief,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("requirements_spec"),
    content: artifactPayloadSchemas.requirements_spec,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("implementation_plan"),
    content: artifactPayloadSchemas.implementation_plan,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("design_spec"),
    content: artifactPayloadSchemas.design_spec,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("commerce_spec"),
    content: artifactPayloadSchemas.commerce_spec,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("content_asset_plan"),
    content: artifactPayloadSchemas.content_asset_plan,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("verification_report"),
    content: artifactPayloadSchemas.verification_report,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("repair_plan"),
    content: artifactPayloadSchemas.repair_plan,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("visual_critique"),
    content: artifactPayloadSchemas.visual_critique,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("research_artifact"),
    content: artifactPayloadSchemas.research_artifact,
  }),
  experimentArtifactMetadataSchema.extend({
    kind: z.literal("design_reference"),
    content: artifactPayloadSchemas.design_reference,
  }),
]);

export type ExperimentArtifact = z.infer<typeof experimentArtifactSchema>;

import { describe, expect, it } from "vitest";
import { experimentArtifactInputSchema } from "./experiment_artifact";

const artifact = (kind: string, content: unknown) =>
  experimentArtifactInputSchema.safeParse({
    kind,
    status: "ready",
    content,
  });

const task = (id: string, dependsOn: string[] = []) => ({
  id,
  title: `Task ${id}`,
  dependsOn,
  writerScope: [`src/${id}.tsx`],
  status: "pending",
});

describe("Experiment 2 artifact contracts", () => {
  it("accepts an implementation plan with a valid dependency DAG", () => {
    expect(
      artifact("implementation_plan", {
        tasks: [
          task("brief"),
          task("build", ["brief"]),
          task("verify", ["build"]),
        ],
      }).success,
    ).toBe(true);
  });

  it("represents failed, timed-out, and cancelled task outcomes", () => {
    expect(
      artifact("implementation_plan", {
        tasks: [
          { ...task("first"), status: "failed" },
          { ...task("second"), status: "timed_out" },
          { ...task("third"), status: "cancelled" },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    {
      name: "unknown dependencies",
      tasks: [task("build", ["missing"])],
    },
    {
      name: "cycles",
      tasks: [task("design", ["build"]), task("build", ["design"])],
    },
    {
      name: "duplicate task ids",
      tasks: [task("build"), task("build")],
    },
  ])("rejects implementation plans with $name", ({ tasks }) => {
    expect(artifact("implementation_plan", { tasks }).success).toBe(false);
  });

  it("requires evidence before requirements or integrations can be verified", () => {
    expect(
      artifact("requirements_spec", {
        criteria: [
          {
            id: "checkout",
            criterion: "Checkout completes",
            status: "verified",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      artifact("commerce_spec", {
        relevantWorkflows: ["checkout"],
        acceptanceCriteria: [],
        demoBehaviors: [],
        productionIntegrations: [{ name: "Payments", status: "verified" }],
      }).success,
    ).toBe(false);
  });

  it("does not pass a verification report with high-severity defects", () => {
    expect(
      artifact("verification_report", {
        status: "passed",
        routes: [{ path: "/", status: "passed", evidence: ["Loaded"] }],
        viewports: [
          {
            name: "desktop",
            width: 1440,
            height: 900,
            status: "passed",
            screenshotPath: "screenshots/desktop.png",
          },
        ],
        findings: [{ severity: "high", evidence: "Primary CTA is hidden" }],
        limitations: [],
      }).success,
    ).toBe(false);
  });

  it("accepts bounded host test-runner evidence on a non-passing report", () => {
    expect(
      artifact("verification_report", {
        status: "needs_review",
        routes: [],
        viewports: [],
        findings: [],
        automatedTests: [
          {
            specPath: "e2e-tests/cart.spec.ts",
            status: "passed",
            total: 4,
            passed: 4,
            failed: 0,
            blocked: 0,
            skipped: 0,
          },
        ],
        limitations: ["Visual and responsive checks have not run."],
      }).success,
    ).toBe(true);
  });

  it("accepts research provenance while distinguishing source excerpts from verified facts", () => {
    expect(
      artifact("research_artifact", {
        sources: [
          {
            url: "https://docs.example.com/reference",
            title: "Reference docs",
            retrievedAt: "2026-10-18T00:00:00.000Z",
            sourceStatements: ["The source says the API is versioned."],
            verifiedFacts: [],
            designInferences: [],
            confidence: "low",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("accepts normalized Figma design references and rejects unrelated origins", () => {
    const content = {
      sourceUrl: "https://www.figma.com/design/abc123/Store",
      fileName: "Store",
      retrievedAt: "2026-10-18T00:00:00.000Z",
      pages: [{ name: "Product screens", nodeId: "1:2" }],
      tokens: [{ name: "Brand blue", value: "#123456", category: "color" }],
      components: [{ name: "Product card" }],
      assets: [{ name: "Wordmark", nodeId: "2:3" }],
      limitations: ["Only the first page was available."],
    };
    expect(artifact("design_reference", content).success).toBe(true);
    expect(
      artifact("design_reference", {
        ...content,
        sourceUrl: "https://figma.com.attacker.example/design/abc123",
      }).success,
    ).toBe(false);
  });

  it("accepts an evidence-linked visual critique without granting verification status", () => {
    expect(
      artifact("visual_critique", {
        reviews: [
          {
            route: "/products",
            viewport: { width: 390, height: 844 },
            screenshotPath:
              ".dyad/experiment-2/screenshots/chat-12/00000000-0000-4000-8000-000000000000.png",
            strengths: ["Product title remains visible above the fold."],
            findings: [
              {
                severity: "high",
                criterion: "Primary purchase action is easy to find.",
                evidence: "The purchase action is below the visible viewport.",
                recommendation: "Place the purchase action beside the price.",
              },
            ],
          },
        ],
        limitations: ["Only the mobile screenshot was reviewed."],
      }).success,
    ).toBe(true);
    expect(
      artifact("visual_critique", {
        reviews: [
          {
            route: "/products",
            viewport: { width: 390, height: 844 },
            screenshotPath:
              ".dyad/experiment-2/screenshots/chat-12/../private.png",
            strengths: [],
            findings: [],
          },
        ],
        limitations: [],
      }).success,
    ).toBe(false);
  });
});

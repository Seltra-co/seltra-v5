import { describe, expect, it } from "vitest";
import { buildExperimentVerificationArtifact } from "./experiment_verification";
import type { RunAppTestsResult, TestBrowserEvidence } from "@/ipc/types/tests";

const appPath = "C:/apps/example";

function result(patch: Partial<RunAppTestsResult> = {}): RunAppTestsResult {
  return {
    appId: 1,
    results: [
      {
        file: "C:/apps/example/e2e-tests/cart.spec.ts",
        status: "failed",
        tests: [
          { title: "cart accepts a product", status: "passed" },
          { title: "cart rejects an invalid quantity", status: "failed" },
          { title: "checkout infrastructure", status: "inconclusive" },
        ],
      },
    ],
    ...patch,
  };
}

describe("Experiment 2 host verification evidence", () => {
  it("records host test outcomes without claiming visual or route verification", () => {
    const artifact = buildExperimentVerificationArtifact(result(), appPath);
    expect(artifact.kind).toBe("verification_report");
    if (artifact.kind !== "verification_report") throw new Error("wrong kind");
    expect(artifact.status).toBe("failed");
    expect(artifact.content.status).toBe("failed");
    expect(artifact.content.automatedTests).toEqual([
      {
        specPath: "e2e-tests/cart.spec.ts",
        status: "failed",
        total: 3,
        passed: 1,
        failed: 1,
        blocked: 1,
        skipped: 0,
      },
    ]);
    expect(artifact.content.routes).toEqual([]);
    expect(artifact.content.viewports).toEqual([]);
  });

  it("blocks passing functional tests without browser evidence", () => {
    const passing = result({
      results: [
        {
          file: "e2e-tests/home.spec.ts",
          status: "passed",
          tests: [{ title: "home loads", status: "passed" }],
        },
      ],
    });
    const artifact = buildExperimentVerificationArtifact(passing, appPath);
    expect(artifact.status).toBe("blocked");
  });

  it("marks infrastructure, empty, and cancelled runs conservatively", () => {
    expect(
      buildExperimentVerificationArtifact(
        result({ infraError: { message: "browser unavailable" } }),
        appPath,
      ).status,
    ).toBe("blocked");
    expect(
      buildExperimentVerificationArtifact(result({ results: [] }), appPath)
        .status,
    ).toBe("blocked");
    expect(
      buildExperimentVerificationArtifact(result(), appPath, {
        cancelled: true,
      }).status,
    ).toBe("cancelled");
  });

  it("keeps absolute paths outside the app from entering saved evidence", () => {
    const outside = result({
      results: [
        {
          file: "C:/private/other-app/secret.spec.ts",
          status: "passed",
          tests: [{ title: "one", status: "passed" }],
        },
      ],
    });
    const artifact = buildExperimentVerificationArtifact(outside, appPath);
    if (artifact.kind !== "verification_report") throw new Error("wrong kind");
    expect(artifact.content.automatedTests?.[0].specPath).toBe(
      "secret.spec.ts",
    );
  });

  it("records observed route and viewport evidence without claiming visual approval", () => {
    const browserRun = result({
      results: [
        {
          file: "e2e-tests/home.spec.ts",
          status: "passed",
          tests: [
            {
              title: "home route @seltra-visual-evidence",
              status: "passed",
              browserEvidence: {
                pagePath: "/",
                width: 390,
                height: 844,
                screenshotPath:
                  ".dyad/experiment-2/screenshots/chat-2/home.png",
                documentReady: true,
                bodyHasContent: true,
                horizontalOverflow: false,
                brokenImageCount: 0,
                fontsReady: true,
                consoleErrorCount: 0,
                uncaughtErrorCount: 0,
                failedRequestCount: 0,
              },
            },
          ],
        },
      ],
    });
    const artifact = buildExperimentVerificationArtifact(browserRun, appPath, {
      expectedRoutes: ["/", "/cart"],
    });
    expect(artifact.status).toBe("blocked");
    if (artifact.kind !== "verification_report") throw new Error("wrong kind");
    expect(artifact.content.routes).toEqual([
      {
        path: "/",
        status: "passed",
        evidence: ["mobile 390×844: Playwright passed; screenshot captured."],
      },
    ]);
    expect(artifact.content.viewports?.[0]).toMatchObject({
      route: "/",
      width: 390,
      height: 844,
      status: "passed",
    });
    expect(artifact.content.limitations).toContain(
      "Missing visual evidence for required routes: /cart.",
    );
  });

  it("keeps complete route and viewport evidence at needs_review pending visual review", () => {
    const viewports = [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ];
    const browserRun = result({
      results: [
        {
          file: "e2e-tests/home.spec.ts",
          status: "passed",
          tests: viewports.map(({ width, height }, index) => ({
            title: `home viewport ${index} @seltra-visual-evidence`,
            status: "passed" as const,
            browserEvidence: {
              pagePath: "/",
              width,
              height,
              screenshotPath: `.dyad/experiment-2/screenshots/chat-2/${width}.png`,
              documentReady: true,
              bodyHasContent: true,
              horizontalOverflow: false,
              brokenImageCount: 0,
              fontsReady: true,
              consoleErrorCount: 0,
              uncaughtErrorCount: 0,
              failedRequestCount: 0,
            },
          })),
        },
      ],
    });

    const artifact = buildExperimentVerificationArtifact(browserRun, appPath, {
      expectedRoutes: ["/"],
    });
    expect(artifact.status).toBe("needs_review");
  });

  it("marks objective browser layout failures in the report", () => {
    const artifact = buildExperimentVerificationArtifact(
      result({
        results: [
          {
            file: "e2e-tests/home.spec.ts",
            status: "passed",
            tests: [
              {
                title: "home at desktop",
                status: "passed",
                browserEvidence: {
                  pagePath: "/",
                  width: 1440,
                  height: 900,
                  screenshotPath:
                    ".dyad/experiment-2/screenshots/chat-2/home.png",
                  documentReady: true,
                  bodyHasContent: true,
                  horizontalOverflow: true,
                  brokenImageCount: 0,
                  fontsReady: true,
                  consoleErrorCount: 0,
                  uncaughtErrorCount: 0,
                  failedRequestCount: 0,
                },
              },
            ],
          },
        ],
      }),
      appPath,
    );
    expect(artifact.status).toBe("failed");
  });

  it.each([
    ["document readiness", { documentReady: false }, "critical", "failed"],
    ["empty page", { bodyHasContent: false }, "critical", "failed"],
    ["horizontal overflow", { horizontalOverflow: true }, "high", "failed"],
    ["broken images", { brokenImageCount: 1 }, "high", "failed"],
    ["uncaught errors", { uncaughtErrorCount: 1 }, "high", "failed"],
    ["missing fonts", { fontsReady: false }, "medium", "needs_review"],
    ["console errors", { consoleErrorCount: 1 }, "medium", "needs_review"],
    ["failed requests", { failedRequestCount: 1 }, "medium", "needs_review"],
  ] as const)(
    "records %s with the expected severity and report status",
    (_name, evidencePatch, severity, expectedStatus) => {
      const viewports = [
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1440, height: 900 },
      ];
      const browserRun = result({
        results: [
          {
            file: "e2e-tests/home.spec.ts",
            status: "passed",
            tests: viewports.map(({ width, height }, index) => ({
              title: `home viewport ${index} @seltra-visual-evidence`,
              status: "passed" as const,
              browserEvidence: {
                pagePath: "/",
                width,
                height,
                screenshotPath: `.dyad/experiment-2/screenshots/chat-2/${width}.png`,
                documentReady: true,
                bodyHasContent: true,
                horizontalOverflow: false,
                brokenImageCount: 0,
                fontsReady: true,
                consoleErrorCount: 0,
                uncaughtErrorCount: 0,
                failedRequestCount: 0,
                ...(index === 0
                  ? (evidencePatch satisfies Partial<TestBrowserEvidence>)
                  : {}),
              },
            })),
          },
        ],
      });

      const artifact = buildExperimentVerificationArtifact(
        browserRun,
        appPath,
        { expectedRoutes: ["/"] },
      );

      expect(artifact.status).toBe(expectedStatus);
      if (artifact.kind !== "verification_report") {
        throw new Error("wrong kind");
      }
      expect(artifact.content.findings).toContainEqual(
        expect.objectContaining({ severity }),
      );
    },
  );
});

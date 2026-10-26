import path from "node:path";
import type { RunAppTestsResult, TestBrowserEvidence } from "@/ipc/types/tests";
import type { ExperimentArtifactInput } from "@/ipc/types/experiment_artifact";
import { readTestScreenshotDataUrl } from "@/ipc/utils/test_screenshot";
import { saveExperimentScreenshot } from "./experiment_artifact_store";

const MAX_SAVED_BROWSER_SCREENSHOTS = 12;

export interface PersistedBrowserScreenshot {
  pagePath: string;
  width: number;
  height: number;
  screenshotPath: string;
  dataUrl: string;
}

function appRelativeSpecPath(specPath: string, appPath: string): string {
  const normalized = path.isAbsolute(specPath)
    ? path.relative(appPath, specPath)
    : specPath;
  const posix = normalized.replaceAll("\\", "/");
  return posix && !posix.startsWith("../") && posix !== ".."
    ? posix
    : path.basename(specPath);
}

/**
 * Keep only screenshots that pass Dyad's app/run containment and PNG checks,
 * then copy them into the app's private, git-ignored Experiment 2 directory.
 */
export async function persistExperimentBrowserScreenshots(
  result: RunAppTestsResult,
  params: { appId: number; appPath: string; chatId: number },
): Promise<{
  result: RunAppTestsResult;
  screenshots: PersistedBrowserScreenshot[];
}> {
  const screenshots: PersistedBrowserScreenshot[] = [];
  const persistedResult: RunAppTestsResult = {
    ...result,
    results: result.results.map((file) => ({
      ...file,
      tests: file.tests?.map((test) => ({ ...test })),
    })),
  };

  for (const file of persistedResult.results) {
    for (const test of file.tests ?? []) {
      const evidence = test.browserEvidence;
      if (!evidence) continue;
      if (screenshots.length >= MAX_SAVED_BROWSER_SCREENSHOTS) {
        test.browserEvidence = undefined;
        continue;
      }
      const dataUrl = await readTestScreenshotDataUrl(
        params.appPath,
        evidence.screenshotPath,
        params.appId,
      );
      if (!dataUrl) {
        test.browserEvidence = undefined;
        continue;
      }
      const screenshotPath = await saveExperimentScreenshot({
        appPath: params.appPath,
        chatId: params.chatId,
        pngDataUrl: dataUrl,
      });
      test.browserEvidence = { ...evidence, screenshotPath };
      screenshots.push({
        pagePath: evidence.pagePath,
        width: evidence.width,
        height: evidence.height,
        screenshotPath,
        dataUrl,
      });
    }
  }

  return { result: persistedResult, screenshots };
}

function viewportName(evidence: TestBrowserEvidence): string {
  const device =
    evidence.width <= 480
      ? "mobile"
      : evidence.width <= 1024
        ? "tablet"
        : "desktop";
  return `${device} ${evidence.width}×${evidence.height}`;
}

function evidenceFindings(evidence: TestBrowserEvidence) {
  const findings: {
    severity: "low" | "medium" | "high" | "critical";
    route: string;
    viewport: string;
    evidence: string;
  }[] = [];
  const viewport = viewportName(evidence);
  const add = (
    severity: "low" | "medium" | "high" | "critical",
    issue: string,
  ) =>
    findings.push({
      severity,
      route: evidence.pagePath,
      viewport,
      evidence: issue,
    });

  if (!evidence.documentReady)
    add("critical", "Document did not reach ready state.");
  if (!evidence.bodyHasContent) add("critical", "Page body appears empty.");
  if (evidence.horizontalOverflow)
    add("high", "Document has horizontal overflow at this viewport.");
  if (evidence.brokenImageCount > 0)
    add(
      "high",
      `${evidence.brokenImageCount} image(s) were incomplete or failed to load.`,
    );
  if (evidence.uncaughtErrorCount > 0)
    add(
      "high",
      `${evidence.uncaughtErrorCount} uncaught browser error(s) occurred.`,
    );
  if (!evidence.fontsReady)
    add("medium", "Document fonts were not ready at capture time.");
  if (evidence.consoleErrorCount > 0)
    add("medium", `${evidence.consoleErrorCount} console error(s) occurred.`);
  if (evidence.failedRequestCount > 0)
    add("medium", `${evidence.failedRequestCount} browser request(s) failed.`);
  return findings;
}

/**
 * Convert host-parsed Playwright and browser measurements into an Experiment 2
 * report. This collector never declares visual success: screenshots still need
 * a visual review and route coverage needs comparison with the DesignSpec.
 */
export function buildExperimentVerificationArtifact(
  result: RunAppTestsResult,
  appPath: string,
  options: {
    cancelled?: boolean;
    expectedRoutes?: string[];
    attachedScreenshotPaths?: string[];
  } = {},
): ExperimentArtifactInput {
  const automatedTests = result.results.slice(0, 32).map((fileResult) => {
    const tests = fileResult.tests ?? [];
    const passed = tests.filter((test) => test.status === "passed").length;
    const failed = tests.filter((test) => test.status === "failed").length;
    const blocked = tests.filter(
      (test) => test.status === "inconclusive",
    ).length;
    const skipped = tests.length - passed - failed - blocked;
    const status =
      fileResult.status === "failed" || failed > 0
        ? "failed"
        : fileResult.status === "passed" && blocked === 0
          ? "passed"
          : "blocked";

    return {
      specPath: appRelativeSpecPath(fileResult.file, appPath),
      status,
      total: tests.length,
      passed,
      failed,
      blocked,
      skipped,
    } as const;
  });

  const evidenceCases = result.results.flatMap((file) =>
    (file.tests ?? [])
      .filter((test) => test.browserEvidence)
      .map((test) => ({
        test,
        evidence: test.browserEvidence!,
        testStatus: test.status,
      })),
  );
  const findings = evidenceCases.flatMap(({ evidence }) =>
    evidenceFindings(evidence),
  );
  const viewportEntries = new Map<
    string,
    {
      name: string;
      route: string;
      width: number;
      height: number;
      status: "passed" | "failed" | "blocked" | "not_checked";
      screenshotPath: string;
    }
  >();
  const routeStatuses = new Map<
    string,
    { failed: boolean; blocked: boolean; evidence: Set<string> }
  >();

  for (const { evidence, testStatus } of evidenceCases) {
    const objectiveFailure = evidenceFindings(evidence).some(
      (finding) =>
        finding.severity === "high" || finding.severity === "critical",
    );
    const captureFailed = !evidence.screenshotPath.startsWith(
      ".dyad/experiment-2/screenshots/",
    );
    const status =
      testStatus !== "passed" || objectiveFailure || captureFailed
        ? testStatus === "inconclusive" || captureFailed
          ? "blocked"
          : "failed"
        : "passed";
    const key = `${evidence.pagePath}\0${evidence.width}x${evidence.height}`;
    const previous = viewportEntries.get(key);
    if (!previous || (previous.status === "passed" && status !== "passed")) {
      viewportEntries.set(key, {
        name: viewportName(evidence),
        route: evidence.pagePath,
        width: evidence.width,
        height: evidence.height,
        status,
        screenshotPath: evidence.screenshotPath,
      });
    }
    const route = routeStatuses.get(evidence.pagePath) ?? {
      failed: false,
      blocked: false,
      evidence: new Set<string>(),
    };
    route.failed ||= status === "failed";
    route.blocked ||= status === "blocked";
    route.evidence.add(
      `${viewportName(evidence)}: Playwright ${testStatus}; screenshot ${captureFailed ? "missing" : "captured"}.`,
    );
    routeStatuses.set(evidence.pagePath, route);
  }

  const routes = [...routeStatuses.entries()].map(([route, state]) => ({
    path: route,
    status: state.failed
      ? ("failed" as const)
      : state.blocked
        ? ("blocked" as const)
        : ("passed" as const),
    evidence: [...state.evidence].slice(0, 16),
  }));
  const viewports = [...viewportEntries.values()].slice(0, 32);
  const hasFailure =
    automatedTests.some((test) => test.status === "failed") ||
    result.results.some((file) => file.status === "failed") ||
    findings.some(
      (finding) =>
        finding.severity === "high" || finding.severity === "critical",
    );
  const hasBlocked =
    Boolean(result.infraError) ||
    result.results.length === 0 ||
    result.results.some((file) => file.status === "inconclusive") ||
    viewports.some((viewport) => viewport.status === "blocked") ||
    routes.some((route) => route.status === "blocked");
  const observedRoutes = new Set(routes.map((route) => route.path));
  const expectedRoutes = options.expectedRoutes ?? [];
  const missingRoutes = expectedRoutes.filter(
    (route) => !observedRoutes.has(route),
  );
  const viewportClasses = new Set(
    viewports.map((viewport) =>
      viewport.width <= 480
        ? "mobile"
        : viewport.width <= 1024
          ? "tablet"
          : "desktop",
    ),
  );
  const allViewportClasses = ["mobile", "tablet", "desktop"] as const;
  const missingViewportClasses = allViewportClasses.filter(
    (name) => !viewportClasses.has(name),
  );
  const incompleteCoverage =
    evidenceCases.length === 0 ||
    missingRoutes.length > 0 ||
    missingViewportClasses.length > 0;
  const status = options.cancelled
    ? "cancelled"
    : hasBlocked
      ? "blocked"
      : hasFailure
        ? "failed"
        : incompleteCoverage
          ? "blocked"
          : "needs_review";

  return {
    kind: "verification_report",
    status,
    content: {
      status,
      routes,
      viewports,
      findings: findings.slice(0, 64),
      automatedTests,
      ...(options.attachedScreenshotPaths
        ? { attachedScreenshotPaths: options.attachedScreenshotPaths }
        : {}),
      limitations: [
        "Screenshots and browser measurements are host-collected. A visual critic has not been host-verified, so this report does not claim visual quality passed.",
        ...(expectedRoutes.length === 0
          ? [
              "No DesignSpec route inventory was available to establish expected route coverage.",
            ]
          : missingRoutes.length > 0
            ? [
                `Missing visual evidence for required routes: ${missingRoutes.join(", ")}.`,
              ]
            : []),
        ...(missingViewportClasses.length > 0
          ? [
              "One or more of mobile, tablet, and desktop viewport classes were not captured.",
            ]
          : []),
        ...(result.results.length > 32
          ? [
              `${result.results.length - 32} additional spec results were omitted from this bounded artifact.`,
            ]
          : []),
      ],
    },
  };
}

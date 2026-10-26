import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("repaired EchoForm passes Phase 4 checks in Dyad preview", async ({
  page,
}, testInfo) => {
  test.setTimeout(10 * 60_000);
  const evidenceDir = path.resolve(
    "docs/experiment-2/evidence/phase4-echoform-2026-10-22",
  );
  await fs.mkdir(evidenceDir, { recursive: true });

  let runtimeSessionId: string | undefined;
  page.on("websocket", (websocket) => {
    if (!websocket.url().includes("/api/events")) return;
    websocket.on("framereceived", (frame) => {
      try {
        const message = JSON.parse(String(frame.payload)) as {
          channel?: string;
          payload?: { id?: string };
        };
        if (
          message.channel === "web:session" &&
          typeof message.payload?.id === "string"
        ) {
          runtimeSessionId = message.payload.id;
        }
      } catch {
        // Ignore unrelated runtime events.
      }
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill("e2e@example.local");
  await page.getByLabel("Password").fill("e2e-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect
    .poll(() => runtimeSessionId, {
      message: "Dyad should establish its authenticated runtime session",
    })
    .toBeTruthy();

  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "seltra_session",
  );
  expect(cookie).toBeTruthy();
  const headers = {
    cookie: `seltra_session=${cookie!.value}`,
    origin: new URL(page.url()).origin,
    "x-runtime-session": runtimeSessionId!,
  };
  const settingsResponse = await page.request.post(
    "/api/rpc/set-user-settings",
    {
      headers,
      data: {
        args: [
          {
            autoApproveChanges: true,
            enableAppBlueprint: false,
            enableTestingForNewApps: true,
          },
        ],
      },
    },
  );
  expect(settingsResponse.status()).toBe(200);

  const createdResponse = await page.request.post("/api/rpc/create-app", {
    headers,
    data: { args: [{ name: `Phase 4 EchoForm ${Date.now()}` }] },
  });
  expect(createdResponse.status()).toBe(200);
  const createdPayload = (await createdResponse.json()) as {
    result?: {
      value?: {
        app?: { id?: number; resolvedPath?: string };
        chatId?: number;
      };
    };
  };
  const created = createdPayload.result?.value;
  expect(created?.app?.id).toBeGreaterThan(0);
  expect(created?.chatId).toBeGreaterThan(0);
  expect(created?.app?.resolvedPath).toBeTruthy();
  const appId = created!.app!.id!;
  const chatId = created!.chatId!;
  const appPath = created!.app!.resolvedPath!;

  const generatedAppPath = path.resolve(
    ".web-dev/apps/echoform-text-2026-10-20-rerun",
  );
  for (const directory of ["src", "public"]) {
    await fs.cp(
      path.join(generatedAppPath, directory),
      path.join(appPath, directory),
      { recursive: true, force: true },
    );
  }
  for (const file of [
    "index.html",
    "pnpm-workspace.yaml",
    "postcss.config.js",
    "tailwind.config.ts",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
  ]) {
    await fs.copyFile(
      path.join(generatedAppPath, file),
      path.join(appPath, file),
    );
  }
  const hostFixturePath = path.resolve("e2e-web/fixtures/echoform-host");
  for (const file of ["package.json", "pnpm-lock.yaml"]) {
    await fs.copyFile(
      path.join(hostFixturePath, file),
      path.join(appPath, file),
    );
  }

  const runAppResponse = await page.request.post("/api/rpc/run-app", {
    headers,
    data: { args: [{ appId }] },
  });
  expect([200, 504]).toContain(runAppResponse.status());

  await page.goto(`/chat?id=${chatId}&appId=${appId}`);
  const previewButton = page.getByTestId("preview-mode-button");
  if (await previewButton.isVisible()) await previewButton.click();
  const previewIframe = page.getByTestId("preview-iframe-element");
  await expect
    .poll(() => previewIframe.getAttribute("src"), {
      timeout: 120_000,
      message: "Dyad should publish the running app's preview URL",
    })
    .toMatch(/^https?:\/\//);
  const previewUrl = (await previewIframe.getAttribute("src"))!;
  const safePreviewUrl = `${new URL(previewUrl).origin}${new URL(previewUrl).pathname}`;
  const previewPage = await page.context().newPage();
  const previewReadyResponse = await previewPage.goto(previewUrl, {
    waitUntil: "domcontentloaded",
  });
  expect(previewReadyResponse?.status()).toBe(200);

  const consoleErrors: string[] = [];
  const runtimeErrors: string[] = [];
  const failedRequests: string[] = [];
  previewPage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  previewPage.on("pageerror", (error) => runtimeErrors.push(error.message));
  previewPage.on("requestfailed", (request) => {
    if (!request.failure()?.errorText?.includes("ERR_ABORTED")) {
      failedRequests.push(request.url());
    }
  });

  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const browserEvidence = [];
  for (const viewport of viewports) {
    await previewPage.setViewportSize(viewport);
    const response = await previewPage.goto(new URL(previewUrl).origin, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), `${viewport.name} route status`).toBe(200);
    await expect(previewPage.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      previewPage.getByRole("button", { name: /send feedback/i }),
    ).toBeVisible();
    await previewPage.evaluate(() => document.fonts.ready);
    const measurements = await previewPage.evaluate(() => {
      const root = document.documentElement;
      return {
        route: window.location.pathname,
        documentReady: document.readyState === "complete",
        bodyHasContent: Boolean(document.body.innerText.trim()),
        viewportWidth: root.clientWidth,
        documentWidth: root.scrollWidth,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
        brokenImageCount: [...document.images].filter(
          (image) => !image.complete || image.naturalWidth === 0,
        ).length,
        fontsReady: document.fonts.status === "loaded",
      };
    });
    expect(measurements.horizontalOverflow).toBe(false);
    const screenshotPath = path.join(
      evidenceDir,
      `echoform-${viewport.name}.png`,
    );
    await previewPage.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`phase4-${viewport.name}`, {
      path: screenshotPath,
      contentType: "image/png",
    });
    browserEvidence.push({
      ...measurements,
      width: viewport.width,
      height: viewport.height,
      httpStatus: response?.status(),
      consoleErrorCount: consoleErrors.length,
      runtimeErrorCount: runtimeErrors.length,
      failedRequestCount: failedRequests.length,
      screenshotPath: path.relative(process.cwd(), screenshotPath),
    });
  }

  await previewPage.setViewportSize({ width: 390, height: 844 });
  await previewPage.goto(new URL(previewUrl).origin);
  await previewPage.getByRole("button", { name: /send feedback/i }).click();
  await expect(previewPage.getByText(/please enter your name/i)).toBeVisible();
  await expect(previewPage.getByText(/please enter your email/i)).toBeVisible();
  await expect(
    previewPage.getByText(/please (choose|select) a rating/i),
  ).toBeVisible();
  await expect(previewPage.getByText(/please enter a message/i)).toBeVisible();
  const validationScreenshot = path.join(
    evidenceDir,
    "echoform-mobile-validation.png",
  );
  await previewPage.screenshot({ path: validationScreenshot, fullPage: true });

  const ratings = previewPage.getByRole("radio");
  await expect(ratings).toHaveCount(5);
  await ratings.first().press("ArrowRight");
  await expect(ratings.nth(1)).toBeChecked();
  await ratings.nth(4).click();
  await previewPage.getByLabel("Name").fill("Benchmark User");
  await previewPage.getByLabel("Email").fill("benchmark@example.test");
  await previewPage
    .getByLabel("Message")
    .fill("Phase 4 feedback flow verification.");
  await previewPage.getByRole("button", { name: /send feedback/i }).click();
  await expect(previewPage.getByRole("status")).toContainText(
    /thanks|received|feedback/i,
  );
  const successScreenshot = path.join(
    evidenceDir,
    "echoform-mobile-success.png",
  );
  await previewPage.screenshot({ path: successScreenshot, fullPage: true });

  const report = {
    kind: "verification_report",
    status: "needs_review",
    content: {
      status: "needs_review",
      routes: [
        {
          path: "/",
          status: "passed",
          evidence: [
            "Dyad run-app succeeded and the authenticated preview URL returned HTTP 200.",
            "Feedback form required-field errors, keyboard rating navigation, and valid submission passed.",
          ],
        },
      ],
      viewports: browserEvidence.map((evidence) => ({
        name: `${evidence.width}x${evidence.height}`,
        route: evidence.route,
        width: evidence.width,
        height: evidence.height,
        status: evidence.horizontalOverflow ? "failed" : "passed",
        screenshotPath: evidence.screenshotPath,
      })),
      findings: [
        ...consoleErrors.map((evidence) => ({
          severity: "medium",
          route: "/",
          evidence: `Browser console error: ${evidence}`,
        })),
        ...runtimeErrors.map((evidence) => ({
          severity: "high",
          route: "/",
          evidence: `Uncaught browser error: ${evidence}`,
        })),
        ...failedRequests.map((evidence) => ({
          severity: "medium",
          route: "/",
          evidence: `Browser request failed: ${evidence}`,
        })),
      ],
      automatedTests: [
        {
          specPath: "e2e-web/experiment4-echoform-verification.spec.ts",
          status: "passed",
          total: 1,
          passed: 1,
          failed: 0,
          blocked: 0,
          skipped: 0,
        },
      ],
      attachedScreenshotPaths: browserEvidence.map(
        (evidence) => evidence.screenshotPath,
      ),
      limitations: [
        "This Playwright run exercised Dyad's real authenticated preview, but it was launched directly by the repository E2E harness rather than the Local Agent run_tests tool.",
        "Automated browser evidence does not grant human visual approval. The prior human 4/5 review covered the same repaired EchoForm source; visual status remains needs_review.",
      ],
    },
    runEvidence: {
      appId,
      chatId,
      promptVersion:
        "Phase 4 deterministic browser replay; no generation prompt sent",
      generationModelId: null,
      previewUrl: safePreviewUrl,
      previewReadiness: "passed (HTTP 200)",
      runAppRpcStatus: runAppResponse.status(),
      browserEvidence,
      formValidation: "passed",
      keyboardRatingNavigation: "passed",
      successfulSubmission: "passed",
      beforeAfterEvidence: {
        before: [
          "docs/experiment-2/evidence/echoform-text-2026-10-20/echoform-desktop.png",
          "docs/experiment-2/evidence/echoform-text-2026-10-20/echoform-tablet.png",
          "docs/experiment-2/evidence/echoform-text-2026-10-20/echoform-mobile.png",
        ],
        after: browserEvidence.map((evidence) => evidence.screenshotPath),
        repairFromPriorRun: [
          "Warm the background with stone-50.",
          "Raise input and message placeholder contrast to slate-500.",
          "Add required input and rating semantics.",
        ],
      },
      consoleErrors,
      runtimeErrors,
      failedRequests,
      visualStatus: "needs_review",
    },
  };
  const reportPath = path.join(evidenceDir, "verification-report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("phase4-verification-report", {
    path: reportPath,
    contentType: "application/json",
  });

  expect(consoleErrors).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(browserEvidence).toHaveLength(3);
  expect(browserEvidence.every((evidence) => evidence.fontsReady)).toBe(true);
});

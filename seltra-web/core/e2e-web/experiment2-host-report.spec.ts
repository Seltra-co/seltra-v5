import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("Dyad Local Agent runs host browser verification and saves evidence", async ({
  page,
}, testInfo) => {
  test.setTimeout(20 * 60_000);
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
      message: "Dyad should establish an authenticated runtime session",
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
  const appName = `EchoForm Host Evidence ${Date.now()}`;
  const createdResponse = await page.request.post("/api/rpc/create-app", {
    headers,
    data: { args: [{ name: appName }] },
  });
  expect(createdResponse.status()).toBe(200);
  const createdPayload = (await createdResponse.json()) as {
    result?: {
      value?: {
        app?: { id?: number; resolvedPath?: string; testingEnabled?: boolean };
        chatId?: number;
      };
    };
  };
  const created = createdPayload.result?.value;
  expect(created?.app?.id).toBeGreaterThan(0);
  expect(created?.chatId).toBeGreaterThan(0);
  expect(created?.app?.resolvedPath).toBeTruthy();
  expect(created?.app?.testingEnabled).toBe(true);
  const appId = created!.app!.id!;
  const chatId = created!.chatId!;
  const appPath = created!.app!.resolvedPath!;

  const generatedAppPath = path.resolve(
    ".web-dev/apps/echoform-text-2026-10-21-live-rerun",
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
  let runAppResponse = await page.request.post("/api/rpc/run-app", {
    headers,
    data: { args: [{ appId }] },
  });
  if (runAppResponse.status() === 504) {
    // The first cold pnpm install can outlive the web RPC timeout even though
    // Vite has started successfully. Repeating the idempotent start request
    // observes the already-running app without reinstalling dependencies.
    await page.waitForTimeout(10_000);
    runAppResponse = await page.request.post("/api/rpc/run-app", {
      headers,
      data: { args: [{ appId }] },
    });
  }
  expect([200, 504]).toContain(runAppResponse.status());

  const testDir = path.join(appPath, "e2e-tests");
  await fs.mkdir(testDir, { recursive: true });
  await fs.writeFile(
    path.join(testDir, "experiment2-visual.spec.ts"),
    `import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

for (const viewport of viewports) {
  test("EchoForm / at " + viewport.name + " @seltra-visual-evidence", async ({ page }, testInfo) => {
    let consoleErrorCount = 0;
    let uncaughtErrorCount = 0;
    let failedRequestCount = 0;
    page.on("console", message => {
      if (message.type() === "error") consoleErrorCount += 1;
    });
    page.on("pageerror", () => { uncaughtErrorCount += 1; });
    page.on("requestfailed", request => {
      if (!request.failure()?.errorText?.includes("ERR_ABORTED")) failedRequestCount += 1;
    });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /send feedback/i })).toBeVisible();
    const browserState = await page.evaluate(async () => {
      await document.fonts.ready;
      const documentElement = document.documentElement;
      const body = document.body;
      return {
        pagePath: window.location.pathname,
        width: window.innerWidth,
        height: window.innerHeight,
        documentReady: document.readyState === "complete",
        bodyHasContent: Boolean(body && (body.children.length > 0 || body.innerText.trim())),
        documentWidth: documentElement.scrollWidth,
        horizontalOverflow: documentElement.scrollWidth > documentElement.clientWidth + 1,
        brokenImageCount: Array.from(document.images).filter(image => !image.complete || image.naturalWidth === 0).length,
        fontsReady: document.fonts.status === "loaded",
      };
    }));
    expect(browserState.horizontalOverflow).toBe(false);
    const screenshotPath = testInfo.outputPath("dyad-visual-evidence.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("dyad-visual-screenshot", {
      path: screenshotPath,
      contentType: "image/png",
    });
    await testInfo.attach("dyad-visual-context", {
      body: Buffer.from(JSON.stringify({
        ...browserState,
        consoleErrorCount,
        uncaughtErrorCount,
        failedRequestCount,
      })),
      contentType: "application/json",
    });
  });
}
`,
    "utf8",
  );

  const designSpecPath = path.join(
    appPath,
    ".dyad",
    "experiment-2",
    "artifacts",
    `chat-${chatId}`,
    "design_spec-v1.json",
  );
  const designSpec = JSON.parse(
    await fs.readFile(
      path.resolve(
        ".web-dev/apps/echo-form/.dyad/experiment-2/artifacts/chat-23/design_spec-v1.json",
      ),
      "utf8",
    ),
  ) as {
    artifactId: string;
    runId: string;
    appId: number;
    chatId: number;
    messageId: number;
    createdAt: string;
    content: Record<string, unknown> & { routes?: string[] };
  };
  designSpec.artifactId = randomUUID();
  designSpec.runId = randomUUID();
  designSpec.appId = appId;
  designSpec.chatId = chatId;
  designSpec.messageId = 1;
  designSpec.createdAt = new Date().toISOString();
  designSpec.content.routes = ["/"];
  await fs.mkdir(path.dirname(designSpecPath), { recursive: true });
  await fs.writeFile(
    designSpecPath,
    JSON.stringify(designSpec, null, 2) + "\n",
    "utf8",
  );

  await page.goto(`/chat?id=${chatId}&appId=${appId}`);
  const prompt = page.getByRole("textbox").first();
  await expect(prompt).toBeVisible();
  await prompt.fill(
    "tc=local-agent/experiment4-host-run\nRun the Phase 4 browser verification spec e2e-tests/experiment2-visual.spec.ts. The DesignSpec requires route /. The host must capture the desktop, tablet, and mobile screenshots and write its VerificationReport. Return the verification result when the tool finishes.",
  );
  await page.getByRole("button", { name: "Send message" }).click();

  const artifactDir = path.dirname(designSpecPath);
  const cancelGeneration = page.getByRole("button", {
    name: "Cancel generation",
  });
  const reportPath = path.join(artifactDir, "verification_report-v1.json");
  await expect
    .poll(
      async () =>
        fs
          .stat(reportPath)
          .then(() => true)
          .catch(() => false),
      { timeout: 10 * 60_000 },
    )
    .toBe(true);
  if (await cancelGeneration.isVisible().catch(() => false)) {
    await cancelGeneration.click();
    await expect(cancelGeneration).toBeHidden({ timeout: 30_000 });
  }
  const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as {
    kind: string;
    status: string;
    producer: string;
    content: {
      status: string;
      routes: Array<{ path: string; status: string }>;
      viewports: Array<{
        width: number;
        height: number;
        status: string;
        screenshotPath?: string;
      }>;
      attachedScreenshotPaths: string[];
      automatedTests?: Array<{
        status: string;
        total: number;
        passed: number;
        failed: number;
      }>;
    };
  };
  expect(report.kind).toBe("verification_report");
  expect(report.producer).toBe("dyad-test-runner");
  expect(report.status).toBe("needs_review");
  expect(report.content.status).toBe("needs_review");
  expect(report.content.routes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "/", status: "passed" }),
    ]),
  );
  expect(report.content.viewports).toHaveLength(3);
  expect(
    report.content.viewports.every((viewport) => viewport.status === "passed"),
  ).toBe(true);
  expect(report.content.attachedScreenshotPaths).toHaveLength(3);

  for (const viewport of report.content.viewports) {
    expect(viewport.screenshotPath).toBeTruthy();
    const screenshotPath = path.resolve(appPath, viewport.screenshotPath!);
    expect(
      screenshotPath.startsWith(`${path.resolve(appPath)}${path.sep}`),
    ).toBe(true);
    const name =
      viewport.width <= 480
        ? "host-mobile.png"
        : viewport.width <= 1024
          ? "host-tablet.png"
          : "host-desktop.png";
    const evidencePath = path.join(evidenceDir, name);
    await fs.copyFile(screenshotPath, evidencePath);
    await testInfo.attach(name, {
      path: evidencePath,
      contentType: "image/png",
    });
  }
  await fs.copyFile(
    reportPath,
    path.join(evidenceDir, "host-verification-report.json"),
  );
});

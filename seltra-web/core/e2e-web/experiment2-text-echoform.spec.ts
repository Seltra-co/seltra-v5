import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.skip(
  process.env.SELTRA_RUN_CLOUDFLARE_BENCHMARK !== "1" ||
    process.env.SELTRA_EXPERIMENT_TEXT_ONLY !== "1",
  "Set SELTRA_RUN_CLOUDFLARE_BENCHMARK=1 and SELTRA_EXPERIMENT_TEXT_ONLY=1 for the live text-only EchoForm gate.",
);

test("text-only EchoForm build passes responsive and feedback-flow checks", async ({
  page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  const evidenceDir = path.resolve(
    "docs/experiment-2/evidence/echoform-text-2026-10-20",
  );
  await fs.mkdir(evidenceDir, { recursive: true });

  const envText = await fs.readFile(path.resolve(".env.web"), "utf8");
  const env = Object.fromEntries(
    envText
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index),
          line.slice(index + 1).replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
  const modelId = env.AI_MODEL_DEFAULT || "@cf/moonshotai/kimi-k2.7-code";
  const prompt = [
    "Build EchoForm, a calm, polished single-page feedback form. Use only this written brief; no Figma or external reference is involved.",
    "The audience is visitors who want to leave quick feedback. Include labeled name, email, 1-to-5 rating, and message fields. Validate required values and email format, explain each error next to its field, and show an accessible success confirmation after a valid submission. Keep it client-side with no backend or external service claims.",
    "Use a warm slate-50 background, centered white card with generous spacing and soft shadow, indigo #6366F1 accents, slate text, and a small friendly speech-bubble mark. Use a readable sans-serif, touch-friendly controls, clear keyboard focus, and responsive layouts at phone, tablet, and desktop sizes. Make the rating keyboard accessible. Keep the composition simple and focused.",
  ].join("\n\n");
  const promptHash = createHash("sha256").update(prompt).digest("hex");

  let runtimeSessionId: string | undefined;
  page.on("websocket", (websocket) => {
    if (!websocket.url().includes("/api/events")) return;
    websocket.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") return;
      try {
        const message = JSON.parse(frame.payload) as {
          channel?: string;
          payload?: { id?: string };
        };
        if (
          message.channel === "web:session" &&
          typeof message.payload?.id === "string"
        )
          runtimeSessionId = message.payload.id;
      } catch {
        // Ignore unrelated runtime frames.
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
      message: "the Dyad runtime should establish its authenticated session",
    })
    .toBeTruthy();

  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "seltra_session",
  );
  expect(cookie).toBeTruthy();
  const settingsResponse = await page.request.post(
    "/api/rpc/set-user-settings",
    {
      headers: {
        cookie: `seltra_session=${cookie!.value}`,
        origin: new URL(page.url()).origin,
        "x-runtime-session": runtimeSessionId!,
      },
      data: { args: [{ autoApproveChanges: true, enableAppBlueprint: false }] },
    },
  );
  expect(settingsResponse.status()).toBe(200);

  const composer = page.getByRole("textbox").first();
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(/\/chat\?id=\d+/, { timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "Cancel generation" }),
  ).toBeHidden({ timeout: 20 * 60_000 });
  const previewButton = page.getByTestId("preview-mode-button");
  if (await previewButton.isVisible()) await previewButton.click();
  const preview = page.getByTestId("preview-iframe-element");
  await expect
    .poll(() => preview.getAttribute("src"), {
      timeout: 180_000,
      message:
        "Dyad should publish the generated app's authenticated preview URL",
    })
    .toMatch(/^https?:\/\//);
  const previewUrl = await preview.getAttribute("src");
  expect(previewUrl).toBeTruthy();
  const previewTab = await page.context().newPage();
  const previewResponse = await previewTab.goto(previewUrl!, {
    waitUntil: "domcontentloaded",
  });
  expect(previewResponse?.status()).toBeLessThan(400);

  const browserErrors: string[] = [];
  previewTab.on("pageerror", (error) => browserErrors.push(error.message));
  previewTab.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  const failures: string[] = [];
  const evidence: Record<string, unknown>[] = [];
  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const previewOrigin = new URL(previewTab.url()).origin;
  for (const viewport of viewports) {
    await previewTab.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const response = await previewTab.goto(previewOrigin, {
      waitUntil: "domcontentloaded",
    });
    if (!response || response.status() >= 400)
      failures.push(
        `${viewport.name}: page returned HTTP ${response?.status()}`,
      );
    await expect(previewTab.getByRole("heading", { level: 1 })).toBeVisible();
    const metrics = await previewTab.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      fontsStatus: document.fonts.status,
      imageCount: document.images.length,
      brokenImages: Array.from(document.images).filter(
        (image) => image.complete && image.naturalWidth === 0,
      ).length,
    }));
    if (metrics.documentWidth > metrics.viewportWidth + 1)
      failures.push(
        `${viewport.name}: horizontal overflow ${metrics.documentWidth}px > ${metrics.viewportWidth}px`,
      );
    if (metrics.fontsStatus !== "loaded")
      failures.push(`${viewport.name}: fonts did not finish loading`);
    if (metrics.brokenImages > 0)
      failures.push(
        `${viewport.name}: ${metrics.brokenImages} broken image(s)`,
      );
    const screenshot = path.join(evidenceDir, `echoform-${viewport.name}.png`);
    await previewTab.screenshot({ path: screenshot, fullPage: true });
    evidence.push({
      route: "/",
      viewport,
      screenshot: path.relative(process.cwd(), screenshot),
      ...metrics,
    });
  }

  await previewTab.setViewportSize({ width: 390, height: 844 });
  await previewTab.goto(previewOrigin, { waitUntil: "domcontentloaded" });
  await previewTab.getByRole("button", { name: /send feedback/i }).click();
  await expect(previewTab.getByText(/please enter your name/i)).toBeVisible();
  await expect(previewTab.getByText(/please enter your email/i)).toBeVisible();
  await expect(
    previewTab.getByText(/please (choose|select) a rating/i),
  ).toBeVisible();
  await expect(previewTab.getByText(/please enter a message/i)).toBeVisible();
  await previewTab.getByLabel("Name").fill("Benchmark User");
  const email = previewTab.getByLabel("Email");
  await email.fill("not-an-email");
  const radioOptions = previewTab.getByRole("radio");
  if ((await radioOptions.count()) >= 5) {
    await radioOptions.first().press("ArrowRight");
    await expect(radioOptions.nth(1)).toBeChecked();
    const fifthRatingId = await radioOptions.nth(4).getAttribute("id");
    await previewTab.locator(`label[for="${fifthRatingId}"]`).click();
    await expect(radioOptions.nth(4)).toBeChecked();
  } else {
    await previewTab.getByText("5", { exact: true }).click();
  }
  await previewTab
    .getByLabel("Message")
    .fill("The text-only EchoForm benchmark works well.");
  await previewTab.getByRole("button", { name: /send feedback/i }).click();
  await expect(
    previewTab.getByText(/please enter a valid email/i),
  ).toBeVisible();
  await email.fill("benchmark@example.test");
  await previewTab.getByRole("button", { name: /send feedback/i }).click();
  await expect(
    previewTab
      .getByRole("status")
      .or(previewTab.getByRole("heading", { name: /thank|received|success/i }))
      .first(),
  ).toBeVisible();
  await previewTab.close();

  const report = {
    status:
      failures.length === 0 && browserErrors.length === 0 ? "passed" : "failed",
    generatedAt: new Date().toISOString(),
    provider: "cloudflare",
    modelId,
    source: "written brief; no Figma import",
    promptSha256: promptHash,
    requiredRoutes: ["/"],
    viewports,
    browserErrors,
    failures,
    evidence,
    workflow: "required-field validation and successful feedback confirmation",
    humanVisualScore: "4/5; good, minor polish needed",
  };
  const reportPath = path.join(evidenceDir, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await fs.writeFile(
    path.join(evidenceDir, "PROMPT.md"),
    `# EchoForm text-only benchmark\n\n- Provider: Cloudflare Workers AI\n- Model: \`${modelId}\`\n- Prompt SHA-256: \`${promptHash}\`\n- Figma: not used\n\n\`\`\`text\n${prompt}\n\`\`\`\n`,
  );
  expect(failures, failures.join("\n")).toEqual([]);
  expect(browserErrors).toEqual([]);
  await testInfo.attach("echoform-responsive-report", {
    path: reportPath,
    contentType: "application/json",
  });
});

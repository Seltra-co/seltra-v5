import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const enabled = process.env.SELTRA_RUN_CLOUDFLARE_BENCHMARK === "1";
const origin = `http://127.0.0.1:${process.env.SELTRA_E2E_PORT || "8081"}`;
const evidenceDir = path.resolve(
  "docs/experiment-2/evidence/cloudflare-2026-10-19",
);

test.skip(
  !enabled,
  "Set SELTRA_RUN_CLOUDFLARE_BENCHMARK=1 for the live model gate.",
);

test("Cloudflare generates the Figma-informed portfolio and passes responsive routes", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
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
  expect(env.AI_PROVIDER || "cloudflare").toBe("cloudflare");
  const modelId = env.AI_MODEL_DEFAULT || "@cf/moonshotai/kimi-k2.7-code";
  const figmaUrl = env.FIGMA_URL;
  expect(figmaUrl, "set the authorized Figma URL in .env.web").toBeTruthy();
  const prompt = [
    "Build a polished, responsive portfolio for William, a full-stack software engineer. Use the Figma design link in this request as the visual reference.",
    "Implement these exact routes: /, /services, /projects, /contact, and /message-sent, with working navigation between them. The home page needs an introduction and clear CTA; services needs three service cards; projects needs a nine-item gallery with intentional placeholder fallbacks; contact needs a labeled, keyboard-accessible form that validates required fields and navigates to /message-sent on success.",
    "Follow the reference's light background, dark blue-gray text, vivid blue accents, and restrained technical gear motifs. Create a cohesive visual system with responsive desktop, tablet, and mobile layouts, visible focus states, semantic headings, and no horizontal overflow. Use local/CSS-created decorative elements and robust image fallbacks; do not invent external service integrations.",
    `Figma reference: ${figmaUrl}`,
  ].join("\n\n");
  const promptHash = createHash("sha256").update(prompt).digest("hex");
  const failures: string[] = [];
  const evidence: Record<string, unknown>[] = [];
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
        // Ignore non-JSON runtime frames.
      }
    });
  });
  const browserErrors: {
    pageErrors: number;
    consoleErrors: number;
    failedRequests: number;
  } = {
    pageErrors: 0,
    consoleErrors: 0,
    failedRequests: 0,
  };
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill("e2e@example.local");
  await page.getByLabel("Password").fill("e2e-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect
    .poll(() => runtimeSessionId, {
      message:
        "the Dyad runtime should establish its authenticated event session",
    })
    .toBeTruthy();
  await expect(page.getByTestId("model-picker")).toContainText(
    "Seltra Builder",
  );

  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "seltra_session",
  );
  expect(cookie).toBeTruthy();

  // Avoid dependency on renderer internals for settings admission; the ordinary
  // chat flow remains the real web renderer and Dyad runtime.
  const settingsResponse = await request.post("/api/rpc/set-user-settings", {
    headers: {
      cookie: `seltra_session=${cookie!.value}`,
      origin,
      "x-runtime-session": runtimeSessionId!,
    },
    data: { args: [{ autoApproveChanges: true, enableAppBlueprint: false }] },
  });
  expect(settingsResponse.status()).toBe(200);
  const usageBeforeResponse = await request.get("/api/usage/summary", {
    headers: { cookie: `seltra_session=${cookie!.value}` },
  });
  expect(usageBeforeResponse.status()).toBe(200);
  const usageBefore = (await usageBeforeResponse.json()) as {
    byRole?: Record<string, { requests?: number }>;
  };
  const requestCount = (usage: typeof usageBefore) =>
    Object.values(usage.byRole ?? {}).reduce(
      (total, role) => total + (role.requests ?? 0),
      0,
    );

  const composer = page.getByRole("textbox").first();
  const figmaImportResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/figma/import") &&
      response.request().method() === "POST",
    { timeout: 150_000 },
  );
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  const figmaResponse = await figmaImportResponse;
  expect(
    figmaResponse.status(),
    `Figma import response: ${(await figmaResponse.text()).slice(0, 500)}`,
  ).toBe(200);
  await expect(page.getByText(/Imported Figma reference:/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page).toHaveURL(/\/chat\?id=\d+/, { timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "Cancel generation" }),
  ).toBeHidden({ timeout: 20 * 60_000 });
  const usageAfterResponse = await request.get("/api/usage/summary", {
    headers: { cookie: `seltra_session=${cookie!.value}` },
  });
  expect(usageAfterResponse.status()).toBe(200);
  const usageAfter = (await usageAfterResponse.json()) as typeof usageBefore;
  const modelRequests = requestCount(usageAfter) - requestCount(usageBefore);
  expect(
    modelRequests,
    "Cloudflare generation must be recorded by the gateway",
  ).toBeGreaterThan(0);

  const previewButton = page.getByTestId("preview-mode-button");
  if (await previewButton.isVisible()) await previewButton.click();
  const preview = page.getByTestId("preview-iframe-element");
  await expect(preview).toBeVisible({ timeout: 180_000 });
  await page.getByTestId("preview-more-options-button").click();
  const tabPromise = page.context().waitForEvent("page");
  await page.getByTestId("preview-open-browser-menu-item").click();
  const previewTab = await tabPromise;
  previewTab.on("pageerror", () => browserErrors.pageErrors++);
  previewTab.on("console", (message) => {
    if (message.type() === "error") browserErrors.consoleErrors++;
  });
  previewTab.on("requestfailed", () => browserErrors.failedRequests++);
  await previewTab.waitForLoadState("domcontentloaded");
  const previewOrigin = new URL(previewTab.url()).origin;
  const routes = ["/", "/services", "/projects", "/contact", "/message-sent"];
  const routeMarkers: Record<string, RegExp> = {
    "/": /William|engineer/i,
    "/services": /services/i,
    "/projects": /projects/i,
    "/contact": /contact|message/i,
    "/message-sent": /sent|thank you|received/i,
  };
  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await previewTab.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const route of routes) {
      const response = await previewTab.goto(`${previewOrigin}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      if (!response || response.status() >= 400)
        failures.push(
          `${route} ${viewport.name}: navigation status ${response?.status() ?? "none"}`,
        );
      await expect(previewTab.locator("body")).not.toBeEmpty({
        timeout: 30_000,
      });
      await previewTab.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          Array.from(document.images, (image) =>
            image.complete
              ? Promise.resolve()
              : new Promise((resolve) => {
                  image.addEventListener("load", resolve, { once: true });
                  image.addEventListener("error", resolve, { once: true });
                  setTimeout(resolve, 5_000);
                }),
          ),
        );
      });
      const metrics = await previewTab.evaluate(() => ({
        title: document.title,
        text: document.body.innerText.trim().slice(0, 5_000),
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        brokenImages: Array.from(document.images).filter(
          (image) => image.complete && image.naturalWidth === 0,
        ).length,
        fontsStatus: document.fonts.status,
      }));
      if (metrics.text.length < 40)
        failures.push(`${route} ${viewport.name}: page content is too sparse`);
      if (!routeMarkers[route]?.test(metrics.text))
        failures.push(
          `${route} ${viewport.name}: required page content was not found`,
        );
      if (metrics.documentWidth > metrics.viewportWidth + 1)
        failures.push(
          `${route} ${viewport.name}: horizontal overflow (${metrics.documentWidth}px > ${metrics.viewportWidth}px)`,
        );
      if (metrics.brokenImages > 0)
        failures.push(
          `${route} ${viewport.name}: ${metrics.brokenImages} broken image(s)`,
        );
      if (metrics.fontsStatus !== "loaded")
        failures.push(
          `${route} ${viewport.name}: fonts did not finish loading`,
        );
      const routeName = route === "/" ? "home" : route.slice(1);
      const screenshot = path.join(
        evidenceDir,
        `${routeName}-${viewport.name}.png`,
      );
      await previewTab.screenshot({ path: screenshot, fullPage: true });
      evidence.push({
        route,
        viewport,
        screenshot: path.relative(process.cwd(), screenshot),
        ...metrics,
      });
    }
  }

  await previewTab.setViewportSize({ width: 390, height: 844 });
  await previewTab.goto(`${previewOrigin}/contact`, {
    waitUntil: "domcontentloaded",
  });
  const contactForm = previewTab.locator("form").first();
  if ((await contactForm.count()) === 0) {
    failures.push("/contact mobile: accessible contact form was not found");
  } else {
    const emailInput = contactForm.locator('input[type="email"]').first();
    const textInput = contactForm
      .locator('input:not([type="email"]):not([type="hidden"])')
      .first();
    const messageInput = contactForm.locator("textarea").first();
    const submit = contactForm
      .locator('button[type="submit"], input[type="submit"]')
      .first();
    if (
      !(await emailInput.count()) ||
      !(await messageInput.count()) ||
      !(await submit.count())
    ) {
      failures.push(
        "/contact mobile: form is missing email, message, or submit controls",
      );
    } else {
      await submit.click();
      const remainedForValidation =
        new URL(previewTab.url()).pathname === "/contact";
      if (!remainedForValidation)
        failures.push(
          "/contact mobile: empty form submitted without validation",
        );
      if (await textInput.count()) await textInput.fill("Benchmark User");
      await emailInput.fill("benchmark@example.test");
      await messageInput.fill("Please contact me about a portfolio project.");
      await submit.click();
      await previewTab
        .waitForURL(/\/message-sent\/?$/, { timeout: 15_000 })
        .catch(() => {
          failures.push(
            "/contact mobile: valid form did not reach /message-sent",
          );
        });
    }
  }
  await previewTab.close();

  const report = {
    status:
      failures.length === 0 &&
      Object.values(browserErrors).every((count) => count === 0)
        ? "passed"
        : "failed",
    generatedAt: new Date().toISOString(),
    modelId,
    provider: "cloudflare",
    gatewayModelRequestDelta: modelRequests,
    promptHash,
    figmaReferenceImported: true,
    requiredRoutes: routes,
    viewports,
    browserErrors,
    failures,
    evidence,
  };
  await fs.writeFile(
    path.join(evidenceDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await fs.writeFile(
    path.join(evidenceDir, "PROMPT.md"),
    `# Cloudflare design benchmark prompt\n\n- Provider: Cloudflare Workers AI\n- Model: \`${modelId}\`\n- SHA-256: \`${promptHash}\`\n- Figma URL: sanitized in the generated report; source credentials were not saved here.\n\n\`\`\`text\n${prompt.replace(figmaUrl, "[configured Figma URL]")}\n\`\`\`\n`,
  );
  expect(failures, failures.join("\n")).toEqual([]);
  expect(Object.values(browserErrors), JSON.stringify(browserErrors)).toEqual([
    0, 0, 0,
  ]);
  await testInfo.attach("responsive-report", {
    path: path.join(evidenceDir, "report.json"),
    contentType: "application/json",
  });
});

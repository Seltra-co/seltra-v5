import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const e2eStateDir = path.join(
  process.env.TEMP || process.env.TMP || ".",
  "seltra-web-e2e-dyad-main",
);
const e2ePort = process.env.SELTRA_E2E_PORT || "8081";
const e2eOrigin = `http://127.0.0.1:${e2ePort}`;

async function waitForPreviewWithProgress(
  page: import("@playwright/test").Page,
  preview: import("@playwright/test").Locator,
): Promise<void> {
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let lastProgress = "";
  const hardCapMs = 10 * 60_000;
  const noProgressMs = 2 * 60_000;
  let lastRuntimeLogSignature = "";
  while (Date.now() - startedAt < hardCapMs) {
    if (await preview.isVisible().catch(() => false)) return;
    const pageText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const progress = pageText.match(/Progress: resolved[^\n]*/g)?.at(-1) ?? "";
    if (progress && progress !== lastProgress) {
      lastProgress = progress;
      lastProgressAt = Date.now();
    }
    try {
      const runtimeLog = await fs.readFile(
        path.join(e2eStateDir, "logs", "runtime.log"),
        "utf8",
      );
      const appOutputLines = runtimeLog.match(
        /^\d{2}:\d{2}:\d{2}\.\d{3} \(app_runtime_service\).* App \d+ \(PID: ?\d+\) (?:stdout|stderr):.*$/gm,
      );
      const signature = appOutputLines?.at(-1) ?? "";
      if (signature && signature !== lastRuntimeLogSignature) {
        lastRuntimeLogSignature = signature;
        lastProgressAt = Date.now();
        lastProgress = "application process output advanced";
      }
    } catch {
      // The runtime may not have created its log file yet.
    }
    if (Date.now() - lastProgressAt >= noProgressMs) {
      throw new Error(
        `Preview startup made no visible install progress for ${Math.ceil(noProgressMs / 1000)} seconds. Latest progress: ${lastProgress || "none"}`,
      );
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(
    `Preview startup exceeded ${Math.ceil(hardCapMs / 1000)} seconds. Latest progress: ${lastProgress || "none"}`,
  );
}

async function expectNoVisibleDyad(page: import("@playwright/test").Page) {
  const visibleText = await page.locator("body").innerText();
  expect(visibleText, "web UI should use Seltra wording").not.toMatch(
    /\bDyad\b/i,
  );
}

test("login loads the web renderer and preserves a text runtime session", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(900_000);
  const consoleMessages: { type: string; text: string }[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const apiResponses: { url: string; status: number }[] = [];
  const machineRequests: { channel: string; machineId?: unknown }[] = [];
  const frames: { dir: "in" | "out"; binary: boolean; head: string }[] = [];
  const consoleErrors: string[] = [];
  const filteredConsoleErrors: string[] = [];
  const posthogRequests: string[] = [];
  const cdnRequests: string[] = [];
  let firstFrame: { binary: boolean; head: string } | undefined;
  let bootstrapResponse: { status: number; body: unknown } | undefined;

  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
    if (message.type() === "error") {
      const text = message.text();
      if (/us\.i\.posthog\.com|cdn\.jsdelivr\.net/i.test(text))
        filteredConsoleErrors.push(text);
      else consoleErrors.push(text);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
    consoleErrors.push(error.message);
  });
  page.on("requestfailed", (req) => {
    const entry = `${req.url()}: ${req.failure()?.errorText ?? "request failed"}`;
    requestFailures.push(entry);
    if (/us\.i\.posthog\.com|cdn\.jsdelivr\.net/i.test(req.url()))
      filteredConsoleErrors.push(entry);
    else consoleErrors.push(entry);
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/"))
      apiResponses.push({ url: response.url(), status: response.status() });
    if (
      decodeURIComponent(new URL(response.url()).pathname).includes(
        "/api/rpc/window-infrastructure:bootstrap",
      )
    ) {
      void response
        .json()
        .then((body) => {
          bootstrapResponse = { status: response.status(), body };
        })
        .catch(() => {
          bootstrapResponse = {
            status: response.status(),
            body: "invalid JSON",
          };
        });
    }
  });
  page.on("request", (request) => {
    if (
      decodeURIComponent(new URL(request.url()).pathname).includes(
        "distributed-machine:",
      )
    ) {
      let machineId: unknown;
      try {
        machineId = request.postDataJSON()?.args?.[0]?.machineId;
      } catch {
        // Keep only the channel when the request body is not valid JSON.
      }
      machineRequests.push({
        channel:
          decodeURIComponent(new URL(request.url()).pathname)
            .split("/")
            .at(-1) ?? "",
        machineId,
      });
    }
    if (request.url().includes("us.i.posthog.com"))
      posthogRequests.push(request.url());
    if (request.url().includes("cdn.jsdelivr.net"))
      cdnRequests.push(request.url());
  });
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/api/events")) return;
    ws.on("framereceived", (frame) => {
      const entry = {
        dir: "in" as const,
        binary: typeof frame.payload !== "string",
        head: String(frame.payload).slice(0, 200),
      };
      frames.push(entry);
      firstFrame ??= { binary: entry.binary, head: entry.head };
    });
    ws.on("framesent", (frame) =>
      frames.push({
        dir: "out",
        binary: typeof frame.payload !== "string",
        head: String(frame.payload).slice(0, 200),
      }),
    );
  });

  try {
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill("e2e@example.local");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login\?error=1$/);
    await page.getByLabel("Email").fill("e2e@example.local");
    await page.getByLabel("Password").fill("e2e-test-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // 1. Login redirect.
    await expect(
      page,
      "successful login should land on the app root",
    ).toHaveURL(`${e2eOrigin}/`);
    // 2. Runtime event socket.
    await expect
      .poll(() => frames.length, {
        message: "renderer should open /api/events and receive a frame",
      })
      .toBeGreaterThan(0);
    // 3. Runtime's first session frame must be WebSocket text.
    await expect
      .poll(() => firstFrame, { message: "first event frame should arrive" })
      .toBeTruthy();
    expect(firstFrame?.binary, "first WebSocket frame must be text").toBe(
      false,
    );
    expect(
      JSON.parse(firstFrame!.head).channel,
      "first text frame should contain the runtime session",
    ).toBe("web:session");
    // 4. Renderer bootstrap succeeds through RPC.
    await expect
      .poll(() => bootstrapResponse, {
        message: "renderer should send bootstrap RPC and receive its response",
      })
      .toMatchObject({ status: 200, body: { ok: true } });
    // 5. React mounted content.
    await expect
      .poll(() => page.locator("#root").innerText(), {
        message: "renderer root should contain mounted UI",
      })
      .not.toBe("");
    await expect(page).toHaveTitle("Seltra Builder");
    await expect(
      page.getByText(/Help improve Dyad with anonymous usage data/i),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Upgrade to Pro" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Describe your idea. Seltra will turn it into a working app.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Import App" })).toHaveCount(
      0,
    );
    await expect(page.getByText(/Ask Seltra to build/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pro", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("model-picker")).toContainText(
      "Seltra Builder",
    );
    await expect(
      page.getByRole("button", { name: /Voice to text/ }),
    ).toBeVisible();
    // Open the app list in the sidebar before checking its creation action.
    await page.getByRole("link", { name: "Apps", exact: true }).click();
    // 6. Main UI is ready.
    await expect(
      page.getByRole("button", { name: "New App", exact: true }),
      "the loaded renderer should show New App",
    ).toBeVisible();
    await expectNoVisibleDyad(page);
    const firstPrompt =
      "Build a clean, responsive product landing page for a fictional Ghanaian coffee brand. Include a navigation bar, hero section, three product cards, and footer. Use React and TypeScript.";
    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === "seltra_session");
    expect(
      session,
      "successful login should issue a session cookie",
    ).toBeTruthy();
    const runtimeSessionId = JSON.parse(firstFrame!.head).payload.id;
    const enableAutoApprove = await request.post("/api/rpc/set-user-settings", {
      headers: {
        cookie: `seltra_session=${session!.value}`,
        origin: e2eOrigin,
        "x-runtime-session": String(runtimeSessionId),
      },
      data: { args: [{ autoApproveChanges: true, enableAppBlueprint: false }] },
    });
    expect(enableAutoApprove.status()).toBe(200);
    const composer = page.getByRole("textbox").first();
    await composer.fill(firstPrompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/chat\?id=\d+/, { timeout: 60_000 });
    await expect(
      page
        .getByTestId("modified-files-row")
        .filter({ hasText: "App.tsx" })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Task completed.")).toBeVisible({
      timeout: 60_000,
    });
    await expectNoVisibleDyad(page);
    await expect(page.getByText(/Tool 'write_file' failed/)).toHaveCount(0);
    await expect(page.getByTestId("promo-message")).toHaveCount(0);
    expect(
      frames.some(
        (frame) =>
          frame.dir === "in" &&
          frame.head.includes('"channel":"chat:response:chunk"'),
      ),
      "the fake LLM response should arrive as a streamed runtime event",
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: /Version \d+/ }),
    ).toBeVisible();
    await expect(page.getByTestId("chat-mode-selector")).toHaveAttribute(
      "aria-label",
      "Chat mode: Seltra Agent",
    );
    await expect(
      page.locator('[contenteditable="true"]').first(),
    ).toHaveAttribute("aria-placeholder", /Ask Seltra to build/);
    await page.getByTestId("code-mode-button").click();
    const fileTree = page.getByRole("tree");
    await expect(fileTree).toContainText("src", { timeout: 180_000 });
    await fileTree.getByText("src", { exact: true }).click();
    await expect(fileTree).toContainText("App.tsx", { timeout: 30_000 });
    await fileTree.getByText("App.tsx", { exact: true }).click();
    await expect(page.locator(".monaco-editor")).not.toBeEmpty({
      timeout: 180_000,
    });
    expect(cdnRequests, "Code tab must not load Monaco from a CDN").toEqual([]);
    await page.getByTestId("preview-mode-button").click();
    const preview = page.getByTestId("preview-iframe-element");
    await waitForPreviewWithProgress(page, preview);
    await expect
      .poll(async () => {
        const src = await preview.getAttribute("src");
        if (!src) return "";
        return new URL(src).origin;
      })
      .toMatch(new RegExp(`^http://app-\\d+\\.localhost:${e2ePort}$`));
    await expect(
      page
        .frameLocator('[data-testid="preview-iframe-element"]')
        .locator("body"),
    ).not.toBeEmpty({
      timeout: 180_000,
    });
    await expect(
      page
        .frameLocator('[data-testid="preview-iframe-element"]')
        .locator("body"),
    ).toContainText("Volta Gold");
    const previewFrame = page.frameLocator(
      '[data-testid="preview-iframe-element"]',
    );
    await expect(previewFrame.locator(".seltra-attribution")).toContainText(
      "Built with Seltra",
    );
    await previewFrame
      .getByRole("button", { name: "Dismiss Built with Seltra" })
      .click();
    await expect(previewFrame.locator(".seltra-attribution")).toHaveCount(0);
    const previewOrigin = new URL((await preview.getAttribute("src"))!).origin;
    expect(
      await previewFrame
        .locator("body")
        .evaluate(() => localStorage.getItem("seltra-attribution-seen")),
    ).toBe("1");
    await expect(
      previewFrame.locator('link[rel="icon"][href="/seltra-mark.png"]'),
    ).toHaveCount(1);
    await page.getByTestId("preview-more-options-button").click();
    const previewTabPromise = page.context().waitForEvent("page", {
      timeout: 15_000,
    });
    await page.getByTestId("preview-open-browser-menu-item").click();
    const previewTab = await previewTabPromise;
    await expect(previewTab).toHaveURL(
      new RegExp(`^http://app-\\d+\\.localhost:${e2ePort}/`),
    );
    expect(new URL(previewTab.url()).origin).toBe(previewOrigin);
    await expect(previewTab.locator("body")).toContainText("Volta Gold", {
      timeout: 30_000,
    });
    await expect(previewTab.locator(".seltra-attribution")).toHaveCount(0);
    await previewTab.close();
    // The authenticated RPC/WebSocket bridge stays active, so networkidle is
    // not a meaningful readiness signal here. All preview operations above
    // are awaited before the renderer reload.
    expect(
      consoleErrors,
      `uncaught browser errors before renderer reload: ${JSON.stringify(filteredConsoleErrors)}`,
    ).toEqual([]);
    await page.reload();
    await expect(page).toHaveURL(/\/chat\?id=\d+/);
    await expect(
      page
        .getByTestId("modified-files-row")
        .filter({ hasText: "App.tsx" })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Version \d+/ }),
    ).toBeVisible();
    await expect(page.getByText("Task completed.")).toBeVisible();
    expect(
      consoleErrors,
      `uncaught browser errors through renderer reload: ${JSON.stringify(filteredConsoleErrors)}`,
    ).toEqual([]);
    expect(posthogRequests, "web renderer must not initialize PostHog").toEqual(
      [],
    );

    const disabledResponse = await request.post("/api/rpc/release-notes", {
      headers: {
        cookie: `seltra_session=${session!.value}`,
        origin: e2eOrigin,
      },
      data: { args: [] },
    });
    expect(disabledResponse.status()).toBe(403);
    expect(await disabledResponse.json()).toMatchObject({
      error: { code: "CHANNEL_DISABLED" },
    });
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expectNoVisibleDyad(page);
  } finally {
    const logTail = async (file: string) => {
      try {
        return (await fs.readFile(file, "utf8"))
          .split(/\r?\n/)
          .slice(-200)
          .join("\n");
      } catch (error) {
        return `Unable to read ${file}: ${String(error)}`;
      }
    };
    const gatewayLog = await logTail(
      path.join(e2eStateDir, "logs", "gateway.log"),
    );
    const runtimeLog = await logTail(
      path.join(e2eStateDir, "logs", "runtime.log"),
    );
    const diagnostics = {
      consoleMessages,
      pageErrors,
      requestFailures,
      apiResponses,
      machineRequests,
      websocketFrames: frames,
      firstFrame,
      bootstrapResponse,
      consoleErrors,
      filteredConsoleErrors,
      posthogRequests,
      cdnRequests,
      gatewayLogTail: gatewayLog,
      runtimeLogTail: runtimeLog,
    };
    console.log(
      "[web-e2e] API response statuses:",
      JSON.stringify(apiResponses.filter((response) => response.status >= 400)),
    );
    console.log(
      "[web-e2e] distributed machine IDs:",
      JSON.stringify(machineRequests),
    );
    if (testInfo.status !== testInfo.expectedStatus) {
      console.log(
        "[web-e2e] captured page errors:",
        JSON.stringify(pageErrors),
      );
      console.log(
        "[web-e2e] captured console errors:",
        JSON.stringify(consoleErrors),
      );
      console.log(
        "[web-e2e] captured console messages:",
        JSON.stringify(
          consoleMessages.filter((message) => message.type === "error"),
        ),
      );
    }
    await testInfo.attach("web-e2e-diagnostics.json", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("gateway-log-tail.txt", {
      body: gatewayLog,
      contentType: "text/plain",
    });
    await testInfo.attach("runtime-log-tail.txt", {
      body: runtimeLog,
      contentType: "text/plain",
    });
  }
});

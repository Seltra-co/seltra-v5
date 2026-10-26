import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("preserved text-only EchoForm passes responsive and feedback checks", async ({
  page,
}) => {
  const appUrl = process.env.SELTRA_ECHOFORM_PREVIEW_URL;
  expect(
    appUrl,
    "set SELTRA_ECHOFORM_PREVIEW_URL to the Vite preview",
  ).toBeTruthy();
  const evidenceDir = path.resolve(
    "docs/experiment-2/evidence/echoform-text-2026-10-20",
  );
  await fs.mkdir(evidenceDir, { recursive: true });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const response = await page.goto(appUrl!);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    await page.screenshot({
      path: path.join(evidenceDir, `echoform-${viewport.name}-recheck.png`),
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appUrl!);
  await page.getByRole("button", { name: /send feedback/i }).click();
  await expect(page.getByText(/please enter your name/i)).toBeVisible();
  await expect(page.getByText(/please enter your email/i)).toBeVisible();
  await expect(
    page.getByText(/please (choose|select) a rating/i),
  ).toBeVisible();
  await expect(page.getByText(/please enter a message/i)).toBeVisible();
  await page.screenshot({
    path: path.join(evidenceDir, "echoform-mobile-validation-recheck.png"),
    fullPage: true,
  });

  const radioOptions = page.getByRole("radio");
  if ((await radioOptions.count()) >= 5) {
    await radioOptions.first().press("ArrowRight");
    await expect(radioOptions.nth(1)).toBeChecked();
    const fifthRatingId = await radioOptions.nth(4).getAttribute("id");
    await page.locator(`label[for="${fifthRatingId}"]`).click();
    await expect(radioOptions.nth(4)).toBeChecked();
  } else {
    await page.getByText("5", { exact: true }).click();
  }
  await page.getByLabel("Name").fill("Benchmark User");
  await page.getByLabel("Email").fill("benchmark@example.test");
  await page
    .getByLabel("Message")
    .fill("The text-only EchoForm benchmark works well.");
  await page.getByRole("button", { name: /send feedback/i }).click();
  await expect(page.getByRole("status")).toContainText(
    /thanks|received|feedback/i,
  );
  await page.screenshot({
    path: path.join(evidenceDir, "echoform-mobile-success-recheck.png"),
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});

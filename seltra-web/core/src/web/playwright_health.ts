import type { Browser } from "playwright";
import log from "electron-log/main";

const logger = log.scope("playwright-health");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function verifyPlaywrightBrowser(): Promise<void> {
  let executablePath = "unresolved";
  let browser: Browser | undefined;

  try {
    const { chromium } = await import("playwright");
    executablePath = chromium.executablePath();
    browser = await chromium.launch({ headless: true, timeout: 30_000 });
    const page = await browser.newPage({
      viewport: { width: 64, height: 64 },
      deviceScaleFactor: 1,
    });
    await page.setContent("<!doctype html><html><body>ready</body></html>");
    const screenshot = await page.screenshot({ type: "png" });
    if (!screenshot.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error("Headless Chromium returned an invalid PNG screenshot.");
    }

    const version = browser.version();
    await browser.close();
    browser = undefined;
    logger.info("Playwright Chromium startup check passed", {
      version,
      executablePath,
      screenshotBytes: screenshot.length,
    });
  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        logger.warn(
          "Failed to close Chromium after startup check failure",
          closeError,
        );
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Playwright Chromium startup check failed at "${executablePath}": ${reason}`,
      { cause: error },
    );
  }
}

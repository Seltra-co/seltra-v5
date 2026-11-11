// core/src/web/playwright_health.ts
import type { Browser } from "playwright";
import path from "node:path";
import log from "electron-log/main";

const logger = log.scope("playwright-health");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let playwrightAvailable = true;

function getHeadlessShellExecutablePath(
  chromiumExecutablePath: string,
): string {
  const platformExecutables: Record<string, string[]> = {
    linux:
      process.arch === "arm64"
        ? ["chrome-linux", "headless_shell"]
        : ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    darwin: [
      `chrome-headless-shell-mac-${process.arch === "arm64" ? "arm64" : "x64"}`,
      "chrome-headless-shell",
    ],
    win32: ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
  };
  const platformExecutable = platformExecutables[process.platform];
  if (!platformExecutable) return chromiumExecutablePath;

  const revisionDirectory = path.dirname(path.dirname(chromiumExecutablePath));
  const revision = path
    .basename(revisionDirectory)
    .match(/^chromium-(.+)$/)?.[1];
  if (!revision) return chromiumExecutablePath;

  return path.join(
    path.dirname(revisionDirectory),
    `chromium_headless_shell-${revision}`,
    ...platformExecutable,
  );
}

export function isPlaywrightAvailable(): boolean {
  return playwrightAvailable;
}

export async function verifyPlaywrightBrowser(): Promise<void> {
  playwrightAvailable = false;
  let executablePath = "unresolved";
  let browser: Browser | undefined;

  try {
    const { chromium } = await import("playwright");
    executablePath = getHeadlessShellExecutablePath(chromium.executablePath());
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
    playwrightAvailable = true;
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
    const failure = new Error(
      `Playwright Chromium startup check failed at "${executablePath}": ${reason}`,
      { cause: error },
    );
    logger.error("Playwright Chromium startup check failed", failure);
    if (process.env.REQUIRE_PLAYWRIGHT?.trim() === "1") {
      throw failure;
    }
  }
}

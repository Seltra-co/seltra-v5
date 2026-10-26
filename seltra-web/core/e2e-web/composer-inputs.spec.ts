import { expect, test } from "@playwright/test";

test("web composer exposes voice, broad file import, and Figma import", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class MockSpeechRecognition {
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      lang = "en-US";
      interimResults = true;
      continuous = true;
      start() {
        queueMicrotask(() =>
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: "Build a store" } }],
          }),
        );
      }
      stop() {
        queueMicrotask(() => this.onend?.());
      }
      abort() {
        queueMicrotask(() => this.onend?.());
      }
    }
    Object.assign(window, { SpeechRecognition: MockSpeechRecognition });
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill("e2e@example.local");
  await page.getByLabel("Password").fill("e2e-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByTestId("home-chat-input-container")).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Voice to text" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Voice to text" }).click();
  await expect(page.getByTestId("voice-recording-controls")).toBeVisible();
  await expect(page.getByTestId("voice-transcript-preview")).toContainText(
    "Build a store",
  );
  await expect(
    page.getByRole("button", { name: "Send voice transcript" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause recording" }).click();
  await expect(
    page.getByRole("button", { name: "Continue recording" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue recording" }).click();
  await expect(
    page.getByRole("button", { name: "Pause recording" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel voice recording" }).click();
  await expect(
    page.getByRole("button", { name: "Voice to text" }),
  ).toBeVisible();
  await page.getByTestId("auxiliary-actions-menu").click();
  await expect(page.getByText("Attach files", { exact: true })).toBeVisible();
  await page.getByText("Attach files", { exact: true }).click();
  await expect(page.getByTestId("chat-context-file-input")).toHaveAttribute(
    "accept",
    /\.zip.*\*\/\*/,
  );
  await expect(
    page.getByTestId("upload-to-codebase-file-input"),
  ).toHaveAttribute("accept", /\.zip.*\*\/\*/);
  await expect(page.getByTestId("import-from-figma")).toBeVisible();
  await page.getByTestId("import-from-figma").click();
  await expect(page.getByRole("dialog")).toContainText("Import from Figma");
  await expect(
    page.getByRole("textbox", { name: "Figma design URL" }),
  ).toBeVisible();
});

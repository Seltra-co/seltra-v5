import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WebConnectionBanner } from "./WebConnectionBanner";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("keeps connection loss visible until reconnect and offers retry", () => {
  vi.stubGlobal("__SELTRA_WEB__", true);
  Object.defineProperty(window, "__SELTRA_WEB__", {
    configurable: true,
    value: true,
  });
  const retry = vi.fn();
  window.addEventListener("seltra:web-retry-connection", retry);
  render(<WebConnectionBanner />);

  window.dispatchEvent(
    new CustomEvent("seltra:web-connection", {
      detail: { status: "connecting" },
    }),
  );
  expect(screen.getByTestId("web-connection-banner")).toHaveTextContent(
    "Connection lost. Reconnecting…",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();

  window.dispatchEvent(
    new CustomEvent("seltra:web-connection", {
      detail: { status: "connected" },
    }),
  );
  expect(screen.queryByTestId("web-connection-banner")).toBeNull();
  window.removeEventListener("seltra:web-retry-connection", retry);
});

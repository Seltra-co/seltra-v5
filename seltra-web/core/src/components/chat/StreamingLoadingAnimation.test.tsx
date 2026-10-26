import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingLoadingAnimation } from "./StreamingLoadingAnimation";

vi.mock("thinking-orbs", () => ({
  ThinkingOrb: ({ state }: { state: string }) => (
    <span data-testid="thinking-orb" data-state={state} />
  ),
}));

describe("StreamingLoadingAnimation", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the searching orb while retaining the existing initial status text", () => {
    render(<StreamingLoadingAnimation variant="initial" />);

    expect(screen.getByTestId("thinking-orb").getAttribute("data-state")).toBe(
      "searching",
    );
    expect(screen.getByText("thinking...")).toBeTruthy();
  });

  it("uses the working orb while retaining the existing streaming status text", () => {
    render(<StreamingLoadingAnimation variant="streaming" />);

    expect(screen.getByTestId("thinking-orb").getAttribute("data-state")).toBe(
      "working",
    );
    expect(screen.getByText("brewing...")).toBeTruthy();
  });
});

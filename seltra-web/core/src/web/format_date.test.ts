import { describe, expect, it, vi } from "vitest";
import { formatWebDate } from "./format_date";

describe("formatWebDate", () => {
  it.each([null, undefined, "", "not-a-date", Number.NaN])(
    "returns a safe empty value for invalid input %s",
    (value) => {
      const formatter = vi.fn(() => "formatted");
      expect(formatWebDate(value, formatter)).toBe("");
      expect(formatter).not.toHaveBeenCalled();
    },
  );

  it("formats a valid JSON bridge timestamp", () => {
    expect(
      formatWebDate("2026-10-15T08:40:00.000Z", (date) => date.toISOString()),
    ).toBe("2026-10-15T08:40:00.000Z");
  });
});

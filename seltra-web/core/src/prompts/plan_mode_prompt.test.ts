import { describe, expect, it } from "vitest";
import { constructPlanModePrompt } from "./plan_mode_prompt";

describe("constructPlanModePrompt", () => {
  it("requires prompt-specific questions for a new app plan", () => {
    const prompt = constructPlanModePrompt(undefined);

    expect(prompt).toContain(
      "ask 3-5 distinct, prompt-specific requirements questions",
    );
    expect(prompt).toContain("do not use a fixed questionnaire");
  });

  it("limits existing-codebase questions to meaningful ambiguity", () => {
    const prompt = constructPlanModePrompt(undefined);

    expect(prompt).toContain(
      "For plans that modify an existing codebase, ask up to 5 focused questions at a time",
    );
    expect(prompt).toContain(
      "only ask what is needed to resolve meaningful ambiguity",
    );
    expect(prompt).not.toContain("Ask 1-3 focused questions");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";
import { planningQuestionnaireTool } from "./planning_questionnaire";

const registryMocks = vi.hoisted(() => ({
  request: vi.fn(() => "request-1"),
  park: vi.fn(),
}));

const engineMocks = vi.hoisted(() => ({
  engineFetch: vi.fn(),
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: registryMocks,
}));

vi.mock("./engine_fetch", () => ({
  engineFetch: engineMocks.engineFetch,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

const question = {
  type: "text" as const,
  question: "What should this app do?",
};

function generatedResponse(questions: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({ questions }),
          },
        },
      ],
    }),
  };
}

function validGeneratedQuestions() {
  return [
    {
      id: "collections",
      type: "multi",
      prompt: "Which fashion collections should Noire Atelier feature?",
      options: [
        { id: "evening", label: "Eveningwear" },
        { id: "work", label: "Workwear" },
        { id: "other", label: "Other" },
      ],
      allowOther: true,
      shapes: "pages",
    },
    {
      id: "palette",
      type: "single",
      prompt: "Which palette best fits the atelier's editorial look?",
      options: [
        { id: "neutral", label: "Warm neutrals" },
        { id: "jewel", label: "Jewel tones" },
      ],
      allowOther: false,
      shapes: "palette",
    },
    {
      id: "shipping",
      type: "text",
      prompt: "What shipping options should shoppers see at checkout?",
      allowOther: false,
      shapes: "integrations",
    },
  ];
}

describe("planningQuestionnaireTool", () => {
  beforeEach(() => {
    registryMocks.request.mockClear();
    registryMocks.park.mockReset();
    engineMocks.engineFetch.mockReset();
  });

  it("directs initial blueprint questions through prompt-grounded generation", () => {
    expect(planningQuestionnaireTool.description).toContain(
      "Seltra's fast model generates and validates 3-5 distinct questions",
    );
    expect(planningQuestionnaireTool.description).not.toContain("tech stack");
  });

  it("accepts up to five fallback questions", () => {
    expect(
      planningQuestionnaireTool.inputSchema.safeParse({
        questions: Array.from({ length: 5 }, () => question),
      }).success,
    ).toBe(true);
  });

  it("rejects more than five fallback questions", () => {
    const result = planningQuestionnaireTool.inputSchema.safeParse({
      questions: Array.from({ length: 6 }, () => question),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "questions array must have at most 5 questions",
      );
    }
  });

  it("does not fall back to model-supplied questions for an initial blueprint", async () => {
    const ctx = {
      chatId: 1,
      enableAppBlueprint: true,
      appBlueprintQuestionnaireCompleted: false,
      planningQuestionnaireAvailable: true,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await expect(
      planningQuestionnaireTool.execute(
        { questions: [question, question, question] },
        ctx,
      ),
    ).rejects.toThrow("QUESTIONNAIRE_GENERATION_FAILED");
    expect(registryMocks.request).not.toHaveBeenCalled();
    expect(ctx.planningQuestionnaireGenerationFailed).toBe(true);
  });

  it("honors an explicit questionnaire skip without inventing answers", async () => {
    const ctx = {
      chatId: 1,
      enableAppBlueprint: true,
      appBlueprintQuestionnaireCompleted: false,
      appBlueprintQuestionnaireSkipped: true,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await expect(
      planningQuestionnaireTool.execute({ questions: [] }, ctx),
    ).resolves.toContain("explicitly chose to skip questions");
    expect(engineMocks.engineFetch).not.toHaveBeenCalled();
    expect(registryMocks.request).not.toHaveBeenCalled();
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('title="Questionnaire skipped"'),
    );
  });

  it("generates prompt-specific questions through Seltra's fast model", async () => {
    registryMocks.park.mockResolvedValue({
      kind: "questionnaire",
      answers: { collections: "Eveningwear" },
    });
    engineMocks.engineFetch.mockResolvedValue(
      generatedResponse(validGeneratedQuestions()),
    );
    const ctx = {
      chatId: 1,
      dyadRequestId: "request-1",
      planningQuestionnairePrompt:
        "Build a fashion store for Noire Atelier with editorial styling.",
      enableAppBlueprint: true,
      appBlueprintQuestionnaireCompleted: false,
      planningQuestionnaireAvailable: true,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await planningQuestionnaireTool.execute({ questions: [] }, ctx);

    expect(engineMocks.engineFetch).toHaveBeenCalledTimes(1);
    expect(engineMocks.engineFetch.mock.calls[0]?.[1]).toBe(
      "/chat/completions",
    );
    const request = JSON.parse(
      engineMocks.engineFetch.mock.calls[0]?.[2].body as string,
    ) as { model: string; messages: Array<{ content: string }> };
    expect(request.model).toBe("seltra-fast");
    expect(request.messages.at(-1)?.content).toContain("Noire Atelier");
    expect(registryMocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: expect.arrayContaining([
          expect.objectContaining({
            question: "Which fashion collections should Noire Atelier feature?",
            type: "checkbox",
            shapes: "pages",
            options: ["Eveningwear", "Workwear", "Other"],
          }),
        ]),
      }),
      expect.any(String),
    );
  });

  it("retries invalid fast-model output once and fails explicitly", async () => {
    engineMocks.engineFetch.mockResolvedValue(generatedResponse([]));
    const ctx = {
      chatId: 1,
      dyadRequestId: "request-1",
      planningQuestionnairePrompt: "Build a fashion store.",
      enableAppBlueprint: true,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await expect(
      planningQuestionnaireTool.execute({ questions: [] }, ctx),
    ).rejects.toThrow("QUESTIONNAIRE_GENERATION_FAILED");
    expect(engineMocks.engineFetch).toHaveBeenCalledTimes(2);
    expect(ctx.planningQuestionnaireGenerationFailed).toBe(true);
    expect(registryMocks.request).not.toHaveBeenCalled();
  });

  it("returns blueprint shapes alongside the answers", async () => {
    registryMocks.park.mockResolvedValue({
      kind: "questionnaire",
      answers: { brand: "Noire Atelier", visuals: "Editorial" },
    });
    const ctx = {
      chatId: 1,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;
    const questions = [
      { ...question, id: "brand", shapes: "brand" as const },
      { ...question, id: "visuals", shapes: "imagery" as const },
      { ...question, id: "pages", shapes: "pages" as const },
    ];

    await expect(
      planningQuestionnaireTool.execute({ questions }, ctx),
    ).resolves.toContain("**[brand] What should this app do?**\nNoire Atelier");
    expect(registryMocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ questions }),
      expect.any(String),
    );
  });

  it("marks the turn after user answers successfully return", async () => {
    registryMocks.park.mockResolvedValue({
      kind: "questionnaire",
      answers: { product: "Minimal and calm" },
    });
    const ctx = {
      chatId: 1,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await planningQuestionnaireTool.execute(
      {
        questions: [
          {
            id: "product",
            type: "text",
            question: "What should this app feel like?",
          },
        ],
      },
      ctx,
    );

    expect(ctx.appBlueprintQuestionnaireCompleted).toBe(true);
  });

  it("does not mark the turn when the questionnaire is dismissed", async () => {
    registryMocks.park.mockResolvedValue({ kind: "declined" });
    const ctx = {
      chatId: 1,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await planningQuestionnaireTool.execute(
      { questions: [{ type: "text", question: "What should this app do?" }] },
      ctx,
    );

    expect(ctx.appBlueprintQuestionnaireCompleted).not.toBe(true);
  });
});

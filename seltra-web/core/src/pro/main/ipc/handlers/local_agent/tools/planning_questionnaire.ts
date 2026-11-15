import { z } from "zod";
import crypto from "node:crypto";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";
import { userInputRegistry } from "@/user_input/main";
import { persistQuestionnaire } from "@/user_input/questionnaire_journal";
import { engineFetch } from "./engine_fetch";
import {
  escapeXmlAttr,
  escapeXmlContent,
} from "../../../../../../../shared/xmlEscape";

const logger = log.scope("planning_questionnaire");

export const COMPLETED_PLANNING_QUESTIONNAIRE_RESULT_PREFIX =
  "User responses:\n\n";

const QuestionSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe(
        "Unique identifier for this question (auto-generated if omitted)",
      ),
    question: z.string().describe("The question text to display to the user"),
    type: z
      .enum(["text", "radio", "checkbox"])
      .describe(
        "text for free-form input, radio for single choice, checkbox for multiple choice",
      ),
    options: z
      .array(z.string())
      .min(1)
      .max(3)
      .optional()
      .describe(
        "Options for radio/checkbox questions. Keep to a maximum of 3 — users can always provide a custom answer via the free-form text input. Omit for text questions.",
      ),
    required: z
      .boolean()
      .optional()
      .describe("Whether this question requires an answer (defaults to true)"),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder text for text inputs"),
    shapes: z
      .enum([
        "brand",
        "palette",
        "pages",
        "content",
        "imagery",
        "features",
        "integrations",
      ])
      .optional()
      .describe(
        "Blueprint field informed by this question; required for initial app blueprints",
      ),
  })
  .refine((q) => q.type === "text" || (q.options && q.options.length >= 1), {
    message: "options are required for radio and checkbox questions",
    path: ["options"],
  });

const planningQuestionnaireSchema = z.object({
  questions: z
    .array(QuestionSchema)
    .max(5, "questions array must have at most 5 questions")
    .optional()
    .describe(
      "Optional fallback questions. When a user prompt is available, questions are generated and validated by Seltra's fast model instead.",
    ),
});

const GeneratedQuestionnaireSchema = z
  .object({
    questions: z
      .array(
        z.object({
          id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
          type: z.enum(["single", "multi", "text"]),
          prompt: z.string().trim().min(12).max(240),
          options: z
            .array(
              z.object({
                id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
                label: z.string().trim().min(1).max(80),
              }),
            )
            .max(3)
            .optional(),
          allowOther: z.boolean(),
          shapes: z.enum([
            "brand",
            "palette",
            "pages",
            "content",
            "imagery",
            "features",
            "integrations",
          ]),
        }),
      )
      .min(3)
      .max(5),
  })
  .superRefine(({ questions }, ctx) => {
    const ids = new Set<string>();
    const prompts = new Set<string>();
    for (const [index, question] of questions.entries()) {
      const normalizedPrompt = question.prompt
        .toLocaleLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      if (ids.has(question.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "id"],
          message: "question ids must be unique",
        });
      }
      if (prompts.has(normalizedPrompt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "prompt"],
          message: "question prompts must be distinct",
        });
      }
      ids.add(question.id);
      prompts.add(normalizedPrompt);
      if (question.type === "text" && question.options?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "options"],
          message: "text questions must not include options",
        });
      }
      if (
        question.type !== "text" &&
        (!question.options || question.options.length < 2)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "options"],
          message: "choice questions require 2-3 options",
        });
      }
      if (
        question.allowOther &&
        !question.options?.some(
          (option) => option.label.toLocaleLowerCase() === "other",
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", index, "options"],
          message: 'allowOther questions must include an "Other" option',
        });
      }
    }
  });

type GeneratedQuestion = z.infer<
  typeof GeneratedQuestionnaireSchema
>["questions"][number];

async function generateQuestionnaireQuestions(
  ctx: AgentContext,
): Promise<z.infer<typeof QuestionSchema>[]> {
  const prompt = ctx.planningQuestionnairePrompt?.trim();
  if (ctx.planningQuestionnaireGenerationFailed) {
    throw new Error(
      "QUESTIONNAIRE_GENERATION_FAILED: generation already failed for this turn.",
    );
  }
  if (!prompt) {
    ctx.planningQuestionnaireGenerationFailed = true;
    throw new Error(
      "QUESTIONNAIRE_GENERATION_FAILED: the current user prompt is unavailable.",
    );
  }

  let lastError = "No response from Seltra's fast model.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await engineFetch(ctx, "/chat/completions", {
        method: "POST",
        timeoutMs: 8_000,
        body: JSON.stringify({
          model: "seltra-fast",
          temperature: 0.2,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'Generate 3-5 concise, distinct, prompt-specific project questions before an app blueprint is created. Each question must refer to a concrete detail in the user request or resolve an important design/product choice for it. Avoid generic questions. Return only JSON matching {"questions":[{"id":"...","type":"single|multi|text","prompt":"...","options":[{"id":"...","label":"..."}],"allowOther":false,"shapes":"brand|palette|pages|content|imagery|features|integrations"}]}. Every question must have a unique id and a blueprint shape. Single/multi questions need 2-3 options; text questions omit options. If allowOther is true, include an option labeled Other.',
            },
            { role: "user", content: prompt },
            ...(attempt > 0
              ? [
                  {
                    role: "assistant" as const,
                    content: `The previous response was invalid: ${lastError}. Return corrected JSON only.`,
                  },
                ]
              : []),
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`fast model returned HTTP ${response.status}`);
      }
      const result = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const rawContent = result.choices?.[0]?.message?.content;
      const content =
        typeof rawContent === "string"
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent
                .map((part) =>
                  typeof part === "object" && part && "text" in part
                    ? String(part.text)
                    : "",
                )
                .join("")
            : "";
      const parsed = GeneratedQuestionnaireSchema.safeParse(
        JSON.parse(content),
      );
      if (!parsed.success) {
        throw new Error(
          `fast model returned invalid questionnaire data: ${parsed.error.issues
            .map((issue) => issue.message)
            .join("; ")}`,
        );
      }
      return parsed.data.questions.map((question) =>
        convertGeneratedQuestion(question),
      );
    } catch (error) {
      if (ctx.abortSignal?.aborted) throw error;
      lastError =
        error instanceof Error ? error.message : "unknown generation error";
      if (attempt === 0) {
        logger.warn(
          "Fast-model questionnaire generation failed validation or request; retrying once",
          lastError,
        );
      }
    }
  }

  ctx.planningQuestionnaireGenerationFailed = true;
  throw new Error(`QUESTIONNAIRE_GENERATION_FAILED: ${lastError}`);
}

function convertGeneratedQuestion(
  question: GeneratedQuestion,
): z.infer<typeof QuestionSchema> {
  return {
    id: question.id,
    question: question.prompt,
    type:
      question.type === "single"
        ? "radio"
        : question.type === "multi"
          ? "checkbox"
          : "text",
    ...(question.options
      ? {
          options: question.options.map((option) => option.label),
        }
      : {}),
    required: true,
    shapes: question.shapes,
  };
}

const DESCRIPTION = `Present a structured questionnaire to gather requirements from the user. The tool displays questions in the UI and waits for the user's responses, returning them as the tool result.

<when_to_use>
Use this tool when:
- Blueprint mode is enabled for a new app; in that case this tool is mandatory even when the request is concrete
- The request is vague or open-ended
- There are multiple reasonable interpretations
Skip only when blueprint mode is not enabled and the request is a specific, concrete change.
For an initial app blueprint, call this tool with an empty object. Seltra's fast model generates and validates 3-5 distinct questions grounded in the user's prompt and assigns each one a blueprint shape: brand, palette, pages, content, imagery, features, or integrations.
</when_to_use>

<input_schema>
For an initial app blueprint, call with an empty object; Core's fast model generates and validates the questions. For other clarification requests, provide a "questions" array.
</input_schema>

<correct_example>
{}
</correct_example>

<incorrect_examples>
WRONG — More than 5 fallback questions
WRONG — Providing generic, non-prompt-specific questions
</incorrect_examples>`;

export const planningQuestionnaireTool: ToolDefinition<
  z.infer<typeof planningQuestionnaireSchema>
> = {
  name: "planning_questionnaire",
  description: DESCRIPTION,
  inputSchema: planningQuestionnaireSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) =>
    args.questions?.length
      ? `Questionnaire (${args.questions.length} questions)`
      : "Questionnaire (fast-model generated)",

  execute: async (args, ctx: AgentContext) => {
    const mustGenerateQuestions =
      ctx.enableAppBlueprint === true &&
      !ctx.appBlueprintQuestionnaireCompleted;
    if (mustGenerateQuestions && ctx.appBlueprintQuestionnaireSkipped) {
      ctx.appBlueprintQuestionnaireCompleted = true;
      ctx.onXmlComplete(
        '<dyad-status title="Questionnaire skipped" state="warning">The user chose to skip questions. No preferences or answers were assumed.</dyad-status>',
      );
      return "The user explicitly chose to skip questions. Continue using the original request and do not invent answers or preferences.";
    }
    const questions = mustGenerateQuestions
      ? await generateQuestionnaireQuestions(ctx)
      : args.questions;
    if (!questions?.length) {
      throw new Error(
        "QUESTIONNAIRE_GENERATION_FAILED: no user prompt or questions were available.",
      );
    }

    if (
      ctx.enableAppBlueprint === true &&
      !ctx.appBlueprintQuestionnaireCompleted &&
      ctx.planningQuestionnaireAvailable !== false &&
      (questions.length < 3 || questions.some((question) => !question.shapes))
    ) {
      throw new Error(
        "The initial app blueprint questionnaire requires 3 to 5 prompt-specific questions, each mapped to a blueprint shape. Generate at least three distinct, mapped questions before presenting it.",
      );
    }

    // Auto-generate missing IDs
    const normalizedQuestions = questions.map((q) => ({
      ...q,
      id: q.id || `q_${crypto.randomUUID().slice(0, 8)}`,
    }));

    const requestId = crypto.randomUUID();
    if (ctx.persistQuestionnaireRecovery)
      await persistQuestionnaire({
        requestId,
        chatId: ctx.chatId,
        questions: normalizedQuestions,
        outcome: "pending",
      });
    ctx.onXmlComplete(
      `<dyad-status title="Questionnaire requested" state="finished">${escapeXmlContent(normalizedQuestions.map((q) => q.question).join("\n"))}</dyad-status>`,
    );
    userInputRegistry.request(
      {
        kind: "questionnaire",
        requiresRecovery: ctx.persistQuestionnaireRecovery === true,
        chatId: ctx.chatId,
        questions: normalizedQuestions,
        classifier: "none",
      },
      requestId,
    );

    logger.log(
      `Presenting questionnaire (${normalizedQuestions.length} questions), requestId: ${requestId}`,
    );

    const result = await userInputRegistry.park(requestId, ctx.abortSignal);
    const answers = result?.kind === "questionnaire" ? result.answers : null;

    if (!answers) {
      ctx.onXmlComplete(
        `<dyad-status title="Questionnaire closed" state="warning">${ctx.abortSignal?.aborted ? "Cancelled. No answers were submitted." : "Dismissed or interrupted. No answers were submitted."}</dyad-status>`,
      );
      return "The user dismissed the questionnaire without answering. Ask them how they'd like to proceed, or try asking questions in regular chat text.";
    }

    ctx.appBlueprintQuestionnaireCompleted = true;

    const formattedAnswers = normalizedQuestions
      .map((q) => {
        const answer = answers[q.id] || "(no answer)";
        return `**[${q.shapes || "content"}] ${q.question}**\n${answer}`;
      })
      .join("\n\n");

    // Build XML with questions and answers for the chat UI
    const qaEntries = normalizedQuestions
      .map((q) => {
        const answer = answers[q.id] || "(no answer)";
        return `<qa question="${escapeXmlAttr(q.question)}" type="${escapeXmlAttr(q.type)}"${q.shapes ? ` shapes="${escapeXmlAttr(q.shapes)}"` : ""}>${escapeXmlContent(answer)}</qa>`;
      })
      .join("\n");

    ctx.onXmlComplete(
      `<dyad-questionnaire count="${normalizedQuestions.length}">\n${qaEntries}\n</dyad-questionnaire>`,
    );

    return `${COMPLETED_PLANNING_QUESTIONNAIRE_RESULT_PREFIX}${formattedAnswers}`;
  },
};

import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "An optional Explorer fixture is unavailable, then the root continues with a basic app edit",
  turns: [
    {
      text: "I’ll ask an optional specialist for a quick review.",
      toolCalls: [
        {
          name: "spawn_agent",
          args: {
            persona: "explorer",
            task_name: "Optional design review",
            assignment: "tc=local-agent/experiment2-specialist-fails",
            scope: ["src"],
          },
        },
      ],
    },
    {
      text: "The optional review was unavailable, so I’ll continue the requested implementation.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/optional-specialist-fallback.ts",
            content: "export const implementationContinued = true;\n",
            description:
              "Continue the basic implementation after optional review failure",
          },
        },
      ],
    },
    {
      text: "The requested implementation is complete; the optional specialist was unavailable.",
    },
  ],
};

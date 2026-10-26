import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Run Phase 4 checks through Dyad's host-owned browser tool",
  turns: [
    {
      toolCalls: [
        {
          name: "run_tests",
          args: {
            testFiles: ["e2e-tests/experiment2-visual.spec.ts"],
          },
        },
      ],
    },
    { text: "The host browser verification report has been recorded." },
  ],
};

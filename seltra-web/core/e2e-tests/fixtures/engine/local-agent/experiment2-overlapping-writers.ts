import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "The host refuses a task plan that activates agents with overlapping writer scopes",
  turns: [
    {
      text: "I will start the two independent implementation tasks.",
      toolCalls: [
        {
          name: "write_experiment_artifacts",
          args: {
            artifacts: [
              {
                kind: "implementation_plan",
                status: "ready",
                content: {
                  tasks: [
                    {
                      id: "edit_home",
                      title: "Edit the home page",
                      dependsOn: [],
                      writerScope: ["src/App.tsx"],
                      status: "in_progress",
                    },
                    {
                      id: "edit_home_copy",
                      title: "Edit the home page copy",
                      dependsOn: [],
                      writerScope: ["src"],
                      status: "in_progress",
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
    {
      text: "The host rejected the overlapping writer scopes, so no conflicting work started.",
    },
  ],
};

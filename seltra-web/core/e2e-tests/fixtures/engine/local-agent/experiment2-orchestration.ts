import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

const implementationPlan = {
  kind: "implementation_plan",
  status: "ready",
  content: {
    tasks: [
      {
        id: "build_home",
        title: "Build the requested home page",
        dependsOn: [],
        writerScope: ["src/App.tsx"],
        status: "pending",
      },
    ],
  },
} as const;

export const fixture: LocalAgentFixture = {
  description:
    "Persist a plan, build through Dyad, and record evidence-backed completion",
  turns: [
    {
      text: "I’ll clarify the request and plan the implementation before editing.",
      toolCalls: [
        {
          name: "write_experiment_artifacts",
          args: {
            artifacts: [
              {
                kind: "business_brief",
                status: "ready",
                content: {
                  business: "A minimal personal portfolio",
                  audience: ["Prospective clients"],
                  goals: ["Present a clear welcome message"],
                  entities: ["Portfolio owner"],
                  journeys: ["Open the home page and read the introduction"],
                  constraints: ["Use Dyad's existing app source"],
                  unknowns: [],
                },
              },
              {
                kind: "requirements_spec",
                status: "ready",
                content: {
                  criteria: [
                    {
                      id: "welcome",
                      criterion: "The home page shows the portfolio welcome message",
                      status: "planned",
                    },
                  ],
                },
              },
              implementationPlan,
              {
                kind: "design_spec",
                status: "ready",
                content: {
                  brandPositioning: "Approachable software portfolio",
                  audience: ["Prospective clients"],
                  emotionalResponse: ["Clear and welcoming"],
                  pageHierarchy: ["Introduction", "Contact action"],
                  routes: ["/"],
                  compositions: ["A concise centered introduction"],
                  typography: ["Readable sans-serif headings and body text"],
                  palette: ["Use the existing app palette"],
                  spacingAndSurfaces: ["Clear spacing between content groups"],
                  artDirection: ["No decorative artwork is required"],
                  responsiveBehavior: ["Keep the introduction readable on mobile"],
                  accessibility: ["Maintain semantic headings and keyboard access"],
                  interactionStates: ["Contact action remains operable"],
                  antiPatterns: ["Avoid fixed-width overflow"],
                  acceptanceCriteria: ["The introduction is visible on the home route"],
                },
              },
            ],
          },
        },
      ],
    },
    {
      text: "The dependency-ready page task can now begin.",
      toolCalls: [
        {
          name: "write_experiment_artifacts",
          args: {
            artifacts: [
              {
                ...implementationPlan,
                content: {
                  tasks: [
                    { ...implementationPlan.content.tasks[0], status: "in_progress" },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
    {
      text: "I’ll implement the page with Dyad’s existing file tools.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/App.tsx",
            content: "const App = () => <main><h1>Welcome to my portfolio</h1></main>;\n\nexport default App;\n",
            description: "Create the planned welcome message",
          },
        },
      ],
    },
    {
      text: "The welcome page is implemented; I’ll record the file evidence.",
      toolCalls: [
        {
          name: "write_experiment_artifacts",
          args: {
            artifacts: [
              {
                ...implementationPlan,
                content: {
                  tasks: [
                    {
                      ...implementationPlan.content.tasks[0],
                      status: "completed",
                      evidence: "src/App.tsx contains the Welcome to my portfolio heading.",
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

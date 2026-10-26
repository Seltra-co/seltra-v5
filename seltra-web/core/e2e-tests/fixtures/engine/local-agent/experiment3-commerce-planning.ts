import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description:
    "Classify a demo storefront and save only its required commerce workflows",
  turns: [
    {
      text: "I’ll map the requested storefront workflows and mark production services as unconfigured.",
      toolCalls: [
        {
          name: "write_experiment_artifacts",
          args: {
            artifacts: [
              {
                kind: "commerce_spec",
                status: "ready",
                content: {
                  relevantWorkflows: [
                    "catalog",
                    "variants",
                    "inventory",
                    "cart",
                    "checkout",
                    "pickup",
                  ],
                  acceptanceCriteria: [
                    "Customers can select an in-stock product variant and add it to the cart.",
                    "Customers can complete a clearly labeled demo checkout and choose store pickup.",
                  ],
                  demoBehaviors: [
                    "Checkout shows a local demo confirmation without processing a payment.",
                  ],
                  productionIntegrations: [
                    { name: "Payment processing", status: "unconfigured" },
                    { name: "Live inventory sync", status: "unconfigured" },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
    {
      text: "The commerce workflow spec is recorded with demo behavior separated from production integrations.",
    },
  ],
};

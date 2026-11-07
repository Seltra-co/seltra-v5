import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentStreamStatus } from "../../../frontend/components/dashboard/AgentStreamStatus";

afterEach(cleanup);

describe("agent stream surface", () => {
  it("shows an assistant skeleton immediately, then one status surface without elapsed copy", () => {
    const { rerender, container } = render(<AgentStreamStatus skeleton />);
    expect(screen.getByRole("status", { name: "Seltra response" })).toBeTruthy();
    expect(screen.getByLabelText("Seltra is preparing a response")).toBeTruthy();
    rerender(<AgentStreamStatus status="Planning a services storefront for WorkBench in Accra" phase="narrating" />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Planning a services storefront for WorkBench in Accra")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\belapsed\b|still waiting/i);
  });

  it("inserts the optimistic assistant placeholder and opens preview before awaiting Core", () => {
    const source = readFileSync(resolve(__dirname, "../../../frontend/app/(dashboard)/dashboard/page.tsx"), "utf8");
    const start = source.indexOf("const send = async () => {");
    const end = source.indexOf("const resetProjectSurface =", start);
    const send = source.slice(start, end);
    expect(send.indexOf("setPreviewOpen(true)")).toBeGreaterThanOrEqual(0);
    expect(send.indexOf("setMsgs((current) =>")).toBeGreaterThanOrEqual(0);
    expect(send.indexOf("setMsgs((current) =>")).toBeLessThan(send.indexOf("openCoreBuilder({ prompt: corePrompt"));
    expect(send).toMatch(/role: 'assistant', content: ''/);
    expect(source).not.toMatch(/elapsed|Still waiting/i);
  });

  it("keeps workspace creation and destruction out of the Approve handler", () => {
    const source = readFileSync(resolve(__dirname, "../../../frontend/app/(dashboard)/dashboard/page.tsx"), "utf8");
    const start = source.indexOf("const approveCoreBlueprint = async () => {");
    const end = source.indexOf("const recoverCorePreview =", start);
    expect(start).toBeGreaterThanOrEqual(0);
    const approval = source.slice(start, end);
    expect(approval).not.toMatch(/create-workspace|destroy-workspace|createWorkspace|destroyWorkspace/i);
  });
});

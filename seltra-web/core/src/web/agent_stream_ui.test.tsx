import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentStreamStatus } from "../../../frontend/components/dashboard/AgentStreamStatus";
import { WorkbenchPreviewDock } from "../../../frontend/components/dashboard/WorkbenchPreviewDock";
import { WorkbenchPreviewSurface } from "../../../frontend/components/dashboard/WorkbenchPreviewSurface";
import { DEV_STREAM_REPLAY, replayWorkbench, transitionWorkbench, type WorkbenchState } from "../../../frontend/lib/workbench/stream-store";

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

  it("inserts the optimistic assistant placeholder before awaiting Core and starts chat-wide", () => {
    const source = readFileSync(resolve(__dirname, "../../../frontend/app/(dashboard)/dashboard/page.tsx"), "utf8");
    const start = source.indexOf("const send = async () => {");
    const end = source.indexOf("const resetProjectSurface =", start);
    const send = source.slice(start, end);
    expect(send.indexOf("setMsgs((current) =>")).toBeGreaterThanOrEqual(0);
    expect(send.indexOf("setMsgs((current) =>")).toBeLessThan(send.indexOf("openCoreBuilder({ prompt: corePrompt"));
    expect(send).toMatch(/role: 'assistant', content: ''/);
    expect(send).toMatch(/type: 'send', keepSplit: Boolean\(corePreviewUrl\)/);
    const optimistic = send.slice(0, send.indexOf("const replayRequested ="));
    expect(optimistic).not.toMatch(/setPreviewOpen\(true\)/);
    expect(source).not.toMatch(/elapsed|Still waiting/i);
  });

  it("omits the preview pane in chat-wide and keeps its subtree mounted when split opens", () => {
    const { rerender } = render(<WorkbenchPreviewDock open={false}><span data-testid="persistent-preview">preview</span></WorkbenchPreviewDock>);
    expect(screen.queryByTestId("preview-pane")).toBeNull();
    expect(screen.getByTestId("persistent-preview")).toBeTruthy();
    rerender(<WorkbenchPreviewDock open={true}><span data-testid="persistent-preview">preview</span></WorkbenchPreviewDock>);
    expect(screen.getByTestId("preview-pane")).toBeTruthy();
    expect(screen.getByTestId("persistent-preview")).toBeTruthy();
  });

  it("shows questionnaire waiting copy without elapsed or connecting text", () => {
    render(<WorkbenchPreviewSurface questionnaire planReady={false} replay tip={0} paused={false} dismissed={false} onPause={() => {}} onDismiss={() => {}} onTip={() => {}} />);
    expect(screen.getByText("Waiting for you — answer in the chat to continue.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/elapsed|connecting/i);
  });

  it("replays the full stream through question, build, and live preview states", async () => {
    let state: WorkbenchState = { layout: 'chat-wide', phase: 'idle', projectName: '', intent: '', currentStep: '', steps: [], questionnaire: false, tipDismissed: false, previewUrl: '', error: '' };
    const seen: string[] = [];
    await replayWorkbench(DEV_STREAM_REPLAY, async (event) => {
      state = transitionWorkbench(state, event);
      seen.push(state.layout);
    }, async () => {});
    expect(seen).toContain('chat-wide');
    expect(seen).toContain('split');
    expect(state).toMatchObject({ layout: 'live', phase: 'ready', projectName: 'Service Catalog' });
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

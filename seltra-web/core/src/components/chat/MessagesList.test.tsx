import { Provider, createStore } from "jotai";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { OptimisticChatMessages } from "@/chat_stream/optimistic_messages";
import { MessagesList } from "./MessagesList";

const state = vi.hoisted(() => ({
  manager: {} as { optimisticMessages: OptimisticChatMessages },
}));
vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => state.manager,
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ isStreaming: true, streamMessage: vi.fn() }),
}));
vi.mock("@/hooks/useVersions", () => ({
  useVersions: () => ({ refreshVersions: vi.fn() }),
}));
vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({
    state: { type: "idle" },
    projection: { capabilities: { canRestore: false } },
    sendAndWaitForMutation: vi.fn(),
  }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { isTestMode: true } }),
}));
vi.mock("@/hooks/useChatMode", () => ({
  useChatMode: (chatId: number) => ({
    chat: { executionBackend: chatId === 2 ? "claude-code" : "dyad" },
  }),
}));
vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    isAnyProviderSetup: () => true,
    isProviderSetup: () => true,
  }),
}));
vi.mock("@/user_input/hooks", () => ({
  useUserInputRequests: () => new Map(),
}));
vi.mock("./ChatMessage", () => ({
  default: ({
    message,
    executionBackend,
  }: {
    message: { content: string };
    executionBackend?: string;
  }) => <div data-backend={executionBackend}>{message.content}</div>,
}));
vi.mock("./ModifiedFilesCard", () => ({ ModifiedFilesCard: () => null }));
vi.mock("./ExtraCommitsRevertDialog", () => ({
  ExtraCommitsRevertDialog: () => null,
}));
vi.mock("../SetupBanner", () => ({
  SetupBanner: () => null,
  OpenRouterSetupBanner: () => null,
}));

it("uses the rendered chat during navigation before global selection catches up", () => {
  window.__SELTRA_WEB__ = true;
  const store = createStore();
  store.set(selectedChatIdAtom, 1);
  const optimisticMessages = new OptimisticChatMessages();
  state.manager = { optimisticMessages };
  optimisticMessages.add("pending-a", { chatId: 1, prompt: "Pending in A" });
  const view = render(
    <Provider store={store}>
      <MessagesList chatId={1} messages={[]} />
    </Provider>,
  );
  expect(screen.getByText("Pending in A")).toBeTruthy();
  expect(screen.queryByTestId("chat-starting-status")).toBeNull();
  view.rerender(
    <Provider store={store}>
      <MessagesList
        chatId={2}
        messages={[{ id: 20, role: "user", content: "History in B" }]}
      />
    </Provider>,
  );
  expect(store.get(selectedChatIdAtom)).toBe(1);
  expect(screen.getByText("History in B").getAttribute("data-backend")).toBe(
    "claude-code",
  );
  expect(screen.queryByText("Pending in A")).toBeNull();
  view.rerender(
    <Provider store={store}>
      <MessagesList chatId={1} messages={[]} />
    </Provider>,
  );
  expect(screen.getByText("Pending in A")).toBeTruthy();
  view.unmount();
  optimisticMessages.dispose();
});

it("keeps a web transcript empty while the first prompt is being accepted", () => {
  window.__SELTRA_WEB__ = true;
  const store = createStore();
  state.manager = { optimisticMessages: new OptimisticChatMessages() };
  render(
    <Provider store={store}>
      <MessagesList chatId={1} messages={[]} />
    </Provider>,
  );
  expect(screen.queryByTestId("chat-starting-status")).toBeNull();
  expect(screen.queryByText("No messages yet")).toBeNull();
});

it("shows an accepted first prompt while the web response is starting", () => {
  window.__SELTRA_WEB__ = true;
  const store = createStore();
  store.set(selectedChatIdAtom, 1);
  const optimisticMessages = new OptimisticChatMessages();
  state.manager = { optimisticMessages };
  optimisticMessages.add("first-prompt", {
    chatId: 1,
    prompt: "Build an online shop",
    showOptimisticMessage: true,
  });

  render(
    <Provider store={store}>
      <MessagesList chatId={1} messages={[]} />
    </Provider>,
  );

  expect(screen.getByText("Build an online shop")).toBeTruthy();
  expect(screen.queryByText("No messages yet")).toBeNull();
  optimisticMessages.dispose();
});

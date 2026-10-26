import { Provider, createStore } from "jotai";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { chatInputValueAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import ChatMessage from "./ChatMessage";

const mocks = vi.hoisted(() => ({
  copyMessageContent: vi.fn(),
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ isStreaming: true }),
}));
vi.mock("@/hooks/useChatStream", () => ({
  useChatStreamHasPreview: () => false,
}));
vi.mock("@/hooks/useVersions", () => ({
  useVersions: () => ({ versions: [] }),
}));
vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({
    state: { type: "idle" },
    projection: { capabilities: { canRestore: false } },
    send: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({
    copyMessageContent: mocks.copyMessageContent,
    copied: false,
  }),
}));
vi.mock("./DyadMarkdownParser", () => ({
  DyadMarkdownParser: () => null,
  VanillaMarkdownParser: ({ content }: { content: string }) => <>{content}</>,
}));

afterEach(() => {
  window.__SELTRA_WEB__ = false;
  vi.clearAllMocks();
});

it("renders the pending web prompt, timestamp, actions, and response indicator", () => {
  window.__SELTRA_WEB__ = true;
  const store = createStore();
  store.set(selectedChatIdAtom, 1);
  const view = render(
    <Provider store={store}>
      <ChatMessage
        message={{
          id: -1,
          role: "user",
          content: "Build an online shop",
          createdAt: "2000-01-01T00:00:00.000Z",
        }}
        isLastMessage
      />
    </Provider>,
  );

  expect(screen.getByText("Build an online shop")).toBeTruthy();
  expect(screen.getByTestId("user-message-timestamp").textContent).toBeTruthy();
  expect(screen.getByTestId("copy-prompt-button")).toBeTruthy();
  expect(screen.getByTestId("edit-prompt-button")).toBeTruthy();
  expect(screen.getByTestId("chat-starting-status")).toBeTruthy();

  fireEvent.click(screen.getByTestId("copy-prompt-button"));
  expect(mocks.copyMessageContent).toHaveBeenCalledWith("Build an online shop");

  fireEvent.click(screen.getByTestId("edit-prompt-button"));
  expect(store.get(chatInputValueAtom)).toBe("Build an online shop");
  view.unmount();
});

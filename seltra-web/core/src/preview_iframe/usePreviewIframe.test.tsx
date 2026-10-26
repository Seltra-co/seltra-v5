import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AppRunRemoteProvider } from "@/app_run/AppRunRemoteProvider";
import { AppRunRemoteManager } from "@/app_run/remote_manager";
import { TestAppRunRemoteConnection } from "@/app_run/testing";
import type { AppRunInvocationRef } from "@/app_run/state";
import { createSequentialIdSource } from "@/state_machines/testing";
import {
  EntityDisposalProvider,
  useEntityDisposal,
} from "@/state_machines/react";
import {
  INITIAL_PREVIEW_IFRAME_STATE,
  selectIframeSrc,
} from "./state";
import { PreviewIframeProvider } from "./PreviewIframeProvider";
import {
  isPreviewAuthExpiredMessage,
  usePreviewIframeController,
  useSendPreviewIframeEvent,
} from "./usePreviewIframe";
import {
  PreviewErrorFacadeProvider,
  usePreviewErrorFacade,
} from "@/app_wiring/preview_error_facade";

function makeWrapper(store = createStore()) {
  const connection = new TestAppRunRemoteConnection();
  const appRunManager = new AppRunRemoteManager(
    createSequentialIdSource(),
    connection,
  );
  // Establish the app-specific remote subscription that production
  // useAppRunState consumers create.
  appRunManager.subscribeKey(1, () => undefined);
  return {
    appRunManager,
    connection,
    Wrapper({ children }: { children: ReactNode }) {
      return (
        <EntityDisposalProvider>
          <Provider store={store}>
            <PreviewErrorFacadeProvider>
              <AppRunRemoteProvider manager={appRunManager}>
                <PreviewIframeProvider appRunState={appRunManager}>
                  {children}
                </PreviewIframeProvider>
              </AppRunRemoteProvider>
            </PreviewErrorFacadeProvider>
          </Provider>
        </EntityDisposalProvider>
      );
    },
  };
}

describe("isPreviewAuthExpiredMessage", () => {
  const appUrl =
    "https://app-1.commerce.seltra.co/?preview_token=handoff-token";

  it("accepts only the current iframe origin and app label", () => {
    const event = new MessageEvent("message", {
      origin: "https://app-1.commerce.seltra.co",
      source: window,
      data: {
        type: "seltra:preview-auth-expired",
        label: "app-1",
      },
    });

    expect(isPreviewAuthExpiredMessage(event, window, appUrl, 1)).toBe(true);
    expect(isPreviewAuthExpiredMessage(event, window, appUrl, 2)).toBe(false);
    expect(
      isPreviewAuthExpiredMessage(event, window, appUrl, null),
    ).toBe(false);
  });

  it("rejects messages from another origin, window, or message type", () => {
    const message = {
      type: "seltra:preview-auth-expired",
      label: "app-1",
    };
    const wrongOrigin = new MessageEvent("message", {
      origin: "https://attacker.example",
      source: window,
      data: message,
    });
    const wrongWindow = new MessageEvent("message", {
      origin: "https://app-1.commerce.seltra.co",
      source: null,
      data: message,
    });
    const wrongType = new MessageEvent("message", {
      origin: "https://app-1.commerce.seltra.co",
      source: window,
      data: { ...message, type: "unrelated" },
    });

    expect(isPreviewAuthExpiredMessage(wrongOrigin, window, appUrl, 1)).toBe(
      false,
    );
    expect(isPreviewAuthExpiredMessage(wrongWindow, window, appUrl, 1)).toBe(
      false,
    );
    expect(isPreviewAuthExpiredMessage(wrongType, window, appUrl, 1)).toBe(
      false,
    );
  });
});

describe("selectIframeSrc", () => {
  it("replaces a stale handoff token while preserving the active preview route", () => {
    const state = {
      ...INITIAL_PREVIEW_IFRAME_STATE,
      currentUrl:
        "https://app-1.commerce.seltra.co/settings?tab=profile&preview_token=old",
      preservedUrl:
        "https://app-1.commerce.seltra.co/settings?tab=profile&preview_token=old",
    };

    expect(
      selectIframeSrc(
        state,
        "https://app-1.commerce.seltra.co/?preview_token=fresh",
      ),
    ).toBe(
      "https://app-1.commerce.seltra.co/settings?tab=profile&preview_token=fresh",
    );
  });
});

describe("useSendPreviewIframeEvent", () => {
  it("does not subscribe the caller to preview iframe state changes", () => {
    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount += 1;
        return useSendPreviewIframeEvent(1);
      },
      { wrapper: makeWrapper().Wrapper },
    );
    const initialRenderCount = renderCount;

    act(() => result.current({ type: "SELECTOR_READY" }));

    expect(renderCount).toBe(initialRenderCount);
  });

  it.each(["restart", "rebuild"] as const)(
    "resets preserved navigation when a %s begins",
    async (operation) => {
      const store = createStore();
      const { Wrapper, connection } = makeWrapper(store);
      const { result } = renderHook(() => usePreviewIframeController(1), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.send({
          type: "APP_URL_CHANGED",
          url: "http://localhost:3000",
        });
        result.current.send({
          type: "NAVIGATED_IN_APP",
          kind: "pushState",
          url: "http://localhost:3000/about",
        });
      });
      expect(result.current.state.currentUrl).toBe(
        "http://localhost:3000/about",
      );

      await act(async () => {
        connection.publishStarting(1, `${operation}-1`, operation, 1_000);
      });

      await vi.waitFor(() => {
        expect(result.current.state).toMatchObject({
          history: [],
          currentUrl: null,
          preservedUrl: null,
        });
      });
    },
  );

  it("clears restart dedupe metadata when the app is disposed", async () => {
    const store = createStore();
    const { Wrapper, appRunManager, connection } = makeWrapper(store);
    const { result } = renderHook(
      () => ({
        preview: usePreviewIframeController(1),
        entityDisposal: useEntityDisposal(),
      }),
      { wrapper: Wrapper },
    );
    const invocationRef: AppRunInvocationRef = {
      kind: "app-run",
      entityKey: 1,
      operationId: "reused-operation",
    };

    await act(async () => {
      connection.publishStarting(
        1,
        invocationRef.operationId,
        "restart",
        1_000,
      );
      await Promise.resolve();
    });
    act(() => {
      result.current.preview.send({
        type: "APP_URL_CHANGED",
        url: "http://localhost:3000",
      });
      result.current.preview.send({
        type: "NAVIGATED_IN_APP",
        kind: "pushState",
        url: "http://localhost:3000/about",
      });
    });
    expect(result.current.preview.state.currentUrl).toBe(
      "http://localhost:3000/about",
    );

    await act(async () => {
      result.current.entityDisposal.disposeForApp(1);
      appRunManager.subscribeKey(1, () => undefined);
      connection.publishStarting(
        1,
        invocationRef.operationId,
        "restart",
        2_000,
      );
    });
    await vi.waitFor(() => {
      expect(appRunManager.getSnapshot(1).phase).toBe("starting");
      expect(result.current.preview.state.currentUrl).toBeNull();
    });

    expect(result.current.preview.state).toMatchObject({
      history: [],
      currentUrl: null,
      preservedUrl: null,
    });
  });

  it("does not recreate preview state from queued or late errors after disposal", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({
        preview: usePreviewIframeController(1),
        previewErrors: usePreviewErrorFacade(),
        entityDisposal: useEntityDisposal(),
      }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      result.current.previewErrors.setAppError(1, "queued");
      result.current.entityDisposal.disposeForApp(1);
      await Promise.resolve();
      result.current.previewErrors.setSyncError(1, "late");
      await Promise.resolve();
    });

    expect(result.current.preview.state.error).toBeUndefined();
  });
});

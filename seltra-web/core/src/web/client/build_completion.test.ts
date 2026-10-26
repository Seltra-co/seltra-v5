import { afterEach, expect, it, vi } from "vitest";
import {
  isWebBuildComplete,
  markWebBuildComplete,
  SELTRA_BUILD_COMPLETE_EVENT,
} from "./build_completion";

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

it("persists build completion by app and notifies mounted preview listeners", () => {
  const listener = vi.fn();
  window.addEventListener(SELTRA_BUILD_COMPLETE_EVENT, listener);

  expect(isWebBuildComplete(4)).toBe(false);
  markWebBuildComplete(4);

  expect(isWebBuildComplete(4)).toBe(true);
  expect(isWebBuildComplete(5)).toBe(false);
  expect(listener).toHaveBeenCalledOnce();
  expect(listener.mock.calls[0][0]).toMatchObject({ detail: { appId: 4 } });
  window.removeEventListener(SELTRA_BUILD_COMPLETE_EVENT, listener);
});

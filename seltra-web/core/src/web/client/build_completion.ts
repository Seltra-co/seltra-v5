export const SELTRA_BUILD_COMPLETE_EVENT = "seltra:web-build-complete";

function completionKey(appId: number): string {
  return `seltra:web-build-complete:${appId}`;
}

export function markWebBuildComplete(appId: number): void {
  try {
    window.sessionStorage.setItem(completionKey(appId), "1");
  } catch {
    // The event still reaches a mounted preview when storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent(SELTRA_BUILD_COMPLETE_EVENT, { detail: { appId } }),
  );
}

export function isWebBuildComplete(appId: number): boolean {
  try {
    return window.sessionStorage.getItem(completionKey(appId)) === "1";
  } catch {
    return false;
  }
}

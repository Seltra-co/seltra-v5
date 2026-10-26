/** Browser-specific capability flags for the existing desktop renderer. */
export const isWeb =
  typeof window !== "undefined" &&
  (window as Window & { __SELTRA_WEB__?: boolean }).__SELTRA_WEB__ === true;

/** Read the web flag at the point of use for paths that can run during startup. */
export function isWebRuntimeEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as Window & { __SELTRA_WEB__?: boolean }).__SELTRA_WEB__ === true
  );
}

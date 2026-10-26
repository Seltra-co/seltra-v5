/** Web-only Seltra wording; desktop labels remain owned by the renderer. */
export function webBrandText(dyad: string): string {
  return typeof window !== "undefined" && window.__SELTRA_WEB__
    ? dyad.replace(/Dyad/g, "Seltra")
    : dyad;
}

export function applyWebBranding(): void {
  if (typeof window !== "undefined" && window.__SELTRA_WEB__) {
    document.title = "Seltra Builder";
  }
}

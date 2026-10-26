/** Validate and open renderer initiated links without involving the host process. */
export function parseWebExternalUrl(value: unknown): URL {
  if (typeof value !== "string") {
    throw new Error("Only HTTP and HTTPS links can be opened.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Only HTTP and HTTPS links can be opened.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links can be opened.");
  }
  return url;
}

export function openWebExternalUrl(
  value: unknown,
  preopenedWindow?: Window | null,
): void {
  const url = parseWebExternalUrl(value);
  if (preopenedWindow) {
    preopenedWindow.opener = null;
    preopenedWindow.location.replace(url.href);
    return;
  }
  window.open(url.href, "_blank", "noopener,noreferrer");
}

import { useEffect, useState } from "react";

type ConnectionEvent = CustomEvent<{ status?: "connecting" | "connected" }>;

export function WebConnectionBanner() {
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (window.__SELTRA_WEB__ !== true) return;
    const onConnection = (event: Event) => {
      setReconnecting((event as ConnectionEvent).detail?.status !== "connected");
    };
    window.addEventListener("seltra:web-connection", onConnection);
    return () =>
      window.removeEventListener("seltra:web-connection", onConnection);
  }, []);

  if (!reconnecting || window.__SELTRA_WEB__ !== true) return null;

  return (
    <div
      className="fixed left-1/2 top-2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-md border bg-background px-4 py-2 text-sm shadow-md"
      role="status"
      aria-live="polite"
      data-testid="web-connection-banner"
    >
      <span>Connection lost. Reconnecting…</span>
      <button
        type="button"
        className="font-medium text-primary underline underline-offset-2"
        onClick={() =>
          window.dispatchEvent(new Event("seltra:web-retry-connection"))
        }
      >
        Retry
      </button>
    </div>
  );
}

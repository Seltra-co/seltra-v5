/**
 * seltra-sw-register.js – Service Worker registration script
 * This script is injected into the HTML to register the Service Worker
 * and forward messages to the parent window
 */

(function () {
  // Check if Service Workers are supported
  if (!("serviceWorker" in navigator)) {
    console.warn("[Seltra] Service Workers are not supported in this browser");
    return;
  }

  async function registerSeltraServiceWorker() {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const legacyRegistrations = registrations.filter((registration) =>
        [registration.active, registration.waiting, registration.installing]
          .filter(Boolean)
          .some((worker) => worker.scriptURL.endsWith("dyad-sw.js")),
      );
      await Promise.all(
        legacyRegistrations.map((registration) => registration.unregister()),
      );

      const registration = await navigator.serviceWorker.register(
        "/seltra-sw.js",
        { scope: "/" },
      );
      console.log("[Seltra] Service Worker registered:", registration.scope);
      registration.addEventListener("updatefound", () => {
        console.log("[Seltra] Service Worker update found");
      });
    } catch (error) {
      console.error("[Seltra] Service Worker registration failed:", error);
    }
  }

  registerSeltraServiceWorker();

  // Listen for messages from the Service Worker
  navigator.serviceWorker.addEventListener("message", (event) => {
    // Forward all messages to the parent window
    try {
      window.parent.postMessage(event.data, "*");
    } catch (e) {
      console.error("[Seltra] Failed to forward message to parent:", e);
    }
  });

  // Also listen for messages from the active Service Worker controller
  if (navigator.serviceWorker.controller) {
    console.log("[Seltra] Service Worker controller already active");
  }
})();

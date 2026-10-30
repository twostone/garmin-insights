/// <reference types="vite-plugin-pwa/client" />
// Service worker registration, external mode only (the layout calls this after sign-in). `virtual:pwa-register` is the
// vite-pwa helper; with `registerType: "autoUpdate"` a new version activates itself on the next load.
export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  } catch {
    // no service worker support or blocked storage: the app works without it, just not offline
  }
}

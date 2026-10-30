import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import { SvelteKitPWA } from "@vite-pwa/sveltekit";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

// MapLibre 6 runs its tile worker from a separate ES module that imports a second file. Both are served as plain static
// files next to the app (`maplibre/…`), and MapView.svelte points MapLibre at them relative to <base href>: a bundler-made
// URL would be root-absolute and break under the ingress path prefix.
const MAPLIBRE_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
const maplibreWorker = (): Plugin => ({
  name: "maplibre-worker-files",
  apply: "build",
  generateBundle() {
    for (const file of MAPLIBRE_FILES) {
      this.emitFile({ type: "asset", fileName: `maplibre/${file}`, source: readFileSync(new URL(`./node_modules/maplibre-gl/dist/${file}`, import.meta.url)) });
    }
  },
});

export default defineConfig({
  plugins: [
    sveltekit(),
    maplibreWorker(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./web/src/lib/paraglide",
      emitTsDeclarations: true,
      // Language from the browser; the user can override it in the settings (kept in localStorage).
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
    }),
    // The service worker and the manifest exist in the build, but the server hands them out on the external listener only
    // (src/listeners/shared.ts), and the app registers the worker only in external mode.
    SvelteKitPWA({
      strategies: "generateSW",
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        id: "/",
        name: "Garmin Insights",
        short_name: "Garmin",
        description: "Garmin training and health insights",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#0e1418",
        theme_color: "#0f766e",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // index.html is not precached: the server injects the mode, base path and manifest link into it, and the built
        // file lacks those. Navigations are cached at runtime instead (the injected page), assets are precached.
        globPatterns: ["client/**/*.{js,css,ico,png,svg,webp,woff,woff2}"],
        globIgnores: ["**/index.html"],
        navigateFallback: undefined,
        runtimeCaching: [
          { urlPattern: ({ request }) => request.mode === "navigate", handler: "NetworkFirst", options: { cacheName: "gi-pages", networkTimeoutSeconds: 4 } },
          // Offline: the last loaded data. Never the OAuth endpoints (other origin) and removed on sign-out (session.logout).
          { urlPattern: ({ url }) => /\/api\/(?!context)/.test(url.pathname), handler: "NetworkFirst", options: { cacheName: "gi-api", networkTimeoutSeconds: 5, expiration: { maxEntries: 150, maxAgeSeconds: 7 * 86400 } } },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8099" } },
});

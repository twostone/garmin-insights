import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./web/src/lib/paraglide",
      emitTsDeclarations: true,
      // Language from the browser; the user can override it in the settings (kept in localStorage).
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8099" } },
});

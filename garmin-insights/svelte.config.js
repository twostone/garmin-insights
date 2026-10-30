import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Single-page app: adapter-static with an index.html fallback, hash router (the ingress path prefix is dynamic, so the
// route must not live in the pathname), relative asset URLs, served by the Hono listeners. The server code of the app
// lives in src/, the frontend in web/, hence the `files` mapping.
/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: "dist", assets: "dist", fallback: "index.html", precompress: false, strict: false }),
    files: {
      routes: "web/src/routes",
      lib: "web/src/lib",
      appTemplate: "web/src/app.html",
      assets: "web/static",
      hooks: { client: "web/src/hooks.client.ts", server: "web/src/hooks.server.ts", universal: "web/src/hooks.ts" },
      params: "web/src/params",
      serviceWorker: "web/src/service-worker",
    },
    paths: { relative: true },
    router: { type: "hash" },
    output: { bundleStrategy: "single" },
    alias: { $server: "src" },
  },
};

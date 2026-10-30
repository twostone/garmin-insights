import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { contentSecurityPolicy, inlineScriptHashes, injectContext, relativizeAssetPaths } from "../auth/context.ts";
import { logger } from "../log.ts";
import type { Env } from "../types.ts";

const log = logger("http");
const SLOW_REQUEST_MS = 2000;

// First in line, so refused (401/403) requests show up as well. Path only, never the query string.
export function requestLog(listener: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const t0 = performance.now();
    await next();
    const ms = Math.round(performance.now() - t0);
    const status = c.res.status;
    if (status >= 400 || ms >= SLOW_REQUEST_MS) {
      (status >= 500 ? log.error : log.warn)("request", { listener, method: c.req.method, path: c.req.path, status, ms });
    }
  };
}

// PWA files only exist in external mode. Under ingress they are refused, so a service worker can never register there.
const PWA_FILES = /^\/(sw\.js|manifest\.webmanifest|workbox-[^/]+\.js|registerSW\.js)$/;

export type StaticOptions = { root: string };

// The built frontend: assets as files, index.html with the injected context. The SPA uses hash routing, so the only
// HTML paths are "/" and the OAuth redirect "/auth/callback" (also index.html).
export function staticFrontend(opts: StaticOptions) {
  const app = new Hono<Env>();
  let template: string | null = null;
  const html = () => (template ??= relativizeAssetPaths(readFileSync(join(opts.root, "index.html"), "utf8")));

  const page = (c: Context<Env>) => {
    const ctx = c.get("appContext");
    let body: string;
    try {
      body = injectContext(html(), ctx);
    } catch {
      return c.text("Frontend not built (npm run build)", 503);
    }
    c.header("Content-Security-Policy", contentSecurityPolicy(ctx, inlineScriptHashes(html())));
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    return c.html(body);
  };

  app.get("/", page);
  app.get("/index.html", page);
  app.get("/auth/callback", page);
  app.use("*", async (c, next) => {
    if (c.get("access") === "ingress" && PWA_FILES.test(c.req.path)) return c.notFound();
    await next();
  });
  app.use("/*", serveStatic({ root: relative(process.cwd(), opts.root) || ".", onFound: (_path, c) => c.header("X-Content-Type-Options", "nosniff") }));
  return app;
}

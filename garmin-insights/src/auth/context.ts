import { createHash } from "node:crypto";
import type { Access } from "../types.ts";

// What the UI needs to know before its first request. The server decides the mode (by listener), so the page cannot be
// talked into "ingress" by a header or a query string. Injected into index.html as a JSON script tag (not executable, so
// the CSP needs no 'unsafe-inline' for it); `GET api/context` returns the same for revalidation.
export type AppContext = {
  mode: Access;
  /** Directory of the app as the browser sees it, always with a trailing slash. */
  basePath: string;
  /** External mode only: public HA URL (OAuth authorization server) and this app's OAuth client id. */
  haUrl: string | null;
  clientId: string | null;
};

// HA ingress serves the app under /api/hassio_ingress/<token>/. Anything else is not trusted as a <base href>.
const INGRESS_PATH = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+$/;

export function ingressBasePath(header: string | undefined): string {
  const path = header?.trim().replace(/\/+$/, "");
  return path && INGRESS_PATH.test(path) ? `${path}/` : "/";
}

export function ingressContext(header: string | undefined): AppContext {
  return { mode: "ingress", basePath: ingressBasePath(header), haUrl: null, clientId: null };
}

export function externalContext(haUrl: string, appUrl: string): AppContext {
  return { mode: "external", basePath: "/", haUrl, clientId: `${appUrl}/` };
}

const escapeJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// SvelteKit's SPA fallback page uses root-absolute URLs ("/_app/..."), which break under the dynamic ingress prefix. With the
// injected <base href> relative URLs resolve correctly everywhere, so the page is made relative once at load time.
export function relativizeAssetPaths(html: string): string {
  return html.replace(/\b(href|src)="\/(?!\/)/g, '$1="./').replace(/\bimport\("\/(?!\/)/g, 'import("./');
}

// Inserts <base href>, the context block and (external only) the manifest link right after <head>.
export function injectContext(html: string, ctx: AppContext): string {
  const parts = [
    `<base href="${escapeAttr(ctx.basePath)}">`,
    `<script type="application/json" id="app-context">${escapeJson(ctx)}</script>`,
  ];
  if (ctx.mode === "external") parts.push(`<link rel="manifest" href="manifest.webmanifest">`);
  return html.replace("<head>", `<head>${parts.join("")}`);
}

// Hashes of the inline scripts SvelteKit writes into index.html (the start-up snippet), so script-src can stay free of
// 'unsafe-inline'. The JSON context block has type application/json and is never executed, so it needs no hash.
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1]) hashes.push(`'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
  }
  return hashes;
}

const TILES = "https://tiles.openfreemap.org";

// Strict CSP. External mode may additionally talk to Home Assistant (OAuth token endpoint). No frame-ancestors: Home
// Assistant embeds the ingress page in an iframe. blob: is for MapLibre's workers and tile images.
export function contentSecurityPolicy(ctx: AppContext, scriptHashes: string[]): string {
  const connect = ["'self'", TILES, ...(ctx.haUrl ? [ctx.haUrl] : [])].join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trim(),
    `connect-src ${connect}`,
    `img-src 'self' data: blob: ${TILES}`,
    "style-src 'self'",
    // ECharts tooltips and MapLibre controls write style attributes into their own markup. Attributes only: stylesheets
    // and <style> elements stay restricted to 'self', scripts are untouched.
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "child-src blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

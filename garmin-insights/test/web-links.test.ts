import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..", "web", "src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "paraglide" ? [] : sources(p);
    return /\.(svelte|ts)$/.test(e.name) ? [p] : [];
  });
}

// SvelteKit's resolve() and goto() put the page directory without its trailing slash in front of the hash
// ("/api/hassio_ingress/<token>#/activities"). Home Assistant's ingress answers that path with 404, so route links go
// through $lib/nav (bare "#/..." fragments against <base href>) and nothing else may use them.
test("web: route links never use SvelteKit's resolve() or goto() directly", () => {
  const offenders = sources(WEB)
    .filter((f) => !f.endsWith(join("lib", "nav.ts")))
    .filter((f) => /import\s*\{[^}]*\bresolve\b[^}]*\}\s*from\s*["']\$app\/paths["']|\bgoto\s*\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

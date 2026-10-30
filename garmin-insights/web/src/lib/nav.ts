import { base, resolve } from "$app/paths";

// Link to an app route as a bare fragment ("#/activities"). SvelteKit's resolve() prefixes `base`, which with relative
// paths is the page directory *without* its trailing slash ("/api/hassio_ingress/<token>#/activities", or "/auth#/…"
// after the OAuth callback). Such a path does not exist, so the browser loads it and gets a 404. A bare fragment resolves
// against the injected <base href> (always the app directory with a trailing slash), so it stays on the loaded page.
export const href = ((...args: Parameters<typeof resolve>) => stripBase(resolve(...args))) as typeof resolve;

export function stripBase(resolved: string): string {
  return resolved.startsWith(base) ? resolved.slice(base.length) : resolved;
}

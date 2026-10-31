import { api, unwrap } from "./api.ts";
import { Resource } from "./resource.svelte.ts";
import type { CustomSportList } from "./types.ts";

// The user's own sports, shared by every page (filter, settings, activity detail, chart colours): one request, one source.
// The layout loads it after sign-in and after each sync; writes (settings, assignment) reload it, so all views follow.
export const customSports = new Resource(() => unwrap<CustomSportList>(api["custom-sports"].$get()));

// Readable on light and dark, and kept clear of the Garmin sports' colours (running orange, cycling blue, swimming/paddling
// teal, strength violet, walking green, hiking brown, rowing pink, other grey); the most distinct come first.
const CUSTOM_PALETTE = ["#f59f00", "#be4bdb", "#e03131", "#364fc7", "#82c91e", "#22b8cf", "#495057", "#ffd43b"];

/** Colour of an own sport by its place in the (name-sorted) list, so up to eight sports never share one.
 *  Before the list is loaded, or for a name it does not know, a hash keeps the colour stable. */
export function customSportColor(name: string): string {
  const index = customSports.data?.items.findIndex((s) => s.name === name) ?? -1;
  if (index >= 0) return CUSTOM_PALETTE[index % CUSTOM_PALETTE.length]!;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return CUSTOM_PALETTE[h % CUSTOM_PALETTE.length]!;
}

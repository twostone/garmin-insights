import { readFileSync } from "node:fs";

// The app's options as the Supervisor writes them to /data/options.json. Read once at start: a change needs a restart.
// No file (development, tests) or broken JSON -> {}, so every option falls back to its default.
export type AddonOptions = Record<string, unknown>;
export function readAddonOptions(path: string): AddonOptions {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AddonOptions) : {};
  } catch {
    return {}; // no options file outside the app
  }
}

export const DEFAULT_SYNC_INTERVAL_MINUTES = 30;
export const MIN_SYNC_INTERVAL_MINUTES = 5;
export const MAX_SYNC_INTERVAL_MINUTES = 1440;

export type AppSettings = {
  /** Public URL of Home Assistant (OAuth authorization server), no trailing slash. */
  haExternalUrl: string | null;
  /** Public URL of the external listener (port 8100), no trailing slash. */
  appExternalUrl: string | null;
  syncIntervalMinutes: number;
  /** Names of options that were set but unusable; the caller logs them once logging is set up. */
  invalid: string[];
};

// A public base URL: http(s) only, no credentials, query or fragment. The path is kept (reverse proxy sub-path is not
// supported by the app, but a trailing slash must not matter).
export function parsePublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// Environment variables beat the options file (development, Docker smoke test).
export function parseSettings(options: AddonOptions, env: Record<string, string | undefined> = {}): AppSettings {
  const invalid: string[] = [];
  const url = (name: string, option: unknown, envValue: string | undefined): string | null => {
    const raw = envValue || option;
    if (raw === undefined || raw === null || raw === "") return null;
    const parsed = parsePublicUrl(raw);
    if (!parsed) invalid.push(name);
    return parsed;
  };
  const haExternalUrl = url("ha_external_url", options.ha_external_url, env.HA_EXTERNAL_URL);
  const appExternalUrl = url("app_external_url", options.app_external_url, env.APP_EXTERNAL_URL);

  const rawInterval = options.sync_interval_minutes;
  let syncIntervalMinutes = DEFAULT_SYNC_INTERVAL_MINUTES;
  if (rawInterval !== undefined) {
    if (typeof rawInterval === "number" && Number.isInteger(rawInterval) && rawInterval >= MIN_SYNC_INTERVAL_MINUTES && rawInterval <= MAX_SYNC_INTERVAL_MINUTES) {
      syncIntervalMinutes = rawInterval;
    } else {
      invalid.push("sync_interval_minutes");
    }
  }
  return { haExternalUrl, appExternalUrl, syncIntervalMinutes, invalid };
}

// The external listener needs both URLs: the SPA signs in at Home Assistant and the app must know its own public origin.
export function externalEnabled(s: AppSettings): s is AppSettings & { haExternalUrl: string; appExternalUrl: string } {
  return s.haExternalUrl !== null && s.appExternalUrl !== null;
}

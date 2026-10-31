import { m } from "$lib/paraglide/messages.js";
import { getLocale } from "$lib/paraglide/runtime.js";
import { customSportColor } from "./custom-sports.svelte.ts";

// Metric units everywhere. Numbers and dates follow the UI language.
const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat(getLocale(), opts);

export const num = (v: number | null | undefined, digits = 0) => (v === null || v === undefined || Number.isNaN(v) ? "–" : nf({ maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v));
export const km = (m: number | null | undefined, digits = 1) => (m === null || m === undefined ? "–" : `${num(m / 1000, digits)} km`);
export const meters = (m: number | null | undefined) => (m === null || m === undefined ? "–" : `${num(m)} m`);

/** 3725 s -> "1:02:05"; under an hour "2:05". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "–";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

/** Speed in m/s -> pace "5:12 /km". */
export function pace(speedMps: number | null | undefined): string {
  if (!speedMps || speedMps <= 0) return "–";
  return `${duration(1000 / speedMps)} /km`;
}
export const paceFromSecPerKm = (s: number | null | undefined) => (s ? `${duration(s)} /km` : "–");
/** Seconds per 500 m (paddling pace) -> "3:20 /500 m". */
export const pacePer500m = (s: number | null | undefined) => (s ? `${duration(s)} /500 m` : "–");
export const kmh = (mps: number | null | undefined) => (mps === null || mps === undefined ? "–" : `${num(mps * 3.6, 1)} km/h`);

export function dateLabel(date: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  return new Intl.DateTimeFormat(getLocale(), { ...opts, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
export const timeLabel = (iso: string) => new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export const today = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "m:ss" or "h:mm:ss" typed by a person -> seconds; null when it does not parse. */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":").map(Number);
  if (!parts.length || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** The Garmin-derived sports with their own colour and name; anything else (e.g. a user-defined sport) is shown as is. */
export const KNOWN_SPORTS = ["running", "cycling", "swimming", "strength", "walking", "hiking", "paddling", "rowing", "other"];
export const sportColor = (sport: string) => `var(--c-${KNOWN_SPORTS.includes(sport) ? sport : "other"})`;

/** Readable name of a Garmin activity type ("stand_up_paddleboarding_v2" -> "Stand-up paddling"); unknown types keep their key. */
export function garminTypeName(key: string): string {
  const base = key.replace(/_v\d+$/, "");
  const known = GARMIN_TYPE_NAMES[base];
  if (known) return known();
  const text = base.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const GARMIN_TYPE_NAMES: Record<string, () => string> = {
  running: m.gt_running, treadmill_running: m.gt_treadmill_running, trail_running: m.gt_trail_running,
  cycling: m.gt_cycling, road_biking: m.gt_road_biking, mountain_biking: m.gt_mountain_biking, indoor_cycling: m.gt_indoor_cycling,
  lap_swimming: m.gt_lap_swimming, open_water_swimming: m.gt_open_water_swimming,
  strength_training: m.gt_strength_training, hiit: m.gt_hiit, indoor_cardio: m.gt_indoor_cardio, multi_sport: m.gt_multi_sport,
  walking: m.gt_walking, hiking: m.gt_hiking,
  stand_up_paddleboarding: m.gt_stand_up_paddleboarding, kayaking: m.gt_kayaking, canoeing: m.gt_canoeing,
  rowing: m.gt_rowing, indoor_rowing: m.gt_indoor_rowing, padel: m.gt_padel, yoga: m.gt_yoga, other: m.gt_other,
};

/** CSS colour of a Garmin-derived sport, or of an own sport when `custom` is set. */
export const anySportColor = (sport: string, custom?: string | null) => (custom ? customSportColor(custom) : sportColor(sport));

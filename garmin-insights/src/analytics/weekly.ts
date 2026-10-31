import { addDays, weekStart } from "../dates.ts";

// Weekly training balance per calendar week (Monday to Sunday): load, ACWR, Foster monotony and strain, intensity split and
// sport mix. Pure functions: the caller supplies per-day load and per-activity facts and decides which activities count.

export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;
/** Days of load before the first week the caller has to supply, so that the first week's 28-day average is complete. */
export const LEAD_IN_DAYS = CHRONIC_DAYS - 1;
/** ACWR range generally considered the "sweet spot" (Gabbett); below is detraining, above rising injury risk. */
export const ACWR_SWEET_SPOT = { low: 0.8, high: 1.3 } as const;
/** Foster: monotony above 2 together with high load is associated with illness and overtraining. */
export const MONOTONY_WARNING = 2;

/** Heart-rate zones (1-based) that make up each intensity band; the five zones of `hrZonesFromMax`. */
export const HR_ZONE_COUNT = 5;
const EASY_ZONES = [1, 2] as const;
const MODERATE_ZONES = [3] as const;
const HARD_ZONES = [4, 5] as const;

export type WeeklyActivity = {
  date: string;
  /** What the sport mix groups by (the user's own sport name where assigned). */
  sport: string;
  duration_s: number | null;
  tss: number | null;
  /** Seconds in HR zones 1..5, or null when the activity has no heart-rate data. */
  hrZoneSeconds: readonly number[] | null;
};

export type IntensityShare = { easy: number; moderate: number; hard: number };
export type SportShare = { sport: string; duration_s: number; tss: number };

export type WeekBalance = {
  /** Monday of the week. */
  week: string;
  load: number;
  /** Acute:chronic workload ratio at the last day of the week; null without chronic load. */
  acwr: number | null;
  monotony: number | null;
  strain: number | null;
  /** Percent of zoned time; null when no activity of the week has zone data. */
  intensity_pct: IntensityShare | null;
  sport_mix: SportShare[];
};

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/**
 * ACWR as a rolling-average ratio (mean load of the last 7 days over the mean of the last 28), not the exponentially weighted
 * variant: it needs no decay parameter and is easy to explain. The chronic window contains the acute week (coupled), which
 * damps the ratio slightly; days before the supplied history count as zero.
 */
function acwr(dailyTss: ReadonlyMap<string, number>, end: string): number | null {
  const meanOver = (days: number) => sum(Array.from({ length: days }, (_, i) => dailyTss.get(addDays(end, -i)) ?? 0)) / days;
  const chronic = meanOver(CHRONIC_DAYS);
  return chronic > 0 ? meanOver(ACUTE_DAYS) / chronic : null;
}

/** Foster's monotony: mean daily load over its (population) standard deviation; rest days are zero. */
function monotony(days: readonly number[]): number | null {
  const mean = sum(days) / days.length;
  const sd = Math.sqrt(sum(days.map((d) => (d - mean) ** 2)) / days.length);
  return sd > 1e-9 ? mean / sd : null;
}

function intensity(activities: readonly WeeklyActivity[]): IntensityShare | null {
  const zones = Array.from({ length: HR_ZONE_COUNT }, (_, i) => sum(activities.map((a) => a.hrZoneSeconds?.[i] ?? 0)));
  const band = (numbers: readonly number[]) => sum(numbers.map((n) => zones[n - 1]!));
  const total = sum(zones);
  if (total <= 0) return null;
  return { easy: (band(EASY_ZONES) / total) * 100, moderate: (band(MODERATE_ZONES) / total) * 100, hard: (band(HARD_ZONES) / total) * 100 };
}

function sportMix(activities: readonly WeeklyActivity[]): SportShare[] {
  const mix = new Map<string, SportShare>();
  for (const a of activities) {
    const s = mix.get(a.sport) ?? { sport: a.sport, duration_s: 0, tss: 0 };
    s.duration_s += a.duration_s ?? 0;
    s.tss += a.tss ?? 0;
    mix.set(a.sport, s);
  }
  return [...mix.values()].sort((a, b) => b.duration_s - a.duration_s || a.sport.localeCompare(b.sport));
}

/**
 * One balance per calendar week touched by `from`..`to`, oldest first. The last week stops at `to` (days that have not
 * happened yet are not rest days). `dailyTss` should reach back `LEAD_IN_DAYS` before the first week; activities outside
 * the weeks are ignored.
 */
export function weekBalances(o: { from: string; to: string; dailyTss: ReadonlyMap<string, number>; activities: readonly WeeklyActivity[] }): WeekBalance[] {
  const weeks: WeekBalance[] = [];
  for (let week = weekStart(o.from); week <= o.to; week = addDays(week, 7)) {
    const last = addDays(week, 6) < o.to ? addDays(week, 6) : o.to;
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((d) => d <= last).map((d) => o.dailyTss.get(d) ?? 0);
    const load = sum(days);
    const m = monotony(days);
    const inWeek = o.activities.filter((a) => a.date >= week && a.date <= last);
    weeks.push({ week, load, acwr: acwr(o.dailyTss, last), monotony: m, strain: m === null ? null : load * m, intensity_pct: intensity(inWeek), sport_mix: sportMix(inWeek) });
  }
  return weeks;
}

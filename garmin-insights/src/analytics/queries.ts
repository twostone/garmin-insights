import { addDays, diffDays, todayLocal, weekStart } from "../dates.ts";
import type { ActivityRow } from "../repo/activities.ts";
import type { AthleteSettings } from "../repo/athlete.ts";
import type { Repos } from "../repo/index.ts";
import { bestEfforts, decoupling, meanMaxPower, POWER_DURATIONS_S, RUN_DISTANCES_M, type BestEffort, type MeanMax } from "./efforts.ts";
import { healthTrends } from "./health.ts";
import { perSecond, type Sample } from "./load.ts";
import { strengthVolume } from "./strength.ts";
import { volumeBy } from "./volume.ts";
import { hrZonesFromMax, paceZonesFromThreshold, powerZonesFromFtp, timeInZones, type ZoneConfig } from "./zones.ts";

// Analyses that combine repos and the pure functions. Shared by the REST routes and the MCP tools, so both answer from the
// same numbers. Every function takes the user id first.

export type ZoneKind = "hr" | "power" | "pace";

export function zoneFloors(s: AthleteSettings | undefined, kind: ZoneKind): number[] | null {
  const custom = s?.zones_json ? (JSON.parse(s.zones_json) as ZoneConfig)[kind] : undefined;
  if (custom?.length) return custom;
  if (kind === "hr") return s?.hr_max ? hrZonesFromMax(s.hr_max) : null;
  if (kind === "power") return s?.ftp ? powerZonesFromFtp(s.ftp) : null;
  return s?.threshold_pace_s_per_km ? paceZonesFromThreshold(s.threshold_pace_s_per_km) : null;
}

const pickers: Record<ZoneKind, (s: Sample) => number | null | undefined> = { hr: (s) => s.hr, power: (s) => s.power, pace: (s) => s.speed };
const SUMMARY_ZONE_KEY: Record<ZoneKind, string | null> = { hr: "hrTimeInZone_", power: "powerTimeInZone_", pace: null };
const ZONES_IN_SUMMARY: Record<ZoneKind, number> = { hr: 5, power: 7, pace: 0 };

export const parseSummary = (json: string | undefined): Record<string, unknown> => {
  try {
    return json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export type ZoneResult = { kind: ZoneKind; floors: number[]; below: number; seconds: number[]; source: "samples" | "garmin_summary" };

function zonesForActivity(repos: Repos, userId: string, a: ActivityRow, kind: ZoneKind): ZoneResult | null {
  const floors = zoneFloors(repos.athlete.at(userId, a.date), kind);
  if (a.fit_status === "done" && floors) {
    const t = timeInZones(repos.activities.samples(userId, a.id), pickers[kind], floors);
    if (t.zones.some(Boolean) || t.below) return { kind, floors, below: t.below, seconds: t.zones, source: "samples" };
  }
  // Without a FIT file, Garmin's own per-zone times from the summary are the next best thing (their zone boundaries, not ours).
  const prefix = SUMMARY_ZONE_KEY[kind];
  if (prefix) {
    const summary = parseSummary(repos.activities.summaryJson(userId, a.id));
    const seconds = Array.from({ length: ZONES_IN_SUMMARY[kind] }, (_, i) => Number(summary[`${prefix}${i + 1}`] ?? 0) || 0);
    if (seconds.some(Boolean)) return { kind, floors: floors ?? [], below: 0, seconds, source: "garmin_summary" };
  }
  return null;
}

export function zoneDistribution(repos: Repos, userId: string, o: { from: string; to: string; sport?: ActivityRow["sport"]; kind: ZoneKind }) {
  const activities = repos.activities.list(userId, { from: o.from, to: o.to, sport: o.sport, limit: 1000, order: "asc" });
  let total: ZoneResult | null = null;
  let count = 0;
  for (const a of activities) {
    const z = zonesForActivity(repos, userId, a, o.kind);
    if (!z) continue;
    count++;
    total = total ?? { ...z, below: 0, seconds: z.seconds.map(() => 0) };
    if (z.seconds.length !== total.seconds.length) continue; // zone layout changed between settings versions: skip the odd one out
    total.below += z.below;
    z.seconds.forEach((s, i) => (total!.seconds[i]! += s));
    total.floors = z.floors;
    if (z.source === "garmin_summary") total.source = "garmin_summary";
  }
  return { kind: o.kind, activities: count, ...(total ?? { floors: [] as number[], below: 0, seconds: [] as number[], source: "samples" as const }) };
}

export type ActivityAnalysis = {
  zones: { hr: ZoneResult | null; power: ZoneResult | null; pace: ZoneResult | null };
  decoupling_pct: number | null;
  best_efforts: BestEffort[];
  mean_max_power: MeanMax[];
};

const WARMUP_S = 600;
const WARMUP_MIN_DURATION_S = 2400;

export function activityAnalysis(repos: Repos, userId: string, a: ActivityRow): ActivityAnalysis {
  const hasSamples = a.fit_status === "done";
  const samples = hasSamples ? repos.activities.samples(userId, a.id) : [];
  const power = perSecond(samples, (s) => s.power);
  const usePower = a.sport === "cycling" && power.length > 0;
  const warmupS = (a.duration_s ?? 0) >= WARMUP_MIN_DURATION_S ? WARMUP_S : 0;
  return {
    zones: { hr: zonesForActivity(repos, userId, a, "hr"), power: zonesForActivity(repos, userId, a, "power"), pace: a.sport === "running" ? zonesForActivity(repos, userId, a, "pace") : null },
    decoupling_pct: hasSamples && (a.sport === "running" || a.sport === "cycling" || a.sport === "walking" || a.sport === "hiking") ? decoupling(samples, { warmupS, usePower }) : null,
    best_efforts: hasSamples && a.sport === "running" ? bestEfforts(samples) : [],
    mean_max_power: power.length ? meanMaxPower(power) : [],
  };
}

// Aggregated best efforts come from Garmin's per-activity summary fields (fastestSplit_<m>, maxAvgPower_<s>): they are
// already computed, so a multi-year query does not need to read millions of samples.
const SPLIT_DISTANCES = [1000, 1609, 5000, 10000, 21098, 42195] as const;
export type RangeBest = { activity_id: number; date: string };

export function bestEffortsInRange(repos: Repos, userId: string, o: { from: string; to: string; sport: "running" | "cycling" }) {
  const activities = repos.activities.list(userId, { from: o.from, to: o.to, sport: o.sport, limit: 5000, order: "asc" });
  const run = new Map<number, { seconds: number } & RangeBest>();
  const ride = new Map<number, { watts: number } & RangeBest>();
  for (const a of activities) {
    const summary = parseSummary(repos.activities.summaryJson(userId, a.id));
    if (o.sport === "running") {
      for (const d of SPLIT_DISTANCES) {
        const seconds = Number(summary[`fastestSplit_${d}`]);
        if (seconds > 0 && (!run.has(d) || seconds < run.get(d)!.seconds)) run.set(d, { seconds, activity_id: a.id, date: a.date });
      }
    } else {
      for (const s of POWER_DURATIONS_S) {
        const watts = Number(summary[`maxAvgPower_${s}`]);
        if (watts > 0 && (!ride.has(s) || watts > ride.get(s)!.watts)) ride.set(s, { watts, activity_id: a.id, date: a.date });
      }
    }
  }
  return {
    sport: o.sport,
    efforts: [...run.entries()].map(([distance_m, v]) => ({ distance_m, ...v })).sort((a, b) => a.distance_m - b.distance_m),
    power_curve: [...ride.entries()].map(([seconds, v]) => ({ seconds, ...v })).sort((a, b) => a.seconds - b.seconds),
  };
}
export { RUN_DISTANCES_M };

export function volumeInRange(repos: Repos, userId: string, o: { from: string; to: string; by: "week" | "month"; sport?: ActivityRow["sport"] }) {
  return volumeBy(repos.activities.list(userId, { from: o.from, to: o.to, sport: o.sport, limit: 100_000, order: "asc" }), o.by);
}

export function strengthInRange(repos: Repos, userId: string, o: { from: string; to: string }) {
  const sets = repos.activities.setsInRange(userId, o.from, o.to);
  const weekly = new Map<string, { week: string; sets: number; volume_kg: number }>();
  for (const s of sets) {
    const week = weekStart(s.date);
    const w = weekly.get(week) ?? { week, sets: 0, volume_kg: 0 };
    w.sets++;
    w.volume_kg += (s.reps ?? 0) * (s.weight_kg ?? 0);
    weekly.set(week, w);
  }
  return { ...strengthVolume(sets), weekly: [...weekly.values()].sort((a, b) => a.week.localeCompare(b.week)) };
}

export function trendsInRange(repos: Repos, userId: string, o: { from: string; to: string }) {
  const days: string[] = [];
  for (let d = o.from; d <= o.to; d = addDays(d, 1)) days.push(d);
  const dailies = new Map(repos.health.dailies.range(userId, o.from, o.to).map((r) => [r.date, r]));
  const sleep = new Map(repos.health.sleep.range(userId, o.from, o.to).map((r) => [r.date, r]));
  const hrv = new Map(repos.health.hrv.range(userId, o.from, o.to).map((r) => [r.date, r]));
  const load = new Map(repos.analytics.range(userId, o.from, o.to).map((r) => [r.date, r]));
  return healthTrends({
    dates: days,
    restingHr: days.map((d) => dailies.get(d)?.resting_hr ?? null),
    hrv: days.map((d) => hrv.get(d)?.last_night_avg ?? null),
    sleepHours: days.map((d) => (sleep.get(d)?.sleep_s ? sleep.get(d)!.sleep_s! / 3600 : null)),
    atl: days.map((d) => load.get(d)?.atl ?? null),
  });
}

/** `from`/`to` query defaults: the last `days` days up to today. */
export function defaultRange(from: string | undefined, to: string | undefined, days: number, today = todayLocal()): { from: string; to: string } {
  const end = to ?? today;
  return { from: from ?? addDays(end, -(days - 1)), to: end };
}
export const rangeDays = (r: { from: string; to: string }): number => diffDays(r.to, r.from) + 1;

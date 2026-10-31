import { weekStart } from "../dates.ts";
import { perSecond, type Sample } from "./load.ts";

// Paddling metrics (SUP, dragon boat, outrigger, kayak). Pure functions: samples or summary numbers in, numbers out.
// Efficiency = average speed (km/h) per heart-beat above resting HR, so a rising value means more speed for the same effort.

/** Below this speed (1.8 km/h) the boat is drifting or waiting, not paddled: it does not count as moving time. */
export const MIN_MOVING_SPEED_MPS = 0.5;
export const BEST_SPEED_WINDOWS_S = { one_min: 60, five_min: 300 } as const;
const PACE_DISTANCE_M = 500;
const KMH_PER_MPS = 3.6;

export type PaddleSample = Sample & { cadence?: number | null };
export type PaddleMetrics = {
  moving_s: number;
  avg_speed_kmh: number;
  /** Seconds per 500 m, the usual paddling pace. */
  pace_s_per_500m: number;
  max_speed_1min_kmh: number | null;
  max_speed_5min_kmh: number | null;
  /** Strokes per minute (the FIT cadence of paddle sports); null without cadence. */
  avg_stroke_rate: number | null;
  distance_per_stroke_m: number | null;
  avg_hr: number | null;
  efficiency: number | null;
};

const mean = (v: readonly number[]): number | null => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Best average over any `window` consecutive values, null if the series is shorter. */
function bestRollingMean(values: readonly number[], window: number): number | null {
  if (values.length < window) return null;
  let sum = 0;
  let best = -Infinity;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= window) sum -= values[i - window]!;
    if (i >= window - 1) best = Math.max(best, sum / window);
  }
  return best;
}

export function efficiency(avgSpeedKmh: number, avgHr: number | null, hrRest: number | null): number | null {
  if (avgHr === null || hrRest === null || avgHr <= hrRest) return null;
  return avgSpeedKmh / (avgHr - hrRest);
}

const pace500 = (speedMps: number): number => PACE_DISTANCE_M / speedMps;

/** Metrics of one activity from its second-by-second samples; null if the boat never moved. */
export function paddleMetrics(samples: readonly PaddleSample[], o: { hrRest: number | null }): PaddleMetrics | null {
  const speed = perSecond(samples, (s) => s.speed);
  const moving = speed.filter((v) => v >= MIN_MOVING_SPEED_MPS);
  if (!moving.length) return null;
  const avgMps = mean(moving)!;

  // Cadence and HR only count while moving, so pauses do not drag the averages down.
  const movingSamples = samples.filter((s) => (s.speed ?? 0) >= MIN_MOVING_SPEED_MPS);
  const strokeRate = mean(movingSamples.flatMap((s) => (s.cadence && s.cadence > 0 ? [s.cadence] : [])));
  const avgHr = mean(movingSamples.flatMap((s) => (s.hr && s.hr > 0 ? [s.hr] : [])));
  const kmh = (v: number | null) => (v === null ? null : v * KMH_PER_MPS);
  const avgKmh = avgMps * KMH_PER_MPS;
  return {
    moving_s: moving.length,
    avg_speed_kmh: avgKmh,
    pace_s_per_500m: pace500(avgMps),
    max_speed_1min_kmh: kmh(bestRollingMean(speed, BEST_SPEED_WINDOWS_S.one_min)),
    max_speed_5min_kmh: kmh(bestRollingMean(speed, BEST_SPEED_WINDOWS_S.five_min)),
    avg_stroke_rate: strokeRate,
    distance_per_stroke_m: strokeRate === null ? null : (avgMps * 60) / strokeRate,
    avg_hr: avgHr,
    efficiency: efficiency(avgKmh, avgHr, o.hrRest),
  };
}

/** The subset that Garmin's summary allows (no FIT file yet): no best speeds and no stroke data. */
export function paddleMetricsFromSummary(a: { distance_m: number | null; moving_s: number | null; avg_hr: number | null }, hrRest: number | null): PaddleMetrics | null {
  if (!a.distance_m || !a.moving_s || a.distance_m <= 0 || a.moving_s <= 0) return null;
  const avgMps = a.distance_m / a.moving_s;
  const avgKmh = avgMps * KMH_PER_MPS;
  return {
    moving_s: a.moving_s,
    avg_speed_kmh: avgKmh,
    pace_s_per_500m: pace500(avgMps),
    max_speed_1min_kmh: null,
    max_speed_5min_kmh: null,
    avg_stroke_rate: null,
    distance_per_stroke_m: null,
    avg_hr: a.avg_hr,
    efficiency: efficiency(avgKmh, a.avg_hr, hrRest),
  };
}

export type PaddleWeekInput = { date: string; group_key: string; distance_m: number | null; moving_s: number | null; efficiency: number | null };
export type PaddleWeek = { week: string; group: string; count: number; distance_m: number; duration_s: number; avg_speed_kmh: number | null; avg_efficiency: number | null };

/** Weekly (Monday-based) totals per group (own sport or `paddling`). Speed is total distance over total moving time. */
export function weeklyPaddling(activities: readonly PaddleWeekInput[]): PaddleWeek[] {
  const groups = new Map<string, { row: PaddleWeek; efficiencies: number[] }>();
  for (const a of activities) {
    const week = weekStart(a.date);
    const key = `${week}|${a.group_key}`;
    const g = groups.get(key) ?? { row: { week, group: a.group_key, count: 0, distance_m: 0, duration_s: 0, avg_speed_kmh: null, avg_efficiency: null }, efficiencies: [] };
    g.row.count++;
    g.row.distance_m += a.distance_m ?? 0;
    g.row.duration_s += a.moving_s ?? 0;
    if (a.efficiency !== null) g.efficiencies.push(a.efficiency);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ row, efficiencies }) => ({
      ...row,
      avg_speed_kmh: row.duration_s > 0 ? (row.distance_m / row.duration_s) * KMH_PER_MPS : null,
      avg_efficiency: mean(efficiencies),
    }))
    .sort((a, b) => a.week.localeCompare(b.week) || a.group.localeCompare(b.group));
}

import { stepSeconds, type Sample } from "./load.ts";

export const RUN_DISTANCES_M = [400, 1000, 1609, 3000, 5000, 10000, 15000, 21098, 42195] as const;
export const POWER_DURATIONS_S = [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200] as const;

/**
 * Aerobic decoupling (Pa:Hr, or Pw:Hr with `usePower`): the efficiency factor (speed or power per heartbeat) of the
 * first half against the second half, in percent. Positive = efficiency dropped (cardiac drift). null when there is too
 * little steady data to say anything.
 */
export function decoupling(samples: readonly Sample[], o: { warmupS?: number; usePower?: boolean; minDurationS?: number } = {}): number | null {
  const output = (s: Sample) => (o.usePower ? s.power : s.speed);
  const usable = samples.filter((s) => s.t >= (o.warmupS ?? 0) && (s.hr ?? 0) > 0 && (output(s) ?? 0) > 0);
  const duration = usable.reduce((sum, s, i) => sum + stepSeconds(usable, i), 0);
  if (duration < (o.minDurationS ?? 600)) return null;
  const mid = Math.floor(usable.length / 2);
  const mean = (xs: Sample[], f: (s: Sample) => number) => xs.reduce((a, s) => a + f(s), 0) / xs.length;
  const ef = (xs: Sample[]) => mean(xs, (s) => output(s)!) / mean(xs, (s) => s.hr!);
  const first = ef(usable.slice(0, mid));
  const second = ef(usable.slice(mid));
  return ((first - second) / first) * 100;
}

export type BestEffort = { distance: number; seconds: number; startT: number };

/** Fastest time over each distance (sliding window over the cumulative distance, linear interpolation at the end). */
export function bestEfforts(samples: readonly Sample[], distances: readonly number[] = RUN_DISTANCES_M): BestEffort[] {
  const pts = samples.filter((s) => s.dist !== null && s.dist !== undefined) as (Sample & { dist: number })[];
  const total = pts.length ? pts[pts.length - 1]!.dist - pts[0]!.dist : 0;
  const out: BestEffort[] = [];
  for (const distance of distances) {
    if (total < distance) continue;
    let best: BestEffort | null = null;
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      if (j < i + 1) j = i + 1;
      while (j < pts.length && pts[j]!.dist - pts[i]!.dist < distance) j++;
      if (j >= pts.length) break;
      const a = pts[j - 1]!;
      const b = pts[j]!;
      const span = b.dist - a.dist;
      const tEnd = span > 0 ? a.t + ((distance - (a.dist - pts[i]!.dist)) / span) * (b.t - a.t) : b.t;
      const seconds = tEnd - pts[i]!.t;
      if (!best || seconds < best.seconds) best = { distance, seconds, startT: pts[i]!.t };
    }
    if (best) out.push(best);
  }
  return out;
}

export type MeanMax = { seconds: number; watts: number };

/** Mean-maximal power: the best average over each duration. `power` is one value per second. */
export function meanMaxPower(power: readonly number[], durations: readonly number[] = POWER_DURATIONS_S): MeanMax[] {
  const prefix = new Float64Array(power.length + 1);
  for (let i = 0; i < power.length; i++) prefix[i + 1] = prefix[i]! + power[i]!;
  const out: MeanMax[] = [];
  for (const seconds of durations) {
    if (seconds > power.length) continue;
    let best = 0;
    for (let i = seconds; i <= power.length; i++) best = Math.max(best, prefix[i]! - prefix[i - seconds]!);
    out.push({ seconds, watts: best / seconds });
  }
  return out;
}

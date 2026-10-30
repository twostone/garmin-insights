import { monthStart, weekStart } from "../dates.ts";

export type VolumeInput = { date: string; sport: string; distance_m: number | null; duration_s: number | null; elevation_gain_m: number | null; tss: number | null; trimp: number | null };
export type VolumeRow = { period: string; sport: string; count: number; distance_m: number; duration_s: number; elevation_gain_m: number; tss: number; trimp: number };

/** Training volume per calendar week (starting Monday) or month, per sport. `period` is the first day of the period. */
export function volumeBy(activities: readonly VolumeInput[], by: "week" | "month"): VolumeRow[] {
  const rows = new Map<string, VolumeRow>();
  for (const a of activities) {
    const period = by === "week" ? weekStart(a.date) : monthStart(a.date);
    const key = `${period}|${a.sport}`;
    const r = rows.get(key) ?? { period, sport: a.sport, count: 0, distance_m: 0, duration_s: 0, elevation_gain_m: 0, tss: 0, trimp: 0 };
    r.count++;
    r.distance_m += a.distance_m ?? 0;
    r.duration_s += a.duration_s ?? 0;
    r.elevation_gain_m += a.elevation_gain_m ?? 0;
    r.tss += a.tss ?? 0;
    r.trimp += a.trimp ?? 0;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => a.period.localeCompare(b.period) || a.sport.localeCompare(b.sport));
}

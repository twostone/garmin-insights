import { stepSeconds, type Sample } from "./load.ts";

// Time in zones. A zone is described by its lower bound; the last zone is open-ended. Values below the first bound go to
// `below` (e.g. walking to the car, far under zone 1). "Higher is harder" for all three kinds: heart rate, power, and speed
// (pace zones are stored as speeds in m/s, so the same function covers them).

export type ZoneTime = { below: number; zones: number[] };

export function timeInZones(samples: readonly Sample[], pick: (s: Sample) => number | null | undefined, floors: readonly number[]): ZoneTime {
  const result: ZoneTime = { below: 0, zones: floors.map(() => 0) };
  for (let i = 0; i < samples.length; i++) {
    const v = pick(samples[i]!);
    if (v === null || v === undefined) continue;
    const dt = stepSeconds(samples, i);
    let zone = -1;
    for (let z = 0; z < floors.length; z++) if (v >= floors[z]!) zone = z;
    if (zone < 0) result.below += dt;
    else result.zones[zone]! += dt;
  }
  return result;
}

const scale = (base: number, factors: readonly number[]) => factors.map((f) => Math.round(base * f * 1e6) / 1e6);

/** Coggan's seven power zones as lower bounds in watts. */
export const powerZonesFromFtp = (ftp: number): number[] => scale(ftp, [0, 0.55, 0.75, 0.9, 1.05, 1.2, 1.5]);
/** Five heart-rate zones at 50/60/70/80/90 % of the maximum, the common default when no Garmin zones exist. */
export const hrZonesFromMax = (hrMax: number): number[] => scale(hrMax, [0.5, 0.6, 0.7, 0.8, 0.9]);
/** Five pace zones as lower bounds in m/s from the threshold pace (s/km): easy, steady, tempo, threshold, interval. */
export const paceZonesFromThreshold = (thresholdPaceSPerKm: number): number[] => scale(1000 / thresholdPaceSPerKm, [0, 0.78, 0.88, 0.95, 1.02]);

export type ZoneConfig = { hr?: number[]; pace?: number[]; power?: number[] };

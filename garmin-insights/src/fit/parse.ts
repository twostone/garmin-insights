import { Decoder, Stream } from "@garmin/fitsdk";
import type { LapRow, SampleRow, StrengthSetRow } from "../repo/activities.ts";

// FIT file -> the rows the app stores. Tolerant by design: Garmin may strip fields from the files the Personal API hands
// out, so every field is optional and a file without records still parses (to an empty result).

export type ParsedFit = {
  samples: SampleRow[];
  laps: LapRow[];
  sets: StrengthSetRow[];
  session: { sport: string | null; subSport: string | null; normalizedPower: number | null; thresholdPower: number | null; vo2max: number | null };
};

export class FitError extends Error {}

const SEMICIRCLE_TO_DEGREES = 180 / 2 ** 31;

type Msg = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const degrees = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * SEMICIRCLE_TO_DEGREES * 1e6) / 1e6;
};
const seconds = (v: unknown, origin: number): number | null => (v instanceof Date ? (v.getTime() - origin) / 1000 : null);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

// "benchPress" -> "bench_press": a stable key the UI and the muscle-group mapping can use.
const snake = (v: unknown): string | null => (typeof v === "string" && v ? v.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase() : null);

export function parseFit(bytes: Uint8Array): ParsedFit {
  const stream = Stream.fromByteArray(bytes);
  if (!Decoder.isFIT(stream)) throw new FitError("not a FIT file");
  const { messages, errors } = new Decoder(stream).read();
  // Partial results are still useful (a truncated file keeps its first records); only a total failure is an error.
  const records = (messages.recordMesgs ?? []) as Msg[];
  const sessions = (messages.sessionMesgs ?? []) as Msg[];
  if (errors.length && !records.length && !sessions.length) throw new FitError("FIT file could not be decoded");

  const session = sessions[0] ?? {};
  const sessionStart = session.startTime instanceof Date ? session.startTime.getTime() : null;
  const firstRecord = records.find((r) => r.timestamp instanceof Date)?.timestamp as Date | undefined;
  const origin = sessionStart ?? firstRecord?.getTime() ?? 0;

  // One sample per second at most: later records win (some devices write duplicate timestamps).
  const byTime = new Map<number, SampleRow>();
  for (const r of records) {
    const t = seconds(r.timestamp, origin);
    if (t === null || t < 0) continue;
    const sec = Math.round(t);
    byTime.set(sec, {
      t: sec,
      lat: degrees(r.positionLat),
      lon: degrees(r.positionLong),
      alt: num(r.enhancedAltitude) ?? num(r.altitude),
      hr: int(r.heartRate),
      power: int(r.power),
      cadence: int(r.cadence),
      speed: num(r.enhancedSpeed) ?? num(r.speed),
      dist: num(r.distance),
      temp: num(r.temperature),
    });
  }

  const laps: LapRow[] = ((messages.lapMesgs ?? []) as Msg[]).map((l, idx) => ({
    idx,
    start_s: seconds(l.startTime, origin),
    duration_s: num(l.totalTimerTime) ?? num(l.totalElapsedTime),
    distance_m: num(l.totalDistance),
    avg_hr: num(l.avgHeartRate),
    max_hr: num(l.maxHeartRate),
    avg_power: num(l.avgPower),
    avg_speed: num(l.enhancedAvgSpeed) ?? num(l.avgSpeed),
    avg_cadence: num(l.avgCadence),
    ascent_m: num(l.totalAscent),
  }));

  const sets: StrengthSetRow[] = ((messages.setMesgs ?? []) as Msg[]).map((s, idx) => ({
    idx,
    start_s: seconds(s.startTime ?? s.timestamp, origin),
    duration_s: num(s.duration),
    set_type: s.setType === "rest" ? "rest" : "active",
    exercise: snake(first(s.category)),
    reps: int(s.repetitions),
    weight_kg: num(s.weight),
  }));

  return {
    samples: [...byTime.values()].sort((a, b) => a.t - b.t),
    laps,
    sets,
    session: {
      sport: typeof session.sport === "string" ? session.sport : null,
      subSport: typeof session.subSport === "string" ? session.subSport : null,
      normalizedPower: num(session.normalizedPower),
      thresholdPower: num(session.thresholdPower),
      vo2max: null,
    },
  };
}

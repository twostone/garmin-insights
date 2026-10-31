import type { DailySummary, HrvSummary, SleepSummary, SummarizedActivity, HeartRateZones } from "../garmin/client.ts";
import type { ActivityInput } from "../repo/activities.ts";
import type { AthleteSettings } from "../repo/athlete.ts";
import type { DailyRow, HrvRow, SleepRow } from "../repo/health.ts";
import { sportOf } from "../sport.ts";

// Garmin DTOs -> rows. Every field may be missing; nothing here throws on odd data, it just stores null.

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const i = (v: unknown): number | null => {
  const x = n(v);
  return x === null ? null : Math.round(x);
};

/** "2026-08-31 22:01:18" (UTC, no suffix) -> ISO. Falls back to the epoch-less local string. */
function utcIso(gmt: string | undefined, local: string | undefined): string | null {
  const raw = gmt ?? local;
  if (!raw) return null;
  const iso = `${raw.replace(" ", "T")}${gmt ? "Z" : ""}`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

export function mapActivity(a: SummarizedActivity): ActivityInput | null {
  const id = n(a.activityId);
  const start = utcIso(a.startTimeGMT, a.startTimeLocal);
  const date = (a.startTimeLocal ?? a.startTimeGMT)?.slice(0, 10);
  if (id === null || !start || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const typeKey = a.activityType?.typeKey ?? "unknown";
  return {
    id,
    start_utc: start,
    date,
    name: a.activityName ?? null,
    type_key: typeKey,
    sport: sportOf(typeKey),
    distance_m: n(a.distance),
    duration_s: n(a.duration),
    moving_s: n(a.movingDuration),
    elevation_gain_m: n(a.elevationGain),
    avg_hr: n(a.averageHR),
    max_hr: n(a.maxHR),
    avg_power: n(a.avgPower),
    norm_power: n(a.normPower),
    avg_speed: n(a.averageSpeed),
    max_speed: n(a.maxSpeed),
    calories: n(a.calories),
    vo2max: n(a.vO2MaxValue),
    te_aerobic: n(a.aerobicTrainingEffect),
    te_anaerobic: n(a.anaerobicTrainingEffect),
    start_lat: n(a.startLatitude),
    start_lon: n(a.startLongitude),
    total_sets: i(a.totalSets),
    total_reps: i(a.totalReps),
    // The raw summary is kept for fields the app does not model yet (hrTimeInZone_*, fastestSplit_*, maxAvgPower_*, …).
    summary_json: JSON.stringify(a),
  };
}

export type MultisportLink = { parent_id: number | null; is_multisport_parent: 0 | 1 };

// The spec's SummarizedActivityDTO (the list endpoint) documents `parentId`, `isParent` and `parent`; `isMultiSportParent` and
// `childIds` only appear on ActivitySummaryDTO (the single-activity endpoint), so they are read here only in case the list
// carries them too. The type key `multi_sport` is the last resort for a parent.
type MaybeMultisportFields = { isMultiSportParent?: unknown; childIds?: unknown; parent?: unknown };

export function mapMultisport(a: SummarizedActivity): MultisportLink {
  const extra = a as SummarizedActivity & MaybeMultisportFields;
  const parentId = n(a.parentId);
  const isParent =
    extra.isMultiSportParent === true ||
    a.isParent === true ||
    extra.parent === true ||
    (Array.isArray(extra.childIds) && extra.childIds.length > 0) ||
    a.activityType?.typeKey === "multi_sport";
  return { parent_id: parentId, is_multisport_parent: isParent && parentId === null ? 1 : 0 };
}

const hasValue =(row: object, skip: string) => Object.entries(row).some(([k, v]) => k !== skip && v !== null);

export function mapDaily(d: DailySummary): DailyRow | null {
  if (!d.calendarDate) return null;
  const row: DailyRow = {
    date: d.calendarDate,
    steps: i(d.movement?.steps?.value),
    resting_hr: i(d.heartRate?.restingValue),
    min_hr: i(d.heartRate?.minValue),
    max_hr: i(d.heartRate?.maxValue),
    stress_avg: n(d.stress?.avgLevel),
    body_battery_high: i(d.bodyBattery?.maxValue),
    body_battery_low: i(d.bodyBattery?.minValue),
    active_minutes: (n(d.intensityMinutes?.moderate) ?? 0) + 2 * (n(d.intensityMinutes?.vigorous) ?? 0) || null,
  };
  return hasValue(row, "date") ? row : null;
}

export function mapSleep(s: SleepSummary): SleepRow | null {
  if (!s.calendarDate) return null;
  const row: SleepRow = {
    date: s.calendarDate,
    sleep_s: i(s.sleepTimeSeconds),
    deep_s: i(s.deepSleepSeconds),
    light_s: i(s.lightSleepSeconds),
    rem_s: i(s.remSleepSeconds),
    awake_s: i(s.awakeSleepSeconds),
    score: i((s.sleepScores as Record<string, { value?: number }> | undefined)?.overall?.value),
    avg_spo2: n(s.averageSpO2Value),
    avg_respiration: n(s.averageRespirationValue),
    avg_stress: n(s.avgSleepStress),
    avg_hr: n(s.avgHeartRate),
  };
  return row.sleep_s ? row : null;
}

export function mapHrv(h: HrvSummary): HrvRow | null {
  if (!h.calendarDate) return null;
  const row: HrvRow = {
    date: h.calendarDate,
    last_night_avg: i(h.lastNightAvg),
    weekly_avg: i(h.weeklyAvg),
    last_night_5min_high: i(h.lastNight5MinHigh),
    baseline_low: i(h.baseline?.balancedLow),
    baseline_high: i(h.baseline?.balancedUpper),
    status: h.status ?? null,
  };
  return row.last_night_avg !== null || row.weekly_avg !== null ? row : null;
}

// Garmin's zone configuration -> our settings row. The running configuration wins as default for hr_max/lthr; cycling or
// generic ones are the fallback. Pace and power zones are not part of this endpoint (FTP and threshold pace are manual).
export function mapHeartRateZones(zones: HeartRateZones[], validFrom: string): Omit<AthleteSettings, "sex" | "ftp" | "threshold_pace_s_per_km"> | null {
  const pick = zones.find((z) => /run/i.test(z.sport ?? "")) ?? zones.find((z) => /default|generic/i.test(z.sport ?? "")) ?? zones[0];
  if (!pick) return null;
  const floors = [pick.zone1Floor, pick.zone2Floor, pick.zone3Floor, pick.zone4Floor, pick.zone5Floor].filter((x): x is number => typeof x === "number");
  return {
    valid_from: validFrom,
    hr_max: i(pick.maxHeartRateUsed),
    hr_rest: i(pick.restingHeartRateUsed),
    lthr: i(pick.lactateThresholdHeartRateUsed),
    zones_json: floors.length === 5 ? JSON.stringify({ hr: floors }) : null,
    source: "garmin",
  };
}

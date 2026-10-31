// Readiness of one day: HRV, resting HR, sleep, body battery and training form, each rated on its own. The overall status
// is the worst known component, so a single red flag is never averaged away.

export type ReadinessStatus = "good" | "watch" | "poor" | "unknown";
export type ReadinessKey = "hrv" | "resting_hr" | "sleep" | "body_battery" | "tsb";
export type ReadinessComponent = { key: ReadinessKey; value: number | null; reference: number | null; status: ReadinessStatus; reason: string };
export type ReadinessResult = { date: string; status: ReadinessStatus; components: ReadinessComponent[] };
export type ReadinessDay = {
  date: string; hrv: number | null; hrvBaselineLow: number | null; hrvBaselineHigh: number | null; restingHr: number | null;
  sleepS: number | null; sleepScore: number | null; bodyBatteryHigh: number | null; tsb: number | null;
};

/** Days before the rated day that form the personal baseline (same window as the health trends). */
export const BASELINE_DAYS = 28;
/** A baseline from fewer values than this says little; the component stays unknown instead. */
export const MIN_BASELINE_DAYS = 7;

/** Without Garmin's baseline: HRV this far below the 28-day mean counts as "watch" (HRV is noisy day to day, ~10 % is normal scatter). */
export const HRV_FALLBACK_BAND = 0.1;
/** Below the lower bound by more than this share it is "poor" (a clear suppression, not noise). */
export const HRV_POOR_MARGIN = 0.1;

/** Resting HR above the 28-day mean by this many bpm: 3 is within daily variation, 5 or more is a typical sign of fatigue, illness or poor recovery. */
export const RESTING_HR_WATCH_BPM = 3;
export const RESTING_HR_POOR_BPM = 5;

/** Sleep: under 6 h is too little for recovery whatever the habit; under 7 h falls short of the common adult recommendation. */
export const SLEEP_POOR_HOURS = 6;
export const SLEEP_WATCH_HOURS = 7;
/** Sleeping this much less than usual flags a short night even above the minimum. */
export const SLEEP_DROP_WATCH_HOURS = 1;
/** Garmin's sleep score below this is rated "fair" or worse by Garmin itself. */
export const SLEEP_SCORE_WATCH = 60;

/** Body battery at its daily high: how much of the charge the night restored. */
export const BODY_BATTERY_GOOD = 75;
export const BODY_BATTERY_WATCH = 50;

/** Training form bands, as in the MCP `get_training_load` interpretation: from -10 neutral or better, down to -30 productive load, below that overreaching risk. */
export const TSB_GOOD = -10;
export const TSB_WATCH = -30;

const HOUR_S = 3600;
const RANK: Record<ReadinessStatus, number> = { unknown: 0, good: 1, watch: 2, poor: 3 };

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (x: number, digits = 0) => x.toFixed(digits);
const component = (key: ReadinessKey, value: number | null, reference: number | null, status: ReadinessStatus, reason: string): ReadinessComponent => ({ key, value, reference, status, reason });
const unknown = (key: ReadinessKey, reason: string) => component(key, null, null, "unknown", reason);

function hrvComponent(today: ReadinessDay, baseline: readonly number[]): ReadinessComponent {
  if (today.hrv === null) return unknown("hrv", "No HRV value for this night.");
  const avg = baseline.length >= MIN_BASELINE_DAYS ? mean(baseline) : null;
  const garmin = today.hrvBaselineLow !== null && today.hrvBaselineHigh !== null;
  const floor = garmin ? today.hrvBaselineLow! : avg !== null ? avg * (1 - HRV_FALLBACK_BAND) : null;
  if (floor === null) return component("hrv", today.hrv, null, "unknown", "No HRV baseline yet.");
  const source = garmin ? "Garmin's baseline" : "the 28-day average";
  const reference = garmin ? (today.hrvBaselineLow! + today.hrvBaselineHigh!) / 2 : avg;
  if (today.hrv >= floor) return component("hrv", today.hrv, reference, "good", `HRV ${fmt(today.hrv)} ms is within or above ${source}.`);
  const poor = today.hrv < floor * (1 - HRV_POOR_MARGIN);
  return component("hrv", today.hrv, reference, poor ? "poor" : "watch", `HRV ${fmt(today.hrv)} ms is ${poor ? "well " : ""}below ${source} (lower bound ${fmt(floor)} ms).`);
}

function restingHrComponent(today: ReadinessDay, baseline: readonly number[]): ReadinessComponent {
  if (today.restingHr === null) return unknown("resting_hr", "No resting heart rate for this day.");
  const avg = baseline.length >= MIN_BASELINE_DAYS ? mean(baseline) : null;
  if (avg === null) return component("resting_hr", today.restingHr, null, "unknown", "Not enough history for a resting heart rate baseline.");
  const delta = today.restingHr - avg;
  const status = delta >= RESTING_HR_POOR_BPM ? "poor" : delta >= RESTING_HR_WATCH_BPM ? "watch" : "good";
  const sign = delta > 0 ? "+" : "";
  return component("resting_hr", today.restingHr, avg, status, `Resting HR ${fmt(today.restingHr)} bpm is ${sign}${fmt(delta, 1)} bpm against the 28-day average.`);
}

function sleepComponent(today: ReadinessDay, baseline: readonly number[]): ReadinessComponent {
  if (today.sleepS === null) return unknown("sleep", "No sleep data for this night.");
  const hours = today.sleepS / HOUR_S;
  const avg = baseline.length >= MIN_BASELINE_DAYS ? mean(baseline) : null;
  const drop = avg !== null ? avg - hours : 0;
  const lowScore = today.sleepScore !== null && today.sleepScore < SLEEP_SCORE_WATCH;
  const status = hours < SLEEP_POOR_HOURS ? "poor" : hours < SLEEP_WATCH_HOURS || drop >= SLEEP_DROP_WATCH_HOURS || lowScore ? "watch" : "good";
  const notes = [avg !== null ? `${fmt(avg, 1)} h on average` : null, today.sleepScore !== null ? `score ${fmt(today.sleepScore)}` : null].filter(Boolean).join(", ");
  return component("sleep", hours, avg, status, `Slept ${fmt(hours, 1)} h${notes ? ` (${notes})` : ""}.`);
}

function bodyBatteryComponent(today: ReadinessDay): ReadinessComponent {
  const v = today.bodyBatteryHigh;
  if (v === null) return unknown("body_battery", "No body battery value for this day.");
  const status = v >= BODY_BATTERY_GOOD ? "good" : v >= BODY_BATTERY_WATCH ? "watch" : "poor";
  return component("body_battery", v, BODY_BATTERY_GOOD, status, `Body battery peaked at ${fmt(v)}.`);
}

function tsbComponent(today: ReadinessDay): ReadinessComponent {
  const v = today.tsb;
  if (v === null) return unknown("tsb", "No training load for this day.");
  const status = v >= TSB_GOOD ? "good" : v >= TSB_WATCH ? "watch" : "poor";
  const sign = v > 0 ? "+" : "";
  return component("tsb", v, TSB_GOOD, status, `Training form (TSB) is ${sign}${fmt(v, 1)}.`);
}

/** Rates `date` from the days before it (up to 28) and the day itself. `days` may hold more or fewer days and gaps. */
export function readiness(days: readonly ReadinessDay[], date: string): ReadinessResult {
  const today = days.find((d) => d.date === date) ?? { date, hrv: null, hrvBaselineLow: null, hrvBaselineHigh: null, restingHr: null, sleepS: null, sleepScore: null, bodyBatteryHigh: null, tsb: null };
  const before = days.filter((d) => d.date < date).sort((a, b) => a.date.localeCompare(b.date)).slice(-BASELINE_DAYS);
  const present = <T>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);
  const components = [
    hrvComponent(today, present(before.map((d) => d.hrv))),
    restingHrComponent(today, present(before.map((d) => d.restingHr))),
    sleepComponent(today, present(before.map((d) => (d.sleepS === null ? null : d.sleepS / HOUR_S)))),
    bodyBatteryComponent(today),
    tsbComponent(today),
  ];
  const status = components.reduce<ReadinessStatus>((worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst), "unknown");
  return { date, status, components };
}

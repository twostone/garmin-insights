import { addDays } from "../dates.ts";

// Training load. Pure functions: samples and thresholds in, numbers out.
//
// - TRIMP (Banister): minutes * HRr * a * e^(b * HRr), HRr = (HR - rest) / (max - rest); a/b = 0.64/1.92 (male), 0.86/1.67 (female).
//   Works for every sport that has heart rate, including strength training.
// - hrTSS: TRIMP scaled so that one hour at LTHR is 100 (the TrainingPeaks approach).
// - Power: normalized power (30 s rolling average, 4th-power mean), IF = NP/FTP, TSS = h * NP * IF / FTP * 100 (Coggan).
// - rTSS: h * IF^2 * 100 with IF = normalized speed / threshold speed. No grade adjustment: documented simplification.
// - PMC: CTL (42 d) and ATL (7 d) as exponentially weighted averages, TSB = yesterday's CTL - yesterday's ATL.

export type Sample = { t: number; hr?: number | null; power?: number | null; speed?: number | null; dist?: number | null };
export type HrConfig = { hrRest: number; hrMax: number; sex?: "m" | "f" | null };

/** A sample stands for the time until the next one; a longer gap is a pause and counts as one nominal second. */
const MAX_GAP_S = 10;
const NOMINAL_STEP_S = 1;
const ROLLING_WINDOW_S = 30;
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

const COEFFICIENTS = { m: { a: 0.64, b: 1.92 }, f: { a: 0.86, b: 1.67 } } as const;

export function stepSeconds(samples: readonly { t: number }[], i: number): number {
  const next = samples[i + 1];
  if (!next) return NOMINAL_STEP_S;
  const gap = next.t - samples[i]!.t;
  return gap > 0 && gap <= MAX_GAP_S ? gap : NOMINAL_STEP_S;
}

const reserve = (hr: number, c: HrConfig) => Math.min(1, (hr - c.hrRest) / (c.hrMax - c.hrRest));
const perMinute = (hrr: number, sex: "m" | "f" | null | undefined) => {
  const { a, b } = COEFFICIENTS[sex ?? "m"];
  return hrr * a * Math.exp(b * hrr);
};

export function trimp(samples: readonly Sample[], c: HrConfig): number {
  if (c.hrMax <= c.hrRest) return 0;
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const hr = samples[i]!.hr;
    if (!hr || hr <= c.hrRest) continue;
    total += (stepSeconds(samples, i) / 60) * perMinute(reserve(hr, c), c.sex);
  }
  return total;
}

/** For activities without a sample series (no FIT file): constant average HR for the whole duration. */
export function trimpFromAverage(durationS: number, avgHr: number, c: HrConfig): number {
  if (c.hrMax <= c.hrRest || avgHr <= c.hrRest) return 0;
  return (durationS / 60) * perMinute(reserve(avgHr, c), c.sex);
}

export function hrTss(activityTrimp: number, c: HrConfig & { lthr: number }): number {
  const oneHourAtLthr = 60 * perMinute(reserve(c.lthr, c), c.sex);
  return oneHourAtLthr > 0 ? (activityTrimp / oneHourAtLthr) * 100 : 0;
}

/** Rolling mean over `window` values, 4th-power mean, root. Shorter series: the plain mean. */
function rollingFourthPowerMean(values: readonly number[], window: number): number {
  if (!values.length) return 0;
  if (values.length < window) return values.reduce((a, b) => a + b, 0) / values.length;
  let sum = 0;
  let acc = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= window) sum -= values[i - window]!;
    if (i >= window - 1) {
      acc += (sum / window) ** 4;
      count++;
    }
  }
  return (acc / count) ** 0.25;
}

/** `power`: one value per second (see `perSecond`). */
export const normalizedPower = (power: readonly number[]): number => rollingFourthPowerMean(power, ROLLING_WINDOW_S);
export const normalizedSpeed = (speed: readonly number[]): number => rollingFourthPowerMean(speed, ROLLING_WINDOW_S);

/** Resamples to one value per second; pauses (gaps over the limit) are left out, short gaps keep the last value. */
export function perSecond(samples: readonly Sample[], pick: (s: Sample) => number | null | undefined): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const v = pick(samples[i]!);
    if (v === null || v === undefined) continue;
    const steps = Math.max(1, Math.round(stepSeconds(samples, i)));
    for (let k = 0; k < steps; k++) out.push(v);
  }
  return out;
}

export const intensityFactor = (np: number, ftp: number): number => (ftp > 0 ? np / ftp : 0);
export const powerTss = (durationS: number, np: number, ftp: number): number => (ftp > 0 ? ((durationS * np * intensityFactor(np, ftp)) / (ftp * 3600)) * 100 : 0);
export const rTss = (durationS: number, normSpeedMps: number, thresholdSpeedMps: number): number =>
  thresholdSpeedMps > 0 ? (durationS / 3600) * (normSpeedMps / thresholdSpeedMps) ** 2 * 100 : 0;

export type PmcRow = { date: string; load: number; ctl: number; atl: number; tsb: number };

/** Performance management chart over `from..to` (inclusive). Days without an entry are rest days. */
export function pmc(
  loadByDate: ReadonlyMap<string, number>,
  o: { from: string; to: string; seed?: { ctl: number; atl: number } },
): PmcRow[] {
  const kCtl = 1 - Math.exp(-1 / CTL_DAYS);
  const kAtl = 1 - Math.exp(-1 / ATL_DAYS);
  let ctl = o.seed?.ctl ?? 0;
  let atl = o.seed?.atl ?? 0;
  const rows: PmcRow[] = [];
  for (let date = o.from; date <= o.to; date = addDays(date, 1)) {
    const load = loadByDate.get(date) ?? 0;
    const tsb = ctl - atl;
    ctl += (load - ctl) * kCtl;
    atl += (load - atl) * kAtl;
    rows.push({ date, load, ctl, atl, tsb });
  }
  return rows;
}

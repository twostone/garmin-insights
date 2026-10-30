// Health trends: resting heart rate, HRV and sleep against the training load.

/** Trailing mean over `window` entries, ignoring gaps; null when the window holds no value. */
export function rolling(values: readonly (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => mean(values.slice(Math.max(0, i - window + 1), i + 1)));
}

const mean = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Pearson correlation over the pairs where both values exist; null with fewer than 3 pairs or no variance. */
export function pearson(xs: readonly (number | null)[], ys: readonly (number | null)[]): number | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i < xs.length; i++) if (xs[i] !== null && xs[i] !== undefined && ys[i] !== null && ys[i] !== undefined) pairs.push([xs[i]!, ys[i]!]);
  if (pairs.length < 3) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
  const my = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

export type TrendMetric = { avg7: number | null; baseline28: number | null; deltaVsBaseline: number | null };
export type HealthTrends = {
  points: { date: string; restingHr: number | null; restingHr7: number | null; hrv: number | null; hrv7: number | null; sleepHours: number | null; sleep7: number | null; atl: number | null }[];
  latest: { restingHr: TrendMetric; hrv: TrendMetric; sleepHours: TrendMetric };
  correlations: { restingHrVsAtl: number | null; hrvVsAtl: number | null; sleepVsAtl: number | null };
};

const RECENT_DAYS = 7;
const BASELINE_DAYS = 28;

// The last 7 days against the 28 days before them: a rising resting HR or falling HRV against the baseline while the load
// goes up is the classic sign of accumulated fatigue.
function metric(values: readonly (number | null)[]): TrendMetric {
  const n = values.length;
  const avg7 = mean(values.slice(Math.max(0, n - RECENT_DAYS)));
  const baseline28 = mean(values.slice(Math.max(0, n - RECENT_DAYS - BASELINE_DAYS), Math.max(0, n - RECENT_DAYS)));
  return { avg7, baseline28, deltaVsBaseline: avg7 !== null && baseline28 !== null ? avg7 - baseline28 : null };
}

export function healthTrends(i: {
  dates: readonly string[];
  restingHr: readonly (number | null)[];
  hrv: readonly (number | null)[];
  sleepHours: readonly (number | null)[];
  atl: readonly (number | null)[];
}): HealthTrends {
  const r7 = rolling(i.restingHr, RECENT_DAYS);
  const h7 = rolling(i.hrv, RECENT_DAYS);
  const s7 = rolling(i.sleepHours, RECENT_DAYS);
  return {
    points: i.dates.map((date, k) => ({
      date, restingHr: i.restingHr[k] ?? null, restingHr7: r7[k] ?? null, hrv: i.hrv[k] ?? null, hrv7: h7[k] ?? null,
      sleepHours: i.sleepHours[k] ?? null, sleep7: s7[k] ?? null, atl: i.atl[k] ?? null,
    })),
    latest: { restingHr: metric(i.restingHr), hrv: metric(i.hrv), sleepHours: metric(i.sleepHours) },
    correlations: { restingHrVsAtl: pearson(i.atl, i.restingHr), hrvVsAtl: pearson(i.atl, i.hrv), sleepVsAtl: pearson(i.atl, i.sleepHours) },
  };
}

import { stepSeconds } from "./load.ts";

// Artifacts of optical heart-rate measurement: single samples far off the trace (sensor glitch, lost skin contact) that
// would otherwise set the maximum and add zone-5 time and load. A sample is an artifact if
//   - the heart rate jumps by more than MAX_HR_JUMP_BPM_PER_S and comes back to the level before the jump within
//     SPIKE_MAX_DURATION_S (upwards spikes and drop-outs alike), or
//   - it lies above hrMax + HR_MAX_TOLERANCE_BPM for at most SPIKE_MAX_DURATION_S and then drops below again.
// Artifacts become `hr: null`, nothing is interpolated. The raw samples in the database stay as recorded.
// Rates use the real time step, so smart recording (a sample every few seconds) and pauses are no jumps.

/** A real heart rate rises by a few bpm per second at most; the observed spikes jump by 60-80 bpm within one second. */
export const MAX_HR_JUMP_BPM_PER_S = 15;
/** Observed spikes last one to three samples; a real effort keeps the heart rate up much longer. */
export const SPIKE_MAX_DURATION_S = 10;
/** hr_max is an estimate that a real maximum can overshoot by a few beats. */
export const HR_MAX_TOLERANCE_BPM = 5;
/** "Back to the level before the jump": within this distance of the last good value. */
const BASELINE_TOLERANCE_BPM = 10;

type HrSample = { t: number; hr?: number | null };
export type CleanHr<T> = { samples: T[]; artifactSeconds: number; maxHrClean: number | null };

const hasHr = (s: HrSample): s is HrSample & { hr: number } => typeof s.hr === "number";

/** Indices of jump spikes: from the jump up to (not including) the first sample back near the baseline. */
function jumpSpikes(samples: readonly HrSample[]): Set<number> {
  const out = new Set<number>();
  let base: (HrSample & { hr: number }) | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    if (!hasHr(s)) continue;
    const dt = base ? s.t - base.t : 0;
    if (!base || dt <= 0 || Math.abs(s.hr - base.hr) / dt <= MAX_HR_JUMP_BPM_PER_S) {
      base = s;
      continue;
    }
    const back = findIndex(samples, i + 1, (x) => x.t - s.t <= SPIKE_MAX_DURATION_S, (x) => Math.abs(x.hr - base!.hr) <= BASELINE_TOLERANCE_BPM);
    if (back < 0) {
      base = s; // a lasting change of level, not a spike
      continue;
    }
    for (let k = i; k < back; k++) out.add(k);
    i = back - 1;
  }
  return out;
}

/** Indices of short excursions above the limit that drop below it again within SPIKE_MAX_DURATION_S. */
function shortExcursions(samples: readonly HrSample[], skip: Set<number>, limit: number): Set<number> {
  const out = new Set<number>();
  const above = (i: number) => !skip.has(i) && hasHr(samples[i]!) && samples[i]!.hr! > limit;
  for (let i = 0; i < samples.length; i++) {
    if (!above(i)) continue;
    const start = samples[i]!;
    const below = findIndex(samples, i + 1, () => true, (x, k) => !skip.has(k) && x.hr <= limit);
    if (below >= 0 && samples[below]!.t - start.t <= SPIKE_MAX_DURATION_S) for (let k = i; k < below; k++) if (above(k)) out.add(k);
    i = below < 0 ? samples.length : below - 1;
  }
  return out;
}

/** First index from `from` on whose sample has a heart rate and matches `hit`, while `within` holds; -1 if none. */
function findIndex(
  samples: readonly HrSample[],
  from: number,
  within: (s: HrSample) => boolean,
  hit: (s: HrSample & { hr: number }, i: number) => boolean,
): number {
  for (let k = from; k < samples.length && within(samples[k]!); k++) {
    const x = samples[k]!;
    if (hasHr(x) && hit(x, k)) return k;
  }
  return -1;
}

export function cleanHr<T extends HrSample>(samples: readonly T[], hrMax: number | null): CleanHr<T> {
  const artifacts = jumpSpikes(samples);
  if (hrMax !== null) for (const k of shortExcursions(samples, artifacts, hrMax + HR_MAX_TOLERANCE_BPM)) artifacts.add(k);
  let artifactSeconds = 0;
  let maxHrClean: number | null = null;
  const cleaned = samples.map((s, i) => {
    if (artifacts.has(i)) {
      artifactSeconds += stepSeconds(samples, i);
      return { ...s, hr: null };
    }
    if (hasHr(s) && (maxHrClean === null || s.hr > maxHrClean)) maxHrClean = s.hr;
    return s;
  });
  return { samples: cleaned, artifactSeconds: Math.round(artifactSeconds), maxHrClean };
}

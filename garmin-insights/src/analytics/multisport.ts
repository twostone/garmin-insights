// Multisport activities: a parent (e.g. "multi_sport") with one child activity per leg. Garmin often leaves the parent's
// average HR empty, and its max HR is the raw one (the parent has no samples to clean); both are derived from the legs here,
// for the output only. The stored summary stays as Garmin sent it.

export type Leg = {
  id: number; sport: string; type_key: string; start_utc: string; duration_s: number | null; avg_hr: number | null; tss: number | null;
  max_hr?: number | null; max_hr_clean?: number | null; hr_artifact_s?: number | null;
};

export type LegOverview = { id: number; sport: string; garmin_type: string; start_offset_s: number; duration_s: number | null; avg_hr: number | null; tss: number | null };

const round = (v: number | null, digits = 0): number | null => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

/** Average HR over all legs, weighted by each leg's duration; legs without HR or duration are left out. */
export function durationWeightedHr(legs: Pick<Leg, "duration_s" | "avg_hr">[]): number | null {
  let seconds = 0;
  let beats = 0;
  for (const l of legs) {
    if (l.avg_hr === null || !l.duration_s || l.duration_s <= 0) continue;
    seconds += l.duration_s;
    beats += l.avg_hr * l.duration_s;
  }
  return seconds ? round(beats / seconds) : null;
}

/** The parent's own average HR, or the legs' weighted one when Garmin sent none. */
export const parentAvgHr = (parent: { avg_hr: number | null }, legs: Leg[]): number | null => parent.avg_hr ?? durationWeightedHr(legs);

type HrFields = { avg_hr: number | null; max_hr_clean: number | null; hr_artifact_s: number | null };

/**
 * The parent's HR fields for the output: average from the legs (see parentAvgHr) and, once a leg has been checked for
 * artifacts, the highest cleaned leg maximum with the legs' artifact seconds summed. Without legs the parent stays as it is.
 */
export function parentHr<T extends HrFields>(parent: T, legs: Leg[]): T {
  const checked = legs.filter((l) => l.hr_artifact_s !== null && l.hr_artifact_s !== undefined);
  if (!checked.length) return { ...parent, avg_hr: parentAvgHr(parent, legs) };
  const maxima = legs.map((l) => l.max_hr_clean ?? l.max_hr ?? null).filter((v): v is number => v !== null);
  return {
    ...parent,
    avg_hr: parentAvgHr(parent, legs),
    max_hr_clean: maxima.length ? Math.max(...maxima) : parent.max_hr_clean,
    hr_artifact_s: checked.reduce((sum, l) => sum + (l.hr_artifact_s ?? 0), 0),
  };
}

/** The legs as shown under their parent, with start offsets relative to the parent's start. */
export function legOverview(parent: { start_utc: string }, legs: Leg[]): LegOverview[] {
  const origin = Date.parse(parent.start_utc);
  return legs.map((l) => ({
    id: l.id,
    sport: l.sport,
    garmin_type: l.type_key,
    start_offset_s: Math.max(0, Math.round((Date.parse(l.start_utc) - origin) / 1000)),
    duration_s: round(l.duration_s),
    avg_hr: round(l.avg_hr),
    tss: round(l.tss, 1),
  }));
}

import { todayLocal } from "../dates.ts";
import { logger } from "../log.ts";
import type { ActivityRow, SampleRow } from "../repo/activities.ts";
import type { Repos } from "../repo/index.ts";
import { activityLoad } from "./activity-load.ts";
import { cleanHr, type CleanHr } from "./hr-artifacts.ts";
import { pmc } from "./load.ts";

// Glue between the repos and the pure load functions: computes the load of every activity from `fromDate` on (with the
// athlete settings valid on its day), then the daily PMC from there to today. Earlier PMC rows stay; the series continues
// from the row before `fromDate`.
export function recomputeLoads(repos: Repos, userId: string, fromDate: string, today: string = todayLocal()): void {
  // New FIT files first, so that the historic HR max (fallback without a configured one) does not take their spikes.
  for (const a of repos.activities.hrUncleaned(userId)) storeHrClean(repos, userId, a.id, cleanedSamples(repos, userId, a));
  const historicHrMax = repos.activities.maxHr(userId);
  const activities = repos.activities.list(userId, { from: fromDate, limit: 1_000_000, order: "asc" });
  for (const a of activities) {
    const settings = repos.athlete.at(userId, a.date);
    const cleaned = a.fit_status === "done" ? cleanedSamples(repos, userId, a) : null;
    if (cleaned) storeHrClean(repos, userId, a.id, cleaned);
    const samples = cleaned?.samples ?? null;
    const load = activityLoad(
      a,
      samples,
      { hrRest: settings?.hr_rest, hrMax: settings?.hr_max, lthr: settings?.lthr, ftp: settings?.ftp, thresholdPaceSPerKm: settings?.threshold_pace_s_per_km, sex: settings?.sex },
      historicHrMax,
    );
    repos.activities.setLoad(userId, a.id, { trimp: load.trimp, tss: load.tss, tss_method: load.method });
  }

  const daily = repos.activities.dailyLoad(userId, fromDate, today);
  const seedRow = repos.analytics.lastBefore(userId, fromDate);
  const rows = pmc(new Map(daily.map((d) => [d.date, d.tss])), { from: fromDate, to: today < fromDate ? fromDate : today, seed: seedRow ? { ctl: seedRow.ctl, atl: seedRow.atl } : undefined });
  const trimpByDate = new Map(daily.map((d) => [d.date, d.trimp]));
  repos.analytics.replaceFrom(userId, fromDate, rows.map((r) => ({ date: r.date, trimp: trimpByDate.get(r.date) ?? 0, tss: r.load, ctl: r.ctl, atl: r.atl, tsb: r.tsb })));
}

const log = logger("recompute");

/** The samples every analysis works on: heart rate cleaned of artifacts against the HR max valid on the activity's day. */
export function cleanedSamples(repos: Repos, userId: string, a: Pick<ActivityRow, "id" | "date">): CleanHr<SampleRow> {
  return cleanHr(repos.activities.samples(userId, a.id), repos.athlete.at(userId, a.date)?.hr_max ?? null);
}

/** Like the stored samples, cleaned, optionally cut to a time window (cleaned before cutting, so the edges see their neighbours). */
export function analysisSamples(repos: Repos, userId: string, a: Pick<ActivityRow, "id" | "date">, win: { from?: number; to?: number } = {}): SampleRow[] {
  const rows = cleanedSamples(repos, userId, a).samples;
  return win.from === undefined && win.to === undefined ? rows : rows.filter((s) => s.t >= (win.from ?? 0) && s.t <= (win.to ?? Infinity));
}

// The cleaned maximum is only stored when something was removed; otherwise Garmin's own max_hr stays the reference.
// hr_artifact_s = 0 marks an activity as checked.
function storeHrClean(repos: Repos, userId: string, id: number, c: CleanHr<SampleRow>): void {
  repos.activities.setHrClean(userId, id, { max_hr_clean: c.artifactSeconds > 0 ? c.maxHrClean : null, hr_artifact_s: c.artifactSeconds });
}

/**
 * Existing data from before HR cleaning (and anything else with a FIT file but no check yet): recompute from the oldest
 * such activity on. Runs at start; a no-op once everything is checked, so no migration is needed.
 */
export function recomputeUncleanedHr(repos: Repos, userId: string, today: string = todayLocal()): void {
  const pending = repos.activities.hrUncleaned(userId);
  if (!pending.length) return;
  const from = pending.reduce((min, a) => (a.date < min ? a.date : min), pending[0]!.date);
  const t0 = Date.now();
  recomputeLoads(repos, userId, from, today);
  log.info("hr_cleaned", { activities: pending.length, ms: Date.now() - t0 });
}

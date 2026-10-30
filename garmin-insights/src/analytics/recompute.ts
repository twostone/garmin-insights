import { todayLocal } from "../dates.ts";
import type { Repos } from "../repo/index.ts";
import { activityLoad } from "./activity-load.ts";
import { pmc } from "./load.ts";

// Glue between the repos and the pure load functions: computes the load of every activity from `fromDate` on (with the
// athlete settings valid on its day), then the daily PMC from there to today. Earlier PMC rows stay; the series continues
// from the row before `fromDate`.
export function recomputeLoads(repos: Repos, userId: string, fromDate: string, today: string = todayLocal()): void {
  const historicHrMax = repos.activities.maxHr(userId);
  const activities = repos.activities.list(userId, { from: fromDate, limit: 1_000_000, order: "asc" });
  for (const a of activities) {
    const settings = repos.athlete.at(userId, a.date);
    const samples = a.fit_status === "done" ? repos.activities.samples(userId, a.id) : null;
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

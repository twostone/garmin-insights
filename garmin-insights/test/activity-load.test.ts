import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLoad } from "../src/analytics/activity-load.ts";
import { recomputeLoads } from "../src/analytics/recompute.ts";
import { activity, memoryRepos, seedUser } from "./helpers.ts";
import type { Sample } from "../src/analytics/load.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);
const steady = (seconds: number, v: Partial<Sample>): Sample[] => Array.from({ length: seconds }, (_, t) => ({ t, ...v }));
const th = { hrRest: 50, hrMax: 190, lthr: 170, ftp: 250, thresholdPaceSPerKm: 300, sex: null };

test("cycling with power and FTP: power TSS, plus TRIMP from heart rate", () => {
  const r = activityLoad({ sport: "cycling", duration_s: 3600, avg_hr: 150, avg_power: 250, norm_power: 250, avg_speed: 8 }, steady(3600, { hr: 150, power: 250 }), th, null);
  assert.equal(r.method, "power");
  close(r.tss!, 100, 1e-6);
  assert.ok(r.trimp! > 50);
});

test("running with threshold pace: rTSS at threshold pace for an hour = 100", () => {
  const r = activityLoad({ sport: "running", duration_s: 3600, avg_hr: 165, avg_power: null, norm_power: null, avg_speed: 1000 / 300 }, steady(3600, { hr: 165, speed: 1000 / 300 }), th, null);
  assert.equal(r.method, "run_pace");
  close(r.tss!, 100, 1e-6);
});

test("everything else (strength, swimming, running without pace): heart-rate based hrTSS", () => {
  const r = activityLoad({ sport: "strength", duration_s: 3600, avg_hr: 170, avg_power: null, norm_power: null, avg_speed: null }, steady(3600, { hr: 170 }), th, null);
  assert.equal(r.method, "hr");
  close(r.tss!, 100, 0.1);
  const noPace = activityLoad({ sport: "running", duration_s: 3600, avg_hr: 170, avg_power: null, norm_power: null, avg_speed: 3 }, steady(3600, { hr: 170, speed: 3 }), { ...th, thresholdPaceSPerKm: null }, null);
  assert.equal(noPace.method, "hr");
});

test("no FIT detail: uses the summary (average HR, normalized power, average speed)", () => {
  const ride = activityLoad({ sport: "cycling", duration_s: 3600, avg_hr: 140, avg_power: 200, norm_power: 250, avg_speed: 8 }, null, th, null);
  assert.equal(ride.method, "power");
  close(ride.tss!, 100, 1e-6);
  const hr = activityLoad({ sport: "other", duration_s: 3600, avg_hr: 170, avg_power: null, norm_power: null, avg_speed: null }, null, th, null);
  close(hr.tss!, 100, 0.1);
});

test("without any thresholds the HR max falls back to the highest HR seen and LTHR to 88 % of it (marked as estimated)", () => {
  const r = activityLoad({ sport: "strength", duration_s: 3600, avg_hr: 150, avg_power: null, norm_power: null, avg_speed: null }, null, {}, 195);
  assert.equal(r.method, "hr_estimated");
  assert.ok(r.tss! > 0 && r.trimp! > 0);
  const none = activityLoad({ sport: "strength", duration_s: 3600, avg_hr: null, avg_power: null, norm_power: null, avg_speed: null }, null, {}, null);
  assert.deepEqual(none, { trimp: null, tss: null, method: null });
});

test("recompute: loads per activity with the settings valid that day, daily PMC up to today, incremental from a date", () => {
  const repos = memoryRepos();
  seedUser(repos, "u");
  const base = { hr_max: 190, hr_rest: 50, lthr: 170, threshold_pace_s_per_km: null, sex: null, zones_json: null, source: "manual" as const };
  repos.athlete.upsert("u", { ...base, valid_from: "2026-01-01", ftp: 200 });
  repos.athlete.upsert("u", { ...base, valid_from: "2026-10-03", ftp: 400 });
  const ride = (id: number, date: string) => activity(id, date, { sport: "cycling", type_key: "cycling", duration_s: 3600, avg_hr: 140, avg_power: 200, norm_power: 200 });
  repos.activities.upsertSummary("u", ride(1, "2026-10-01"));
  repos.activities.upsertSummary("u", ride(2, "2026-10-04"));
  recomputeLoads(repos, "u", "2026-10-01", "2026-10-06");
  close(repos.activities.get("u", 1)!.tss!, 100, 1e-6); // FTP 200: one hour at FTP
  close(repos.activities.get("u", 2)!.tss!, 25, 1e-6); // FTP 400: (200/400)^2 * 100
  const days = repos.analytics.range("u", "2026-10-01", "2026-10-06");
  assert.equal(days.length, 6);
  assert.equal(days[1]!.tss, 0);
  close(days[0]!.ctl, 100 * (1 - Math.exp(-1 / 42)), 1e-9);
  assert.ok(days[3]!.tss === 25 && days[5]!.ctl < days[3]!.ctl + 1);

  // Incremental: a new activity on the 6th only rewrites from that day on, earlier rows are kept.
  repos.activities.upsertSummary("u", ride(3, "2026-10-06"));
  const before = repos.analytics.range("u", "2026-10-01", "2026-10-05");
  recomputeLoads(repos, "u", "2026-10-06", "2026-10-06");
  assert.deepEqual(repos.analytics.range("u", "2026-10-01", "2026-10-05"), before);
  const last = repos.analytics.range("u", "2026-10-06", "2026-10-06")[0]!;
  assert.equal(last.tss, 25);
  assert.ok(last.ctl > before[4]!.ctl * (1 - 1 / 42) );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLoad } from "../src/analytics/activity-load.ts";
import { recomputeLoads, recomputeUncleanedHr } from "../src/analytics/recompute.ts";
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

test("recompute cleans HR artifacts: stored max_hr_clean and hr_artifact_s, load and historic max without the spike", () => {
  const repos = memoryRepos();
  seedUser(repos, "u");
  const rows = (spike: boolean) =>
    Array.from({ length: 3600 }, (_, t) => ({ t, lat: null, lon: null, alt: null, hr: spike && t === 1000 ? 230 : 140, power: null, cadence: null, speed: null, dist: null, temp: null }));
  const rowing = (id: number, date: string, maxHr: number) => activity(id, date, { sport: "other", type_key: "indoor_rowing", duration_s: 3600, avg_hr: 140, max_hr: maxHr });
  for (const [id, spike] of [[1, true], [2, false]] as const) {
    repos.activities.upsertSummary("u", rowing(id, "2026-10-01", spike ? 230 : 140));
    repos.activities.replaceDetail("u", id, { samples: rows(spike), laps: [], sets: [] });
    repos.activities.setFitStatus("u", id, "done");
  }
  assert.equal(repos.activities.hrUncleaned("u").length, 2);
  // No HR max configured: only the jump rule, and the historic max (fallback) must already be the cleaned one.
  recomputeLoads(repos, "u", "2026-10-01", "2026-10-01");
  const spiky = repos.activities.get("u", 1)!;
  const clean = repos.activities.get("u", 2)!;
  assert.equal(spiky.max_hr_clean, 140);
  assert.equal(spiky.hr_artifact_s, 1);
  assert.equal(spiky.max_hr, 230, "raw value stays");
  assert.equal(clean.max_hr_clean, null, "nothing removed: Garmin's max stays the reference");
  assert.equal(clean.hr_artifact_s, 0, "checked");
  assert.equal(repos.activities.maxHr("u"), 140);
  close(spiky.trimp!, clean.trimp!, 0.1); // one second at 140 less
  close(spiky.tss!, clean.tss!, 0.1);
  assert.deepEqual(repos.activities.hrUncleaned("u"), []);
});

test("existing data: recomputeUncleanedHr recomputes from the oldest unchecked activity once, then does nothing", () => {
  const repos = memoryRepos();
  seedUser(repos, "u");
  repos.athlete.upsert("u", { valid_from: "2026-01-01", hr_max: 176, hr_rest: 50, lthr: 160, ftp: null, threshold_pace_s_per_km: null, sex: null, zones_json: null, source: "manual" });
  const hr = [...Array(60).fill(172), 175, 180, 183, 183, 182, 178, ...Array(60).fill(172)];
  repos.activities.upsertSummary("u", activity(1, "2026-10-10", { sport: "other", type_key: "cardio", duration_s: hr.length, avg_hr: 172, max_hr: 183 }));
  repos.activities.replaceDetail("u", 1, { samples: hr.map((v, t) => ({ t, lat: null, lon: null, alt: null, hr: v, power: null, cadence: null, speed: null, dist: null, temp: null })), laps: [], sets: [] });
  repos.activities.setFitStatus("u", 1, "done");
  recomputeUncleanedHr(repos, "u", "2026-10-12");
  assert.equal(repos.activities.get("u", 1)!.max_hr_clean, 180);
  assert.equal(repos.activities.get("u", 1)!.hr_artifact_s, 3);
  assert.equal(repos.analytics.range("u", "2026-10-10", "2026-10-12").length, 3, "PMC from that day on");
  repos.activities.setLoad("u", 1, { trimp: 1, tss: 1, tss_method: "marker" });
  recomputeUncleanedHr(repos, "u", "2026-10-12");
  assert.equal(repos.activities.get("u", 1)!.tss_method, "marker", "second start: nothing to do");
});

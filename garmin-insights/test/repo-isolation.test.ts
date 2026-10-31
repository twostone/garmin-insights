import { test } from "node:test";
import assert from "node:assert/strict";
import { activity, memoryRepos, seedUser } from "./helpers.ts";

// Every repo method takes the user id; these tests fill two users and check that nothing crosses over.
function twoUsers() {
  const repos = memoryRepos();
  seedUser(repos, "alice");
  seedUser(repos, "bob");
  repos.activities.upsertSummary("alice", activity(1, "2026-10-01"));
  repos.activities.upsertSummary("alice", activity(2, "2026-10-02", { sport: "strength", type_key: "strength_training" }));
  repos.activities.upsertSummary("bob", activity(1, "2026-10-03")); // same Garmin id, different user
  repos.activities.replaceDetail("alice", 1, {
    samples: [{ t: 0, lat: null, lon: null, alt: null, hr: 100, power: null, cadence: null, speed: 3, dist: 0, temp: null }],
    laps: [{ idx: 0, start_s: 0, duration_s: 10, distance_m: 30, avg_hr: 100, max_hr: 110, avg_power: null, avg_speed: 3, avg_cadence: null, ascent_m: 0 }],
    sets: [{ idx: 0, start_s: 0, duration_s: 30, set_type: "active", exercise: "squat", reps: 5, weight_kg: 100 }],
  });
  repos.health.dailies.upsertMany("alice", [{ date: "2026-10-01", steps: 9000, resting_hr: 50, min_hr: 45, max_hr: 150, stress_avg: 30, body_battery_high: 90, body_battery_low: 10, active_minutes: 30 }]);
  repos.health.sleep.upsertMany("alice", [{ date: "2026-10-01", sleep_s: 28000, deep_s: 5000, light_s: 15000, rem_s: 6000, awake_s: 2000, score: 80, avg_spo2: 95, avg_respiration: 14, avg_stress: 20, avg_hr: 50 }]);
  repos.health.hrv.upsertMany("alice", [{ date: "2026-10-01", last_night_avg: 60, weekly_avg: 58, last_night_5min_high: 80, baseline_low: 50, baseline_high: 70, status: "BALANCED" }]);
  repos.athlete.upsert("alice", { valid_from: "2026-01-01", hr_max: 190, hr_rest: 50, lthr: 170, ftp: 250, threshold_pace_s_per_km: 270, sex: "m", zones_json: null, source: "manual" });
  repos.analytics.replaceFrom("alice", "2026-10-01", [{ date: "2026-10-01", trimp: 100, tss: 80, ctl: 10, atl: 20, tsb: -10 }]);
  repos.syncState.save("alice", "activities", { cursor: "2026-01-01", items: 2 });
  repos.keys.put("alice", "cipher", null);
  return repos;
}

test("activities: lists, counts, gets and detail rows only see the own user", () => {
  const r = twoUsers();
  assert.deepEqual(r.activities.list("bob").map((a) => a.date), ["2026-10-03"]);
  assert.equal(r.activities.count("bob"), 1);
  assert.equal(r.activities.count("alice"), 2);
  assert.equal(r.activities.get("bob", 2), undefined);
  assert.equal(r.activities.samples("bob", 1).length, 0);
  assert.equal(r.activities.laps("bob", 1).length, 0);
  assert.equal(r.activities.sets("bob", 1).length, 0);
  assert.equal(r.activities.setsInRange("bob", "2026-01-01", "2026-12-31").length, 0);
  assert.equal(r.activities.setsInRange("alice", "2026-01-01", "2026-12-31").length, 1);
  assert.equal(r.activities.calendar("bob", "2026-10-01", "2026-10-31").length, 1);
  assert.equal(r.activities.pendingFit("bob", 10).length, 1);
  assert.equal(r.activities.summaryJson("bob", 2), undefined);
});

test("writes never touch the other user's row with the same id", () => {
  const r = twoUsers();
  r.activities.setFitStatus("bob", 1, "done");
  r.activities.setLoad("bob", 1, { trimp: 5, tss: 6, tss_method: "x" });
  assert.equal(r.activities.get("alice", 1)!.fit_status, "pending");
  assert.equal(r.activities.get("alice", 1)!.trimp, null);
  r.activities.upsertSummary("bob", activity(1, "2026-10-09", { name: "bob's" }));
  assert.equal(r.activities.get("alice", 1)!.name, "Activity 1");
});

test("health, settings, analytics, sync state and keys are per user", () => {
  const r = twoUsers();
  assert.equal(r.health.dailies.range("bob", "2026-01-01", "2026-12-31").length, 0);
  assert.equal(r.health.sleep.range("bob", "2026-01-01", "2026-12-31").length, 0);
  assert.equal(r.health.hrv.range("bob", "2026-01-01", "2026-12-31").length, 0);
  assert.equal(r.athlete.at("bob", "2026-10-01"), undefined);
  assert.equal(r.athlete.history("bob").length, 0);
  assert.equal(r.analytics.range("bob", "2026-01-01", "2026-12-31").length, 0);
  assert.equal(r.analytics.lastBefore("bob", "2027-01-01"), undefined);
  assert.equal(r.syncState.get("bob", "activities"), undefined);
  assert.equal(r.keys.get("bob"), undefined);
  assert.deepEqual(r.keys.listUsable(), ["alice"]);
});

test("deleteAllData removes the user's synced data (rows) but keeps the user and key; the other user is untouched", () => {
  const r = twoUsers();
  r.deleteAllData("alice");
  assert.equal(r.activities.count("alice"), 0);
  assert.equal(r.activities.samples("alice", 1).length, 0);
  assert.equal(r.health.dailies.count("alice"), 0);
  assert.equal(r.athlete.history("alice").length, 0);
  assert.equal(r.analytics.range("alice", "2000-01-01", "2100-01-01").length, 0);
  assert.equal(r.syncState.all("alice").length, 0);
  assert.ok(r.users.get("alice"));
  assert.ok(r.keys.get("alice"));
  assert.equal(r.activities.count("bob"), 1);
});

test("deleting a user cascades through everything", () => {
  const r = twoUsers();
  r.users.delete("alice");
  assert.equal(r.activities.count("alice"), 0);
  assert.equal(r.keys.get("alice"), undefined);
  assert.equal(r.health.sleep.count("alice"), 0);
  assert.equal(r.activities.samples("alice", 1).length, 0);
});

test("athlete settings are historised: the version valid on the day applies", () => {
  const r = memoryRepos();
  seedUser(r, "u");
  const base = { hr_max: 190, hr_rest: 50, lthr: 170, threshold_pace_s_per_km: null, sex: null, zones_json: null, source: "manual" as const };
  r.athlete.upsert("u", { ...base, valid_from: "2026-01-01", ftp: 200 });
  r.athlete.upsert("u", { ...base, valid_from: "2026-06-01", ftp: 250 });
  assert.equal(r.athlete.at("u", "2026-03-01")!.ftp, 200);
  assert.equal(r.athlete.at("u", "2026-06-01")!.ftp, 250);
  assert.equal(r.athlete.at("u", "2025-01-01")!.ftp, 200, "before the first version, the oldest applies");
});

test("custom sports: per user, assignment and deletion never touch the other user", () => {
  const r = twoUsers();
  const a = r.customSports.create("alice", "Dragon boat", ["running", "cycling"]);
  const b = r.customSports.create("bob", "Dragon boat", []); // same name and same first id, different user
  assert.equal(a, b);
  assert.deepEqual(r.customSports.typesOf("alice", a), ["cycling", "running"]);
  assert.deepEqual(r.customSports.typesOf("bob", b), []);
  r.customSports.assign("alice", 1, a);
  r.customSports.assign("bob", 1, b);
  assert.equal(r.activities.get("alice", 1)!.custom_sport, "Dragon boat");
  assert.equal(r.activities.count("bob", { customSportId: b }), 1);

  r.customSports.setTypes("bob", b, ["running"]);
  assert.deepEqual(r.customSports.typesOf("alice", a), ["cycling", "running"], "bob's change leaves alice's types alone");
  assert.equal(r.customSports.rename("bob", a + 100, "x"), false);
  r.customSports.rename("bob", b, "OC1");
  assert.equal(r.customSports.idByName("alice", "OC1"), undefined);

  assert.equal(r.customSports.delete("alice", a), true);
  assert.equal(r.activities.get("alice", 1)!.custom_sport_id, null, "alice's assignment is cleared");
  assert.equal(r.activities.get("bob", 1)!.custom_sport_id, b, "bob's stays");
  assert.deepEqual(r.customSports.listDetailed("bob").map((s) => [s.name, s.type_keys, s.activity_count]), [["OC1", ["running"], 1]]);
  assert.deepEqual(r.customSports.garminTypes("bob"), [{ type_key: "running", sport: "running" }]);
});

test("deleteAllData keeps the custom sports (configuration) but their assignments go with the activities", () => {
  const r = twoUsers();
  const id = r.customSports.create("alice", "Dragon boat", []);
  r.customSports.assign("alice", 1, id);
  r.deleteAllData("alice");
  assert.equal(r.customSports.list("alice").length, 1);
  assert.equal(r.customSports.listDetailed("alice")[0]!.activity_count, 0);
});

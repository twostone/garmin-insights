import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { createFitStore } from "../src/fit/store.ts";
import { GarminKeyError, type GarminApi, type SummarizedActivity } from "../src/garmin/client.ts";
import { createSyncWorker, FLOOR_DATE } from "../src/sync/worker.ts";
import { multisportFit, runFit, strengthFit } from "./fit-fixtures.ts";
import { memoryRepos, seedUser } from "./helpers.ts";

const TODAY = "2026-10-30";

const dto = (id: number, local: string, typeKey = "running"): SummarizedActivity => ({
  activityId: id,
  activityName: `A${id}`,
  startTimeLocal: `${local} 07:00:00`,
  startTimeGMT: `${local} 05:00:00`,
  activityType: { typeId: 1, typeKey },
  distance: 10000,
  duration: 3000,
  averageHR: 150,
});

// An in-memory Garmin: activities by date, windows are validated like the real API would (31/365 day limits).
function fakeGarmin(activities: SummarizedActivity[], extra: Partial<GarminApi> = {}) {
  const calls = { search: [] as string[], daily: [] as string[], sleep: [] as string[], hrv: [] as string[], zip: [] as number[] };
  const api: GarminApi = {
    async searchActivities({ startDate, endDate, start, limit }) {
      calls.search.push(`${startDate}..${endDate}@${start}`);
      return activities.filter((a) => a.startTimeLocal!.slice(0, 10) >= startDate && a.startTimeLocal!.slice(0, 10) <= endDate).slice(start, start + limit);
    },
    async downloadActivityZip(id) {
      calls.zip.push(id);
      if (id === 3) return null;
      if (id === 4) return new Uint8Array([1, 2, 3]); // not a zip
      return zipSync({ [`${id}_ACTIVITY.fit`]: id === 2 ? strengthFit() : runFit() });
    },
    async dailySummaries(s, e) {
      calls.daily.push(`${s}..${e}`);
      assert.ok((Date.parse(e) - Date.parse(s)) / 86400000 <= 365, "daily window limit");
      return e >= "2026-10-01" && s <= "2026-10-01" ? [{ calendarDate: "2026-10-01", movement: { steps: { value: 8000 } }, heartRate: { restingValue: 52 } }] : [];
    },
    async sleepSummaries(s, e) {
      calls.sleep.push(`${s}..${e}`);
      assert.ok((Date.parse(e) - Date.parse(s)) / 86400000 <= 30, "sleep window limit (31 days inclusive)");
      return [];
    },
    async hrvSummaries(s, e) {
      calls.hrv.push(`${s}..${e}`);
      return e >= "2026-10-01" && s <= "2026-10-01" ? [{ calendarDate: "2026-10-01", lastNightAvg: 60, weeklyAvg: 58, createTimeStamp: "2026-10-01T05:00:00", baseline: { balancedLow: 50, balancedUpper: 70 } }] : [];
    },
    async heartRateZones() {
      return [{ sport: "RUNNING", maxHeartRateUsed: 190, restingHeartRateUsed: 50, lactateThresholdHeartRateUsed: 170, zone1Floor: 95, zone2Floor: 114, zone3Floor: 133, zone4Floor: 152, zone5Floor: 171 }];
    },
    ...extra,
  };
  return { api, calls };
}

function setup(activities: SummarizedActivity[], extra: Partial<GarminApi> = {}) {
  const repos = memoryRepos();
  seedUser(repos, "u1");
  const g = fakeGarmin(activities, extra);
  const changed: string[] = [];
  const invalid: string[] = [];
  let clock = Date.parse("2026-10-30T10:00:00Z");
  const worker = createSyncWorker({
    repos,
    garmin: () => g.api,
    fit: createFitStore(mkdtempSync(join(tmpdir(), "gi-fit-"))),
    onKeyInvalid: async (u) => void invalid.push(u),
    onChanged: (_u, from) => void changed.push(from),
    today: () => TODAY,
    now: () => clock,
  });
  return { repos, worker, g, changed, invalid, tick: (ms: number) => (clock += ms) };
}

test("first sync stores activities, health, zones, FIT detail and strength sets", async () => {
  const s = setup([dto(1, "2026-10-28"), dto(2, "2026-10-27", "strength_training"), dto(3, "2026-10-26")]);
  await s.worker.trigger("u1");
  assert.equal(s.repos.activities.count("u1"), 3);
  assert.equal(s.repos.activities.get("u1", 1)!.fit_status, "done");
  assert.equal(s.repos.activities.get("u1", 3)!.fit_status, "none", "no file -> none");
  assert.equal(s.repos.activities.samples("u1", 1).length, 600);
  assert.equal(s.repos.activities.laps("u1", 1).length, 2);
  assert.equal(s.repos.activities.sets("u1", 2).filter((x) => x.set_type === "active").length, 3);
  assert.equal(s.repos.activities.get("u1", 2)!.sport, "strength");
  assert.equal(s.repos.activities.get("u1", 1)!.date, "2026-10-28");
  assert.equal(s.repos.activities.get("u1", 1)!.start_utc, "2026-10-28T05:00:00.000Z");
  assert.equal(s.repos.health.dailies.range("u1", "2026-10-01", "2026-10-01")[0]!.resting_hr, 52);
  assert.equal(s.repos.health.hrv.range("u1", "2026-10-01", "2026-10-31")[0]!.last_night_avg, 60);
  const settings = s.repos.athlete.at("u1", TODAY)!;
  assert.deepEqual([settings.hr_max, settings.hr_rest, settings.lthr, settings.source], [190, 50, 170, "garmin"]);
  assert.deepEqual(JSON.parse(settings.zones_json!), { hr: [95, 114, 133, 152, 171] });
  assert.ok(s.changed.length >= 1);
  assert.equal(s.worker.progress("u1").running, false);
});

test("a broken FIT file is marked failed and the others still import", async () => {
  const s = setup([dto(1, "2026-10-28"), dto(4, "2026-10-27")]);
  await s.worker.trigger("u1");
  assert.equal(s.repos.activities.get("u1", 4)!.fit_status, "failed");
  assert.equal(s.repos.activities.get("u1", 1)!.fit_status, "done");
});

test("backfill walks back in windows, saves its cursor, and ends after a run of empty windows", async () => {
  const s = setup([dto(1, "2026-10-28"), dto(9, "2025-03-01", "cycling")]);
  await s.worker.trigger("u1");
  assert.ok(s.repos.activities.has("u1", 9), "history from 2025 was fetched");
  const st = s.repos.syncState.get("u1", "activities")!;
  assert.equal(st.backfill_done, 1);
  assert.ok(st.cursor! < "2025-03-01" && st.cursor! > FLOOR_DATE, st.cursor!);
  // ~ (today..2025-03 = 14 months) / 90 days + 8 empty windows: far fewer calls than walking back to 2005.
  const windows = new Set(s.g.calls.search.map((c) => c.split("@")[0]));
  assert.ok(windows.size < 25, String(windows.size));
});

test("the second run only fetches the newest days and keeps the finished backfill", async () => {
  const s = setup([dto(1, "2026-10-28")]);
  await s.worker.trigger("u1");
  s.g.calls.search.length = 0;
  s.tick(3600_000);
  await s.worker.trigger("u1");
  assert.equal(s.g.calls.search.length, 1);
  assert.match(s.g.calls.search[0]!, /^2026-10-2\d\.\.2026-10-30@0$/);
});

test("a run in progress is shared, not started twice", async () => {
  const s = setup([dto(1, "2026-10-28")]);
  const a = s.worker.trigger("u1");
  const b = s.worker.trigger("u1");
  assert.equal(a, b);
  assert.equal(s.worker.progress("u1").running, true);
  await a;
});

test("Garmin refusing the key ends the run and reports it once", async () => {
  const s = setup([], { async heartRateZones() { throw new GarminKeyError("invalid"); } });
  await s.worker.trigger("u1");
  assert.deepEqual(s.invalid, ["u1"]);
  assert.equal(s.worker.progress("u1").error, "key");
});

test("one failing data kind does not stop the others", async () => {
  const s = setup([dto(1, "2026-10-28")], { async sleepSummaries() { throw new Error("boom"); } });
  await s.worker.trigger("u1");
  assert.equal(s.repos.activities.count("u1"), 1);
  assert.equal(s.repos.health.hrv.count("u1"), 1);
  assert.equal(s.repos.syncState.get("u1", "sleep")!.last_error, "boom");
});

test("the time budget stops the FIT phase and leaves the rest pending for the next run", async () => {
  const acts = Array.from({ length: 5 }, (_, i) => dto(10 + i, `2026-10-${10 + i}`));
  const s = setup(acts, {});
  // Each download advances the clock; the budget (default 30 min) allows only a few.
  const orig = s.g.api.downloadActivityZip;
  s.g.api.downloadActivityZip = async (id) => (s.tick(10 * 60_000), orig(id));
  await s.worker.trigger("u1");
  const pending = s.repos.activities.pendingFitCount("u1");
  assert.ok(pending > 0 && pending < 5, String(pending));
  assert.equal(s.worker.progress("u1").fit.pending, pending);
  await s.worker.trigger("u1");
  assert.ok(s.repos.activities.pendingFitCount("u1") < pending);
});

// A CrossFit session as Garmin lists it with excludeChildren=false: the parent without HR, and one child per leg.
const at = (id: number, time: string, typeKey: string, over: Partial<SummarizedActivity> = {}): SummarizedActivity => ({
  activityId: id, activityName: `A${id}`, startTimeLocal: `2026-10-28 ${time}`, startTimeGMT: `2026-10-28 ${time.replace(/^07/, "05")}`,
  activityType: { typeId: 1, typeKey }, duration: 300, ...over,
});
const crossfit = () => [
  at(50, "07:00:00", "multi_sport", { duration: 600, isParent: true }),
  at(51, "07:00:00", "indoor_rowing", { parentId: 50, averageHR: 131 }),
  at(52, "07:05:02", "hiit", { parentId: 50 }),
];
const multisportZips = { async downloadActivityZip(id: number) { return id === 50 ? zipSync({ "50_ACTIVITY.fit": multisportFit() }) : null; } };

test("multisport: parent and legs are linked, legs without a file get their part of the parent's file", async () => {
  const s = setup(crossfit(), multisportZips);
  await s.worker.trigger("u1");
  const a = s.repos.activities;
  assert.deepEqual([a.get("u1", 50)!.is_multisport_parent, a.get("u1", 50)!.parent_id], [1, null]);
  assert.deepEqual([a.get("u1", 51)!.parent_id, a.get("u1", 52)!.parent_id, a.get("u1", 51)!.is_multisport_parent], [50, 50, 0]);
  assert.equal(a.count("u1", { topLevel: true }), 1, "legs hang under their parent");
  for (const id of [51, 52]) assert.equal(a.get("u1", id)!.fit_status, "done", `leg ${id}`);
  const hiit = a.samples("u1", 52);
  assert.equal(hiit.length, 300);
  assert.deepEqual([hiit[0]!.t, hiit[0]!.hr], [0, 160], "relative to the leg's start");
  assert.equal(a.samples("u1", 51)[0]!.hr, 130);
  // Leg HR: Garmin's value where there is one, else the mean of the leg's samples.
  assert.deepEqual(a.legs("u1", 50).map((l) => [l.id, l.avg_hr]), [[51, 131], [52, 160]]);
});

test("multisport: a leg synced before its parent's file is filled once the parent arrives", async () => {
  const s = setup(crossfit(), multisportZips);
  // The legs come first (newest first by start time, and the parent's download fails once).
  let parentTries = 0;
  s.g.api.downloadActivityZip = async (id) => {
    if (id === 50 && parentTries++ === 0) throw new Error("timeout");
    return multisportZips.downloadActivityZip(id);
  };
  await s.worker.trigger("u1");
  assert.equal(s.repos.activities.get("u1", 52)!.fit_status, "none");
  s.repos.activities.setFitStatus("u1", 50, "pending");
  await s.worker.trigger("u1");
  assert.equal(s.repos.activities.get("u1", 52)!.fit_status, "done");
  assert.equal(s.repos.activities.samples("u1", 52).length, 300);
});

test("multisport backfill: an existing mirror walks the activity history once more, then never again", async () => {
  const s = setup([dto(1, "2026-10-28"), at(60, "07:00:00", "hiit", { parentId: 59, startTimeLocal: "2025-03-01 07:00:00", startTimeGMT: "2025-03-01 06:00:00" })]);
  // State of a mirror synced before multisport support: backfill finished, the old leg was never listed.
  s.repos.syncState.save("u1", "activities", { cursor: "2024-01-01", backfill_done: 1, last_sync_at: "2026-10-29T10:00:00.000Z", items: 1 });
  await s.worker.trigger("u1");
  assert.ok(s.repos.activities.has("u1", 60), "old leg fetched");
  assert.ok(s.repos.syncState.get("u1", "multisport_backfill"), "marker set");
  assert.equal(s.repos.syncState.get("u1", "activities")!.backfill_done, 1);
  assert.ok(!s.worker.progress("u1").kinds.some((k) => k.kind === "multisport_backfill"), "the marker is no data kind");
  s.g.calls.search.length = 0;
  s.tick(3600_000);
  await s.worker.trigger("u1");
  assert.equal(s.g.calls.search.length, 1, "no second backfill");
});

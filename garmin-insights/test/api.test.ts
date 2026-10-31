import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { externalContext } from "../src/auth/context.ts";
import type { Env } from "../src/types.ts";
import type { GarminApi } from "../src/garmin/client.ts";
import { jwt, testApi } from "./helpers.ts";
import { runFit } from "./fit-fixtures.ts";
import { seedTraining as seed } from "./seed.ts";

// A Garmin token endpoint stand-in for the key check: only the key "good" is accepted.
const garminFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? (input instanceof Request ? input.headers.get("authorization") : "");
  return auth === "ApiKey good" ? new Response(jwt(86400), { status: 200 }) : new Response("no", { status: 401 });
}) as typeof fetch;

const noGarmin = (): GarminApi => ({
  searchActivities: async () => [],
  downloadActivityZip: async () => null,
  dailySummaries: async () => [],
  sleepSummaries: async () => [],
  hrvSummaries: async () => [],
  heartRateZones: async () => [],
});

function setup() {
  const t = testApi({ garminClient: { fetch: garminFetch, minIntervalMs: 0 }, garmin: noGarmin, today: () => "2026-10-30" });
  const app = new Hono<Env>();
  // Tests pick the user per request with a header, standing in for the listeners.
  app.use("*", async (c, next) => {
    c.set("access", "external");
    c.set("appContext", externalContext("https://ha.example.test", "https://app.example.test"));
    const id = c.req.header("x-test-user");
    c.set("user", id ? { id, name: id } : null);
    await next();
  });
  app.route("/api", t.api);
  const as = (user: string) => ({
    get: (path: string) => app.request(`/api${path}`, { headers: { "x-test-user": user } }),
    send: (method: string, path: string, body?: unknown) =>
      app.request(`/api${path}`, { method, headers: { "x-test-user": user, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
  });
  return { ...t, app, as };
}

test("no user -> 401, context stays public", async () => {
  const { app } = setup();
  assert.equal((await app.request("/api/activities")).status, 401);
  assert.equal((await app.request("/api/context")).status, 200);
});

test("Garmin key: invalid input 400, rejected by Garmin 422, accepted -> status without the key", async () => {
  const { as, repos } = setup();
  const u = as("alice");
  assert.deepEqual(await (await u.get("/garmin/key")).json(), { configured: false, status: null, expiresOn: null, daysLeft: null });
  assert.equal((await u.send("PUT", "/garmin/key", { key: "has space" })).status, 400);
  assert.equal((await u.send("PUT", "/garmin/key", { key: "bad" })).status, 422);
  const ok = await u.send("PUT", "/garmin/key", { key: "good", expires_on: "2027-01-01" });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.status, "ok");
  assert.equal(JSON.stringify(await (await u.get("/garmin/key")).json()).includes("good"), false);
  assert.ok(repos.keys.get("alice"));
  assert.equal((await u.send("DELETE", "/garmin/key")).status, 204);
  assert.equal(repos.keys.get("alice"), undefined);
});

test("sync: POST without a key is 409; with a key it starts, GET shows progress and the key status", async () => {
  const { as } = setup();
  const u = as("alice");
  assert.equal((await u.send("POST", "/sync")).status, 409);
  await u.send("PUT", "/garmin/key", { key: "good" });
  const r = await u.send("POST", "/sync");
  assert.equal(r.status, 202);
  const progress = await (await u.get("/sync")).json();
  assert.equal(progress.key.status, "ok");
  assert.ok(Array.isArray(progress.kinds));
});

test("activities: filters, pagination, calendar, detail; another user's data is invisible", async () => {
  const t = setup();
  seed(t);
  const a = t.as("alice");
  const list = await (await a.get("/activities?limit=2")).json();
  assert.equal(list.total, 3);
  assert.deepEqual(list.items.map((x: { id: number }) => x.id), [3, 2]);
  assert.deepEqual((await (await a.get("/activities?sport=strength")).json()).items.map((x: { id: number }) => x.id), [2]);
  assert.equal((await (await a.get("/activities?from=2026-10-04&to=2026-10-06")).json()).total, 1);
  const cal = await (await a.get("/activities/calendar?from=2026-10-01&to=2026-10-31")).json();
  assert.deepEqual(cal.map((d: { date: string }) => d.date), ["2026-10-01", "2026-10-05", "2026-10-10"]);
  assert.equal((await (await a.get("/activities/1")).json()).summary.fastestSplit_1000, 290);

  const b = t.as("bob");
  assert.equal((await (await b.get("/activities")).json()).total, 1);
  assert.equal((await (await b.get("/activities/1")).json()).activity.name, "bob run", "same id, own row");
  for (const p of ["/activities/2", "/activities/2/samples", "/activities/2/laps", "/activities/2/strength", "/activities/2/analysis", "/activities/2/fit"]) {
    assert.equal((await b.get(p)).status, 404, p);
  }
  assert.equal((await b.get("/activities/1/fit")).status, 404, "bob has no FIT file for his activity 1");
});

test("samples are downsampled to max_points and windowed; laps; FIT download returns the original bytes", async () => {
  const t = setup();
  seed(t);
  const a = t.as("alice");
  const s = await (await a.get("/activities/1/samples?max_points=100")).json();
  assert.equal(s.total, 600);
  assert.equal(s.samples.length, 100);
  assert.equal(s.samples[0].t, 0);
  assert.equal(s.samples.at(-1).t, 599);
  const w = await (await a.get("/activities/1/samples?from=100&to=199&max_points=1000")).json();
  assert.equal(w.samples.length, 100);
  assert.equal((await (await a.get("/activities/1/laps")).json()).length, 2);
  const fit = await a.get("/activities/1/fit");
  assert.equal(fit.headers.get("content-type"), "application/octet-stream");
  assert.deepEqual([...new Uint8Array(await fit.arrayBuffer())], [...runFit()]);
  assert.equal((await a.get("/activities/1/samples?max_points=5")).status, 400);
});

test("strength sets and the analysis of a run (zones from samples, decoupling, best efforts)", async () => {
  const t = setup();
  seed(t);
  const a = t.as("alice");
  const st = await (await a.get("/activities/2/strength")).json();
  assert.equal(st.sets.length, 5);
  assert.equal(st.totalVolumeKg, 600 + 500 + 1200);
  const an = await (await a.get("/activities/1/analysis")).json();
  assert.equal(an.zones.hr.source, "samples");
  assert.equal(an.zones.hr.seconds.length, 5);
  assert.equal(an.zones.hr.seconds.reduce((x: number, y: number) => x + y, 0) + an.zones.hr.below, 600);
  assert.ok(an.best_efforts.some((e: { distance: number }) => e.distance === 400));
  assert.equal(an.zones.power, null);
});

test("analytics: volume, best efforts from the Garmin summaries, strength, zones over a range", async () => {
  const t = setup();
  seed(t);
  const a = t.as("alice");
  const vol = await (await a.get("/analytics/volume?from=2026-09-28&to=2026-10-31&by=week")).json();
  assert.deepEqual(vol.map((r: { period: string; sport: string }) => [r.period, r.sport]), [["2026-09-28", "running"], ["2026-10-05", "running"], ["2026-10-05", "strength"]]);
  assert.equal(vol.length, 3);
  const best = await (await a.get("/analytics/best-efforts?sport=running&from=2026-01-01&to=2026-12-31")).json();
  assert.deepEqual(best.efforts.find((e: { distance_m: number }) => e.distance_m === 1000), { distance_m: 1000, seconds: 280, activity_id: 3, date: "2026-10-10" });
  const str = await (await a.get("/analytics/strength?from=2026-10-01&to=2026-10-31")).json();
  assert.equal(str.totalVolumeKg, 2300);
  assert.equal(str.weekly.length, 1);
  const zones = await (await a.get("/analytics/zones?from=2026-10-01&to=2026-10-31&kind=hr")).json();
  assert.equal(zones.activities >= 1, true);
  assert.equal((await a.get("/analytics/pmc?from=2026-10-10&to=2026-10-01")).status, 400);
  assert.equal((await a.get("/analytics/volume?from=2000-01-01&to=2026-10-31")).status, 400, "range too long");
  assert.equal((await a.get("/analytics/pmc?from=nope")).status, 400);
  assert.equal((await (await t.as("bob").get("/analytics/strength?from=2026-10-01&to=2026-10-31")).json()).totalVolumeKg, 0);
});

test("health ranges per user", async () => {
  const t = setup();
  t.repos.users.upsert({ id: "alice", name: "a" });
  t.repos.health.dailies.upsertMany("alice", [{ date: "2026-10-20", steps: 5000, resting_hr: 50, min_hr: 45, max_hr: 160, stress_avg: 25, body_battery_high: 90, body_battery_low: 12, active_minutes: 20 }]);
  t.repos.health.hrv.upsertMany("alice", [{ date: "2026-10-20", last_night_avg: 60, weekly_avg: 58, last_night_5min_high: 80, baseline_low: 50, baseline_high: 70, status: "BALANCED" }]);
  t.repos.health.sleep.upsertMany("alice", [{ date: "2026-10-20", sleep_s: 27000, deep_s: 5000, light_s: 15000, rem_s: 6000, awake_s: 1000, score: 82, avg_spo2: 95, avg_respiration: 14, avg_stress: 18, avg_hr: 49 }]);
  const a = t.as("alice");
  assert.equal((await (await a.get("/health/daily?from=2026-10-01&to=2026-10-31")).json())[0].resting_hr, 50);
  assert.equal((await (await a.get("/health/hrv?from=2026-10-01&to=2026-10-31")).json())[0].last_night_avg, 60);
  assert.equal((await (await a.get("/health/sleep?from=2026-10-01&to=2026-10-31")).json())[0].score, 82);
  assert.deepEqual(await (await t.as("bob").get("/health/daily?from=2026-10-01&to=2026-10-31")).json(), []);
  const trends = await (await a.get("/analytics/trends?from=2026-10-01&to=2026-10-31")).json();
  assert.equal(trends.points.length, 31);
  assert.equal(trends.points[19].restingHr, 50);
});

test("settings: language, athlete thresholds (historised, recompute loads), delete a version", async () => {
  const t = setup();
  seed(t);
  const a = t.as("alice");
  assert.equal((await (await a.send("PUT", "/settings/language", { language: "de" })).json()).language, "de");
  assert.equal((await (await a.send("PUT", "/settings/language", { language: null })).json()).language, null);
  assert.equal((await a.send("PUT", "/settings/language", { language: "fr" })).status, 400);
  const before = (await (await a.get("/activities/3")).json()).activity.tss;
  const res = await a.send("PUT", "/settings/athlete", { valid_from: "2026-10-01", hr_max: 200, hr_rest: 45, lthr: 180, ftp: 260, threshold_pace_s_per_km: 300, sex: "m", zones: { hr: [100, 120, 140, 160, 180] } });
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.athlete.history.length, 2);
  assert.equal(s.athlete.current.ftp, 260);
  assert.deepEqual(s.athlete.effectiveZones.hr, [100, 120, 140, 160, 180]);
  assert.equal(s.athlete.effectiveZones.power.length, 7);
  const after = (await (await a.get("/activities/3")).json()).activity.tss;
  assert.notEqual(before, after, "the new thresholds changed the stored load");
  assert.equal((await a.send("PUT", "/settings/athlete", { hr_max: 100, hr_rest: 120, lthr: null, ftp: null, threshold_pace_s_per_km: null, sex: null })).status, 400);
  assert.equal((await a.send("DELETE", "/settings/athlete/2026-10-01")).status, 204);
  assert.equal((await a.send("DELETE", "/settings/athlete/2026-10-01")).status, 404);
  assert.equal((await (await t.as("bob").get("/settings")).json()).athlete.history.length, 0);
});

test("delete all data needs the confirmation, removes rows and FIT files, keeps the key and the other user", async () => {
  const t = setup();
  seed(t);
  await t.as("alice").send("PUT", "/garmin/key", { key: "good" });
  const a = t.as("alice");
  assert.equal((await a.send("DELETE", "/data", {})).status, 400);
  assert.equal(t.repos.activities.count("alice"), 3);
  assert.equal((await a.send("DELETE", "/data", { confirm: "delete-all-data" })).status, 204);
  assert.equal(t.repos.activities.count("alice"), 0);
  assert.equal(t.fit.has("alice", 1), false);
  assert.ok(t.repos.keys.get("alice"));
  assert.equal(t.repos.activities.count("bob"), 1);
});

test("custom sports: CRUD, duplicate name 409, assignment checks, isolation", async () => {
  const t = setup();
  seed(t);
  const { as } = t;
  const a = as("alice"), b = as("bob");
  const created = await a.send("POST", "/custom-sports", { name: "Dragon boat", type_keys: ["running"] });
  assert.equal(created.status, 201);
  const sport = (await created.json()).items[0];
  assert.equal((await a.send("POST", "/custom-sports", { name: "dragon boat" })).status, 409);
  assert.equal((await b.send("POST", "/custom-sports", { name: "Dragon boat" })).status, 201, "names are unique per user only");

  const listed = await (await a.get("/custom-sports")).json();
  assert.deepEqual(listed.garmin_types, ["running", "strength_training"]);
  assert.equal(listed.items.length, 1);

  // Assignment: unknown activity / foreign sport -> 404; type mismatch -> 422; match -> 200 and visible in the list.
  assert.equal((await a.send("PATCH", "/activities/999", { custom_sport_id: sport.id })).status, 404);
  assert.equal((await a.send("PATCH", "/activities/1", { custom_sport_id: 999 })).status, 404);
  assert.equal((await a.send("PATCH", "/activities/2", { custom_sport_id: sport.id })).status, 422);
  assert.equal((await a.send("PATCH", "/activities/1", { custom_sport_id: sport.id })).status, 200);
  assert.equal((await (await a.get(`/activities?custom_sport_id=${sport.id}`)).json()).total, 1);
  assert.equal((await (await a.get("/activities/1")).json()).activity.custom_sport, "Dragon boat");
  // Bob has a sport with the same id and an activity 1 of his own; alice's assignment did not touch it.
  assert.equal((await (await b.get("/activities/1")).json()).activity.custom_sport, null);
  assert.equal((await b.send("PATCH", "/activities/2", { custom_sport_id: sport.id })).status, 404);

  assert.equal((await a.send("PATCH", `/custom-sports/${sport.id}`, { name: "OC1", type_keys: [] })).status, 200);
  assert.equal((await a.send("PATCH", "/custom-sports/999", { name: "x" })).status, 404);
  assert.equal((await a.send("PATCH", "/activities/2", { custom_sport_id: sport.id })).status, 200, "no base types: any activity fits");
  assert.equal((await a.send("PATCH", "/activities/2", { custom_sport_id: null })).status, 200);

  assert.equal((await b.send("DELETE", `/custom-sports/${sport.id}`)).status, 204);
  assert.equal((await (await a.get("/custom-sports")).json()).items[0].name, "OC1", "bob's delete left alice's sport");
  assert.equal((await a.send("DELETE", `/custom-sports/${sport.id}`)).status, 204);
  assert.equal((await a.send("DELETE", `/custom-sports/${sport.id}`)).status, 404);
  assert.equal((await (await a.get("/activities/1")).json()).activity.custom_sport_id, null);
});

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createHaTokenVerifier } from "../src/auth/ha-token.ts";
import { createExternalApp } from "../src/listeners/external.ts";
import { buildMcpServer, createMcpEndpoint } from "../src/mcp/server.ts";
import type { GarminApi } from "../src/garmin/client.ts";
import { jwt, mockHa, staticRoot, testApi } from "./helpers.ts";
import { seedTraining } from "./seed.ts";

const noGarmin = (): GarminApi => ({
  searchActivities: async () => [], downloadActivityZip: async () => null, dailySummaries: async () => [], sleepSummaries: async () => [], hrvSummaries: async () => [], heartRateZones: async () => [],
});

function services() {
  const t = testApi({ garmin: noGarmin, today: () => "2026-10-30", garminClient: { fetch: (async () => new Response(jwt(86400))) as typeof fetch, minIntervalMs: 0 } });
  seedTraining(t);
  // Health data and a load history for alice.
  const dates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 8, 20 + i)).toISOString().slice(0, 10));
  t.repos.health.dailies.upsertMany("alice", dates.map((date, i) => ({ date, steps: 8000, resting_hr: 50 + (i > 30 ? 4 : 0), min_hr: 45, max_hr: 150, stress_avg: 25, body_battery_high: 90, body_battery_low: 10, active_minutes: 30 })));
  t.repos.health.hrv.upsertMany("alice", dates.map((date) => ({ date, last_night_avg: 60, weekly_avg: 60, last_night_5min_high: 80, baseline_low: 50, baseline_high: 70, status: "BALANCED" })));
  t.repos.health.sleep.upsertMany("alice", dates.map((date) => ({ date, sleep_s: 27000, deep_s: 5000, light_s: 15000, rem_s: 6000, awake_s: 1000, score: 80, avg_spo2: 95, avg_respiration: 14, avg_stress: 18, avg_hr: 49 })));
  return t;
}

async function connect(t: ReturnType<typeof services>, userId: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(t, { id: userId, name: userId });
  await server.connect(a);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(b);
  return client;
}
type ToolResult = { isError?: boolean; structuredContent?: Record<string, any>; content: { type: string; text: string }[] };
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as unknown as ToolResult;

test("tools and prompts are listed; everything but trigger_sync is read-only", async () => {
  const c = await connect(services(), "alice");
  const tools = (await c.listTools()).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "compare_activities", "get_activity", "get_activity_samples", "get_athlete_settings", "get_best_efforts", "get_health_trends",
    "get_strength_sets", "get_training_load", "get_volume", "get_zone_distribution", "list_activities", "list_custom_sports", "trigger_sync",
  ]);
  for (const t of tools) {
    assert.ok(t.inputSchema, t.name);
    assert.ok(t.outputSchema, `${t.name} has a structured output schema`);
    assert.equal(t.annotations?.readOnlyHint, t.name !== "trigger_sync", t.name);
  }
  assert.deepEqual((await c.listPrompts()).prompts.map((p) => p.name).sort(), ["analyze_week", "race_readiness"]);
});

test("list_activities: filters, metric units, structured and text output agree", async () => {
  const c = await connect(services(), "alice");
  const r = await call(c, "list_activities", { sport: "running", limit: 10 });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent!.total, 2);
  assert.equal(r.structuredContent!.activities[0].id, 3);
  assert.equal(r.structuredContent!.activities[0].distance_km, 10);
  assert.equal(r.structuredContent!.activities[0].avg_pace_min_per_km, 5.01);
  assert.deepEqual(JSON.parse(r.content[0]!.text), r.structuredContent);
  assert.equal((await call(c, "list_activities", { from: "2026-10-04", to: "2026-10-06" })).structuredContent!.total, 1);
});

test("a user sees only their own data: bob cannot read alice's activity through any tool", async () => {
  const t = services();
  const bob = await connect(t, "bob");
  assert.equal((await call(bob, "list_activities")).structuredContent!.total, 1);
  assert.equal((await call(bob, "get_activity", { activity_id: 2 })).isError, true);
  assert.equal((await call(bob, "get_activity_samples", { activity_id: 2 })).isError, true);
  assert.equal((await call(bob, "get_strength_sets", { activity_id: 2 })).isError, true);
  assert.equal((await call(bob, "compare_activities", { activity_ids: [1, 2] })).isError, true);
  assert.equal((await call(bob, "get_strength_sets", { from: "2026-10-01", to: "2026-10-31" })).structuredContent!.total_volume_kg, 0);
  assert.equal((await call(bob, "get_training_load")).structuredContent!.latest, null);
  // alice's id 1 and bob's id 1 are different rows
  assert.equal((await call(bob, "get_activity", { activity_id: 1 })).structuredContent!.activity.name, "bob run");
});

test("get_activity: detail with laps, zones from the recording, decoupling and best efforts", async () => {
  const c = await connect(services(), "alice");
  const r = (await call(c, "get_activity", { activity_id: 1 })).structuredContent!;
  assert.equal(r.details_available, true);
  assert.equal(r.laps.length, 2);
  assert.equal(r.zones.hr.seconds_per_zone.length, 5);
  assert.ok(r.best_efforts.some((e: { distance_m: number }) => e.distance_m === 400));
  const strength = (await call(c, "get_activity", { activity_id: 2 })).structuredContent!;
  assert.equal(strength.strength.total_volume_kg, 2300);
});

test("get_activity_samples: columns, downsampling, window and field selection", async () => {
  const c = await connect(services(), "alice");
  const r = (await call(c, "get_activity_samples", { activity_id: 1, max_points: 50, fields: ["hr", "speed"] })).structuredContent!;
  assert.equal(r.samples_in_window, 600);
  assert.equal(r.returned, 50);
  assert.deepEqual(Object.keys(r.series), ["hr", "speed"]);
  assert.equal(r.t_s.length, 50);
  assert.equal(r.series.hr.length, 50);
  const w = (await call(c, "get_activity_samples", { activity_id: 1, from_s: 100, to_s: 199, max_points: 2000 })).structuredContent!;
  assert.equal(w.returned, 100);
  assert.equal((await call(c, "get_activity_samples", { activity_id: 3 })).isError, true, "no detail file for activity 3");
});

test("get_strength_sets and compare_activities", async () => {
  const c = await connect(services(), "alice");
  const s = (await call(c, "get_strength_sets", { activity_id: 2 })).structuredContent!;
  assert.equal(s.sets.length, 5);
  assert.deepEqual(s.by_muscle_group.map((g: { group: string }) => g.group).sort(), ["chest", "legs"]);
  const range = (await call(c, "get_strength_sets", { from: "2026-10-01", to: "2026-10-31" })).structuredContent!;
  assert.equal(range.total_volume_kg, 2300);
  const cmp = (await call(c, "compare_activities", { activity_ids: [1, 3] })).structuredContent!;
  assert.equal(cmp.activities.length, 2);
  assert.equal(cmp.differences_to_first[0].id, 3);
  assert.equal(cmp.differences_to_first[0].distance_km, 0);
});

test("training load, zones, volume, best efforts, health trends, athlete settings", async () => {
  const t = services();
  const c = await connect(t, "alice");
  const { recomputeLoads } = await import("../src/analytics/recompute.ts");
  recomputeLoads(t.repos, "alice", "2026-09-20", "2026-10-30");
  const load = (await call(c, "get_training_load", { from: "2026-10-01", to: "2026-10-30" })).structuredContent!;
  assert.equal(load.series.length, 30);
  assert.ok(load.latest.ctl > 0);
  assert.match(load.latest.form, /fresh|neutral|productive|fatigued/);
  const weekly = (await call(c, "get_training_load", { from: "2026-10-01", to: "2026-10-30", granularity: "weekly" })).structuredContent!;
  assert.ok(weekly.series.length >= 4 && weekly.series.length <= 6);
  assert.equal((await call(c, "get_training_load", { from: "2020-01-01", to: "2026-10-30" })).isError, true, "daily over a year is refused");
  assert.equal((await call(c, "get_training_load", { from: "2026-10-30", to: "2026-10-01" })).isError, true);

  const zones = (await call(c, "get_zone_distribution", { kind: "hr", from: "2026-10-01", to: "2026-10-31" })).structuredContent!;
  assert.equal(zones.seconds_per_zone.length, 5);
  assert.ok(Math.abs(zones.share_per_zone_pct.reduce((a: number, b: number) => a + b, 0) - 100) < 1);

  const vol = (await call(c, "get_volume", { by: "week", from: "2026-09-28", to: "2026-10-31" })).structuredContent!;
  assert.equal(vol.rows.length, 3);
  const best = (await call(c, "get_best_efforts", { sport: "running", from: "2026-01-01", to: "2026-12-31" })).structuredContent!;
  assert.equal(best.running.find((e: { distance_m: number }) => e.distance_m === 1000).seconds, 280);

  const health = (await call(c, "get_health_trends", { from: "2026-09-20", to: "2026-10-29" })).structuredContent!;
  assert.ok(health.latest.resting_hr_bpm.delta > 0, "resting HR rose in the last days");
  assert.equal(health.points.length, 40);

  const athlete = (await call(c, "get_athlete_settings")).structuredContent!;
  assert.equal(athlete.current.hr_max, 190);
  assert.equal(athlete.zone_lower_bounds.hr.length, 5);
  assert.ok(!JSON.stringify(athlete).includes("zones_json"));
});

test("trigger_sync: refused without a key, starts a sync with one", async () => {
  const t = services();
  const c = await connect(t, "alice");
  assert.equal((await call(c, "trigger_sync")).isError, true);
  await t.keys.put("alice", "good-key", null);
  const r = await call(c, "trigger_sync");
  assert.equal(r.structuredContent!.started, true);
});

test("invalid arguments are rejected by the schema, not by the code", async () => {
  const c = await connect(services(), "alice");
  const r = await c.callTool({ name: "list_activities", arguments: { limit: 5000 } }).catch((e) => e);
  assert.ok(r instanceof Error || (r as ToolResult).isError, "limit above the maximum");
  const r2 = await c.callTool({ name: "list_activities", arguments: { sport: "chess" } }).catch((e) => e);
  assert.ok(r2 instanceof Error || (r2 as ToolResult).isError);
});

test("prompts return instructions that name the tools", async () => {
  const t = services();
  const c = await connect(t, "alice");
  const week = await c.getPrompt({ name: "analyze_week", arguments: { week_start: "2026-10-12" } });
  const text = (week.messages[0]!.content as { text: string }).text;
  assert.match(text, /2026-10-12 to 2026-10-18/);
  for (const tool of ["get_training_load", "list_activities", "get_health_trends"]) assert.ok(text.includes(tool), tool);
  const race = await c.getPrompt({ name: "race_readiness", arguments: { race_date: "2026-12-06", distance_km: "21.1", goal: "sub 1:45" } });
  const rt = (race.messages[0]!.content as { text: string }).text;
  assert.match(rt, /2026-12-06/);
  assert.match(rt, /sub 1:45/);
});

// The whole stack: SDK client -> Streamable HTTP -> external listener (bearer check against a mocked Home Assistant) -> MCP.
const tokenAlice = jwt();
const tokenBob = jwt();
const ha = await mockHa({ [tokenAlice]: { id: "alice", name: "Alice" }, [tokenBob]: { id: "bob", name: "Bob" } });
after(() => ha.close());

test("over HTTP: no token -> 401 with the metadata pointer; with a token the client works and is scoped to its user", async () => {
  const t = services();
  const app = createExternalApp({
    haUrl: "https://ha.example.test", appUrl: "https://garmin.example.test",
    verifier: createHaTokenVerifier({ wsUrl: ha.url, timeoutMs: 1000 }), api: t.api, mcp: createMcpEndpoint(t), staticRoot: staticRoot(),
  });
  const anonymous = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("www-authenticate") ?? "", /resource_metadata=/);

  const clientFor = async (token: string) => {
    const transport = new StreamableHTTPClientTransport(new URL("https://garmin.example.test/mcp"), {
      fetch: ((url: string | URL, init?: RequestInit) => app.request(String(url), init)) as typeof fetch,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "http-test", version: "1.0.0" });
    await client.connect(transport);
    return client;
  };
  const alice = await clientFor(tokenAlice);
  assert.equal((await alice.listTools()).tools.length, 13);
  assert.equal((await call(alice, "list_activities")).structuredContent!.total, 3);
  const bob = await clientFor(tokenBob);
  assert.equal((await call(bob, "list_activities")).structuredContent!.total, 1);
  await alice.close();
  await bob.close();
});

test("list_custom_sports: name, base types and activity count; filters by name; scoped to the user", async () => {
  const t = services();
  const id = t.repos.customSports.create("alice", "Dragon boat", ["stand_up_paddleboarding"]);
  t.repos.customSports.create("bob", "Bob's sport", []);
  t.repos.customSports.assign("alice", 1, id);
  const c = await connect(t, "alice");
  const r = await call(c, "list_custom_sports");
  assert.deepEqual(r.structuredContent!.custom_sports, [{ name: "Dragon boat", garmin_types: ["stand_up_paddleboarding"], activities: 1 }]);
  assert.equal((await call(c, "list_activities", { custom_sport: "dragon boat" })).structuredContent!.total, 1);
  assert.equal((await call(c, "list_activities", { custom_sport: "Bob's sport" })).isError, true);
});

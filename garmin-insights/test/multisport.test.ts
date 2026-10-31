import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { Hono } from "hono";
import { durationWeightedHr, legOverview, parentAvgHr, parentHr } from "../src/analytics/multisport.ts";
import { buildMcpServer } from "../src/mcp/server.ts";
import type { Env } from "../src/types.ts";
import type { GarminApi } from "../src/garmin/client.ts";
import { activity, memoryRepos, seedUser, testApi } from "./helpers.ts";

test("parent HR: duration-weighted over the legs that have HR and a duration", () => {
  assert.equal(durationWeightedHr([{ duration_s: 600, avg_hr: 120 }, { duration_s: 300, avg_hr: 150 }]), 130);
  assert.equal(durationWeightedHr([{ duration_s: 600, avg_hr: 120 }, { duration_s: null, avg_hr: 180 }, { duration_s: 300, avg_hr: null }]), 120);
  assert.equal(durationWeightedHr([]), null);
  const legs = [{ id: 2, sport: "rowing", type_key: "indoor_rowing", start_utc: "2026-10-01T06:00:00.000Z", duration_s: 600, avg_hr: 120, tss: 10.04 }];
  assert.equal(parentAvgHr({ avg_hr: 140 }, legs), 140, "Garmin's own value wins");
  assert.equal(parentAvgHr({ avg_hr: null }, legs), 120);
  assert.deepEqual(legOverview({ start_utc: "2026-10-01T05:59:30.000Z" }, legs), [
    { id: 2, sport: "rowing", garmin_type: "indoor_rowing", start_offset_s: 30, duration_s: 600, avg_hr: 120, tss: 10 },
  ]);
});

test("parent max HR: the highest cleaned leg maximum once the legs are checked, artifact seconds summed", () => {
  const leg = { sport: "other", type_key: "hiit", start_utc: "2026-10-01T06:00:00.000Z", duration_s: 600, avg_hr: 130, tss: 10 };
  const parent = { avg_hr: null, max_hr: 201, max_hr_clean: null, hr_artifact_s: null };
  const legs = [
    { ...leg, id: 2, max_hr: 201, max_hr_clean: 158, hr_artifact_s: 2 },
    { ...leg, id: 3, max_hr: 165, max_hr_clean: 165, hr_artifact_s: 0 },
  ];
  assert.deepEqual(parentHr(parent, legs), { avg_hr: 130, max_hr: 201, max_hr_clean: 165, hr_artifact_s: 2 });
  // Legs not checked yet (no FIT file so far): only the average is derived, the raw max stays.
  const unchecked = legs.map((l) => ({ ...l, max_hr_clean: null, hr_artifact_s: null }));
  assert.deepEqual(parentHr(parent, unchecked), { avg_hr: 130, max_hr: 201, max_hr_clean: null, hr_artifact_s: null });
});

// alice: CrossFit (parent 10 without HR, legs 11 and 12); bob: an activity with alice's parent id, but no legs.
function seed(repos: ReturnType<typeof memoryRepos>) {
  for (const u of ["alice", "bob"]) seedUser(repos, u);
  const at = (time: string) => `2026-10-01T${time}.000Z`;
  repos.activities.upsertSummary("alice", activity(10, "2026-10-01", { start_utc: at("06:00:00"), type_key: "multi_sport", sport: "other", avg_hr: null, duration_s: 900 }));
  repos.activities.upsertSummary("alice", activity(11, "2026-10-01", { start_utc: at("06:00:00"), type_key: "indoor_rowing", sport: "rowing", avg_hr: 120, duration_s: 600 }));
  repos.activities.upsertSummary("alice", activity(12, "2026-10-01", { start_utc: at("06:10:00"), type_key: "hiit", sport: "other", avg_hr: 150, duration_s: 300 }));
  repos.activities.setMultisport("alice", 10, { parent_id: null, is_multisport_parent: 1 });
  for (const id of [11, 12]) repos.activities.setMultisport("alice", id, { parent_id: 10, is_multisport_parent: 0 });
  repos.activities.upsertSummary("bob", activity(10, "2026-10-01", { name: "bob run" }));
  repos.activities.upsertSummary("bob", activity(13, "2026-10-01", { name: "bob other" }));
}

test("legs: in start order, scoped to the user; a re-sync of the summary keeps the link", () => {
  const repos = memoryRepos();
  seed(repos);
  assert.deepEqual(repos.activities.legs("alice", 10).map((l) => [l.id, l.type_key, l.avg_hr]), [[11, "indoor_rowing", 120], [12, "hiit", 150]]);
  assert.deepEqual(repos.activities.legs("bob", 10), [], "bob's activity 10 has no legs");
  // bob linking his own activity to id 10 does not touch alice's parent.
  repos.activities.setMultisport("bob", 13, { parent_id: 10, is_multisport_parent: 0 });
  assert.deepEqual(repos.activities.legs("alice", 10).map((l) => l.id), [11, 12]);
  repos.activities.upsertSummary("alice", activity(11, "2026-10-01", { start_utc: "2026-10-01T06:00:00.000Z", type_key: "indoor_rowing", avg_hr: 121 }));
  assert.equal(repos.activities.get("alice", 11)!.parent_id, 10);
});

const noGarmin = (): GarminApi => ({
  searchActivities: async () => [], downloadActivityZip: async () => null, dailySummaries: async () => [], sleepSummaries: async () => [], hrvSummaries: async () => [], heartRateZones: async () => [],
});

test("REST detail: legs with offsets, parent HR derived from the legs, a leg names its parent", async () => {
  const t = testApi({ garmin: noGarmin, today: () => "2026-10-30" });
  seed(t.repos);
  const app = new Hono<Env>();
  app.use("*", async (c, next) => (c.set("access", "external"), c.set("user", { id: "alice", name: "alice" }), next()));
  app.route("/api", t.api);
  const parent = await (await app.request("/api/activities/10")).json();
  assert.equal(parent.activity.avg_hr, 130);
  assert.deepEqual(parent.legs.map((l: { id: number; start_offset_s: number; avg_hr: number }) => [l.id, l.start_offset_s, l.avg_hr]), [[11, 0, 120], [12, 600, 150]]);
  const leg = await (await app.request("/api/activities/12")).json();
  assert.deepEqual([leg.activity.parent_id, leg.legs], [10, []]);
  const list = await (await app.request("/api/activities")).json();
  assert.deepEqual(list.items.map((a: { id: number }) => a.id), [10], "legs are not listed on their own");
});

test("MCP: get_activity lists the legs, list_activities counts them", async () => {
  const t = testApi({ garmin: noGarmin, today: () => "2026-10-30" });
  seed(t.repos);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(t, { id: "alice", name: "alice" }).connect(a);
  const c = new Client({ name: "test", version: "1.0.0" });
  await c.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => ((await c.callTool({ name, arguments: args })) as { structuredContent: Record<string, any> }).structuredContent;
  const parent = await call("get_activity", { activity_id: 10 });
  assert.equal(parent.activity.avg_hr_bpm, 130);
  assert.deepEqual(parent.legs.map((l: { id: number; garmin_type: string }) => [l.id, l.garmin_type]), [[11, "indoor_rowing"], [12, "hiit"]]);
  assert.equal(parent.parent_activity_id, null);
  assert.equal((await call("get_activity", { activity_id: 11 })).parent_activity_id, 10);
  const list = await call("list_activities", {});
  assert.deepEqual(list.activities.map((x: { id: number; legs_count?: number }) => [x.id, x.legs_count]), [[10, 2]]);
});

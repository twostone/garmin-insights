import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { createRepos } from "../src/repo/index.ts";
import { sportOf } from "../src/sport.ts";
import { activity, seedUser } from "./helpers.ts";

// The shared filter, counting and grouping rules every analysis builds on.
function setup() {
  const db = openDb(":memory:");
  const repos = createRepos(db);
  for (const u of ["alice", "bob"]) seedUser(repos, u);
  db.prepare("INSERT INTO custom_sports (user_id, id, name) VALUES ('alice', 1, 'Dragon boat'), ('bob', 1, 'OC1')").run();
  return { db, repos };
}

test("sportOf maps versioned paddle types by prefix and rowing by key", () => {
  assert.equal(sportOf("stand_up_paddleboarding_v2"), "paddling");
  assert.equal(sportOf("kayaking_v2"), "paddling");
  assert.equal(sportOf("indoor_rowing"), "rowing");
  assert.equal(sportOf("hiit"), "other");
  assert.equal(sportOf(null), "other");
});

test("the own sport filters and groups, and a re-sync keeps the assignment", () => {
  const { db, repos } = setup();
  repos.activities.upsertSummary("alice", activity(1, "2026-10-01", { sport: "paddling", type_key: "stand_up_paddleboarding_v2" }));
  repos.activities.upsertSummary("alice", activity(2, "2026-10-02", { sport: "paddling", type_key: "stand_up_paddleboarding_v2" }));
  db.prepare("UPDATE activities SET custom_sport_id = 1 WHERE user_id = 'alice' AND id = 1").run();
  repos.activities.upsertSummary("alice", activity(1, "2026-10-01", { sport: "paddling", type_key: "stand_up_paddleboarding_v2", name: "renamed in Garmin" }));

  const one = repos.activities.get("alice", 1)!;
  assert.equal(one.custom_sport, "Dragon boat");
  assert.equal(one.group_key, "Dragon boat");
  assert.equal(one.name, "renamed in Garmin");
  assert.equal(repos.activities.get("alice", 2)!.group_key, "paddling");
  assert.deepEqual(repos.activities.list("alice", { customSportId: 1 }).map((a) => a.id), [1]);
  assert.equal(repos.activities.count("alice", { customSportId: 1 }), 1);
  // bob's custom sport 1 is a different one and never matches alice's rows
  assert.equal(repos.activities.list("bob", { customSportId: 1 }).length, 0);
  assert.equal(repos.customSports.idByName("alice", "dragon BOAT"), 1);
  assert.equal(repos.customSports.idByName("bob", "Dragon boat"), undefined);
});

test("multisport: legs count and the parent does not; listings show only the parent", () => {
  const { db, repos } = setup();
  repos.activities.upsertSummary("alice", activity(10, "2026-10-05", { type_key: "multi_sport" }));
  repos.activities.upsertSummary("alice", activity(11, "2026-10-05", { type_key: "indoor_rowing", sport: "rowing" }));
  repos.activities.upsertSummary("alice", activity(12, "2026-10-05", { type_key: "hiit" }));
  repos.activities.upsertSummary("alice", activity(20, "2026-10-06", { type_key: "multi_sport" })); // legs not synced yet
  db.prepare("UPDATE activities SET is_multisport_parent = 1 WHERE id IN (10, 20)").run();
  db.prepare("UPDATE activities SET parent_id = 10 WHERE id IN (11, 12)").run();
  for (const [id, tss] of [[10, 100], [11, 40], [12, 60], [20, 30]] as const) repos.activities.setLoad("alice", id, { trimp: tss, tss, tss_method: "hr" });

  assert.deepEqual(repos.activities.list("alice", { topLevel: true, order: "asc" }).map((a) => a.id), [10, 20]);
  assert.deepEqual(repos.activities.list("alice", { counted: true, order: "asc" }).map((a) => a.id), [11, 12, 20]);
  assert.deepEqual(repos.activities.dailyLoad("alice", "2026-10-01", "2026-10-31").map((d) => [d.date, d.tss]), [["2026-10-05", 100], ["2026-10-06", 30]]);
  assert.deepEqual(repos.activities.calendar("alice", "2026-10-01", "2026-10-31").map((d) => [d.date, d.count]), [["2026-10-05", 2], ["2026-10-06", 1]]);
});

test("the historic HR max prefers the cleaned value", () => {
  const { db, repos } = setup();
  repos.activities.upsertSummary("alice", activity(1, "2026-10-01", { max_hr: 201 }));
  repos.activities.upsertSummary("alice", activity(2, "2026-10-02", { max_hr: 175 }));
  db.prepare("UPDATE activities SET max_hr_clean = 172 WHERE id = 1").run();
  assert.equal(repos.activities.maxHr("alice"), 175);
});

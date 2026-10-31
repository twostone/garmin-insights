import { parseFit } from "../src/fit/parse.ts";
import type { FitStore } from "../src/fit/store.ts";
import type { Repos } from "../src/repo/index.ts";
import { runFit, strengthFit } from "./fit-fixtures.ts";
import { activity } from "./helpers.ts";

// Two users, alice with a run (FIT detail), a strength session and a plain run; bob with one activity of his own that shares
// alice's Garmin id 1 on purpose (ids are only unique per user).
export function seedTraining(t: { repos: Repos; fit: FitStore }) {
  const { repos, fit } = t;
  for (const u of ["alice", "bob"]) repos.users.upsert({ id: u, name: u });
  const run = parseFit(runFit());
  repos.activities.upsertSummary("alice", activity(1, "2026-10-01", { summary_json: JSON.stringify({ fastestSplit_1000: 290, fastestSplit_5000: 1500, hrTimeInZone_1: 100, hrTimeInZone_2: 200 }) }));
  repos.activities.replaceDetail("alice", 1, { samples: run.samples, laps: run.laps, sets: [] });
  repos.activities.setFitStatus("alice", 1, "done");
  fit.save("alice", 1, runFit());
  repos.activities.upsertSummary("alice", activity(2, "2026-10-05", { sport: "strength", type_key: "strength_training" }));
  const st = parseFit(strengthFit());
  repos.activities.replaceDetail("alice", 2, { samples: st.samples, laps: [], sets: st.sets });
  repos.activities.setFitStatus("alice", 2, "done");
  repos.activities.upsertSummary("alice", activity(3, "2026-10-10", { summary_json: JSON.stringify({ fastestSplit_1000: 280 }) }));
  repos.activities.upsertSummary("bob", activity(1, "2026-10-02", { name: "bob run" }));
  repos.athlete.upsert("alice", { valid_from: "2026-01-01", hr_max: 190, hr_rest: 50, lthr: 170, ftp: null, threshold_pace_s_per_km: null, sex: null, zones_json: null, source: "manual" });
}


// Paddling for alice: a session with samples (stroke rate, a stop) assigned to her own sport "Dragon boat", and a plain
// summary-only one in the next week. Resting HR 45. Needs the DB the services were built on, to assign the own sport.
export function seedPaddling(t: { repos: Repos }, db: import("node:sqlite").DatabaseSync) {
  const { repos } = t;
  repos.users.upsert({ id: "alice", name: "alice" });
  repos.athlete.upsert("alice", { valid_from: "2026-01-01", hr_max: 190, hr_rest: 45, lthr: null, ftp: null, threshold_pace_s_per_km: null, sex: null, zones_json: null, source: "manual" });
  const paddle = { sport: "paddling", type_key: "stand_up_paddleboarding_v2" } as const;
  repos.activities.upsertSummary("alice", activity(30, "2026-10-06", { ...paddle, distance_m: 3000, duration_s: 1260, moving_s: 1200, avg_hr: 120 }));
  const row = (t: number, speed: number, hr: number) => ({ t, lat: null, lon: null, alt: null, hr, power: null, cadence: speed ? 60 : 0, speed, dist: null, temp: null });
  const samples = [
    ...Array.from({ length: 600 }, (_, i) => row(i, 3, 130)),
    ...Array.from({ length: 60 }, (_, i) => row(600 + i, 0, 90)),
    ...Array.from({ length: 600 }, (_, i) => row(660 + i, 2, 110)),
  ];
  repos.activities.replaceDetail("alice", 30, { samples, laps: [], sets: [] });
  repos.activities.setFitStatus("alice", 30, "done");
  repos.activities.upsertSummary("alice", activity(31, "2026-10-14", { ...paddle, distance_m: 8400, duration_s: 3060, moving_s: 3060, avg_hr: 128 }));
  db.prepare("INSERT INTO custom_sports (user_id, id, name) VALUES ('alice', 1, 'Dragon boat')").run();
  db.prepare("UPDATE activities SET custom_sport_id = 1 WHERE user_id = 'alice' AND id = 30").run();
}

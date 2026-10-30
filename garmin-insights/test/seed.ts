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


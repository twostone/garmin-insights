// Fills a throw-away database with synthetic data for looking at the UI (no Garmin account needed):
//   DATA_DIR=./data/demo npx tsx scripts/seed-demo.ts && DATA_DIR=./data/demo INGRESS_ONLY_IP= DEV_USER_ID=demo npm start
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { recomputeLoads } from "../src/analytics/recompute.ts";
import { addDays, todayLocal } from "../src/dates.ts";
import { openDb } from "../src/db.ts";
import { createRepos } from "../src/repo/index.ts";
import type { LapRow, SampleRow, StrengthSetRow } from "../src/repo/activities.ts";

const dataDir = resolve(process.env.DATA_DIR ?? "./data/demo");
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
const repos = createRepos(openDb(join(dataDir, "garmin-insights.db")));
const user = process.env.DEV_USER_ID ?? "demo";
repos.users.upsert({ id: user, name: "Demo" });

const today = todayLocal();
const noise = (i: number, amp: number) => Math.sin(i / 37) * amp + Math.sin(i / 11) * amp * 0.4;

function runSamples(seconds: number, speed: number): SampleRow[] {
  let dist = 0;
  return Array.from({ length: seconds }, (_, t) => {
    const v = speed + noise(t, 0.25);
    dist += v;
    const angle = (t / seconds) * Math.PI * 2;
    return {
      t, lat: 48.137 + Math.sin(angle) * 0.012, lon: 11.575 + Math.cos(angle) * 0.018 - 0.018, alt: 520 + Math.sin(t / 200) * 12,
      hr: Math.round(138 + (t / seconds) * 18 + noise(t, 3)), power: null, cadence: 170, speed: v, dist, temp: 14,
    };
  });
}
function rideSamples(seconds: number): SampleRow[] {
  let dist = 0;
  return Array.from({ length: seconds }, (_, t) => {
    const v = 8.5 + noise(t, 1.2);
    dist += v;
    return { t, lat: null, lon: null, alt: 500 + Math.sin(t / 400) * 40, hr: Math.round(132 + noise(t, 8)), power: Math.round(190 + noise(t, 45)), cadence: 88, speed: v, dist, temp: 18 };
  });
}
const laps = (seconds: number, n: number, speed: number): LapRow[] =>
  Array.from({ length: n }, (_, idx) => ({ idx, start_s: (idx * seconds) / n, duration_s: seconds / n, distance_m: (speed * seconds) / n, avg_hr: 140 + idx * 2, max_hr: 150 + idx * 2, avg_power: null, avg_speed: speed, avg_cadence: 170, ascent_m: 8 }));

let id = 1000;
let weekRun = 0;
for (let d = 119; d >= 0; d--) {
  const date = addDays(today, -d);
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const base = (type: string, sport: string, name: string, secs: number, dist: number | null, extra: Record<string, unknown> = {}) => {
    const row = {
      id: ++id, start_utc: `${date}T06:30:00.000Z`, date, name, type_key: type, sport, distance_m: dist, duration_s: secs, moving_s: secs, elevation_gain_m: dist ? dist / 100 : null,
      avg_hr: 148, max_hr: 172, avg_power: null, norm_power: null, avg_speed: dist ? dist / secs : null, max_speed: null, calories: Math.round(secs / 6), vo2max: 52,
      te_aerobic: 3.1, te_anaerobic: 0.8, start_lat: sport === "running" ? 48.137 : null, start_lon: sport === "running" ? 11.575 : null, total_sets: null, total_reps: null,
      summary_json: JSON.stringify({ fastestSplit_1000: 275 + (d % 17), fastestSplit_5000: 1500 + d, maxAvgPower_300: 280 - (d % 20), maxAvgPower_1200: 235 - (d % 15), hrTimeInZone_1: 200, hrTimeInZone_2: 900, hrTimeInZone_3: 600, hrTimeInZone_4: 200, hrTimeInZone_5: 30 }),
      ...extra,
    };
    repos.activities.upsertSummary(user, row as never);
    return row.id;
  };
  if (dow === 2 || dow === 4 || dow === 6) {
    const secs = 1800 + (d % 5) * 300;
    const speed = 3.2 + (d % 4) * 0.1;
    const rid = base("running", "running", `Run ${++weekRun}`, secs, secs * speed);
    repos.activities.replaceDetail(user, rid, { samples: runSamples(secs, speed), laps: laps(secs, 5, speed), sets: [] });
    repos.activities.setFitStatus(user, rid, "done");
  } else if (dow === 0) {
    const secs = 5400;
    const rid = base("road_biking", "cycling", "Sunday ride", secs, secs * 8.5, { avg_power: 190, norm_power: 215, avg_hr: 134 });
    repos.activities.replaceDetail(user, rid, { samples: rideSamples(secs), laps: laps(secs, 3, 8.5), sets: [] });
    repos.activities.setFitStatus(user, rid, "done");
  } else if (dow === 1 || dow === 5) {
    const rid = base("strength_training", "strength", "Strength", 3000, null, { avg_hr: 112, max_hr: 150, total_sets: 9, total_reps: 80 });
    const sets: StrengthSetRow[] = [];
    let i = 0;
    for (const [ex, reps, kg] of [["bench_press", 10, 60 + (d % 3) * 2.5], ["squat", 8, 90 + (d % 4) * 2.5], ["row", 10, 55], ["shoulder_press", 10, 35]] as const) {
      for (let s = 0; s < 3; s++) {
        sets.push({ idx: i++, start_s: i * 120, duration_s: 40, set_type: "active", exercise: ex, reps, weight_kg: kg });
        sets.push({ idx: i++, start_s: i * 120 + 40, duration_s: 80, set_type: "rest", exercise: null, reps: null, weight_kg: null });
      }
    }
    repos.activities.replaceDetail(user, rid, { samples: Array.from({ length: 3000 }, (_, t) => ({ t, lat: null, lon: null, alt: null, hr: Math.round(105 + noise(t, 10)), power: null, cadence: null, speed: null, dist: null, temp: null })), laps: [], sets });
    repos.activities.setFitStatus(user, rid, "done");
  }
  repos.health.dailies.upsertMany(user, [{ date, steps: 6000 + (d % 7) * 900, resting_hr: 50 + ((d * 7) % 5) - (d > 100 ? 2 : 0), min_hr: 44, max_hr: 160, stress_avg: 28 + (d % 9), body_battery_high: 85 + (d % 10), body_battery_low: 12 + (d % 8), active_minutes: 40 }]);
  repos.health.sleep.upsertMany(user, [{ date, sleep_s: 25200 + (d % 6) * 1200, deep_s: 5400, light_s: 14000, rem_s: 5800, awake_s: 1200, score: 70 + (d % 20), avg_spo2: 95, avg_respiration: 14, avg_stress: 18, avg_hr: 50 }]);
  repos.health.hrv.upsertMany(user, [{ date, last_night_avg: 58 + ((d * 3) % 12), weekly_avg: 60, last_night_5min_high: 85, baseline_low: 52, baseline_high: 68, status: "BALANCED" }]);
}
repos.athlete.upsert(user, { valid_from: addDays(today, -200), hr_max: 188, hr_rest: 48, lthr: 168, ftp: 245, threshold_pace_s_per_km: 285, sex: "m", zones_json: null, source: "garmin" });
recomputeLoads(repos, user, addDays(today, -119), today);
console.log(`seeded ${repos.activities.count(user)} activities for user "${user}" in ${dataDir}`);

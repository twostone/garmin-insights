import { test } from "node:test";
import assert from "node:assert/strict";
import { bestEfforts, decoupling, meanMaxPower } from "../src/analytics/efforts.ts";
import { hrZonesFromMax, paceZonesFromThreshold, powerZonesFromFtp, timeInZones } from "../src/analytics/zones.ts";
import { MUSCLE_GROUP, strengthVolume } from "../src/analytics/strength.ts";
import { healthTrends, pearson, rolling } from "../src/analytics/health.ts";
import { volumeBy } from "../src/analytics/volume.ts";
import type { Sample } from "../src/analytics/load.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);

test("zones: seconds per zone from lower bounds, below the first floor is its own bucket", () => {
  const s: Sample[] = [
    ...Array.from({ length: 60 }, (_, t) => ({ t, hr: 90 })), // below 95
    ...Array.from({ length: 120 }, (_, t) => ({ t: 60 + t, hr: 120 })), // zone 2 (114..132)
    ...Array.from({ length: 30 }, (_, t) => ({ t: 180 + t, hr: 175 })), // zone 5
  ];
  const r = timeInZones(s, (x) => x.hr, [95, 114, 133, 152, 171]);
  assert.deepEqual(r, { below: 60, zones: [0, 120, 0, 0, 30] });
});

test("zone helpers: Coggan power zones from FTP, 5 HR zones from max, pace zones as speeds from threshold", () => {
  assert.deepEqual(powerZonesFromFtp(200), [0, 110, 150, 180, 210, 240, 300]);
  assert.deepEqual(hrZonesFromMax(200), [100, 120, 140, 160, 180]);
  const z = paceZonesFromThreshold(300); // 5:00 /km = 3.333 m/s
  close(z[4]!, (1000 / 300) * 1.02, 1e-9);
  assert.equal(z.length, 5);
});

test("decoupling Pa:Hr: same pace, HR 10 % higher in the second half = 9.09 % decoupling", () => {
  const half = (t0: number, hr: number) => Array.from({ length: 1800 }, (_, i) => ({ t: t0 + i, hr, speed: 3 }));
  const r = decoupling([...half(0, 140), ...half(1800, 154)]);
  close(r!, ((3 / 140 - 3 / 154) / (3 / 140)) * 100, 1e-9);
  close(r!, 9.0909, 1e-3);
  assert.equal(decoupling(half(0, 140)), 0, "steady = 0");
  assert.equal(decoupling(Array.from({ length: 20 }, (_, t) => ({ t, hr: 140, speed: 3 }))), null, "too short to say");
  const warm = [...Array.from({ length: 600 }, (_, i) => ({ t: i, hr: 100, speed: 1 })), ...half(600, 140), ...half(2400, 140)];
  assert.equal(decoupling(warm, { warmupS: 600 }), 0, "warm-up is skipped");
});

test("best efforts: fastest window of a distance, with interpolation at the boundary", () => {
  // 1 km at 4 m/s (250 s), then 1 km at 5 m/s (200 s), then 1 km at 4 m/s.
  const s: Sample[] = [];
  let d = 0;
  for (let t = 0; t <= 650; t++) {
    s.push({ t, dist: d });
    d += t < 250 ? 4 : t < 450 ? 5 : 4;
  }
  const r = bestEfforts(s, [1000, 5000]);
  assert.deepEqual(r.map((x) => x.distance), [1000]);
  close(r[0]!.seconds, 200, 1.1);
  close(r[0]!.startT, 250, 1.1);
});

test("mean-max power: best average per duration", () => {
  const p = [...new Array(100).fill(100), ...new Array(60).fill(300), ...new Array(100).fill(100)];
  const r = meanMaxPower(p, [5, 30, 60, 120, 1000]);
  assert.deepEqual(r.map((x) => x.seconds), [5, 30, 60, 120]);
  assert.equal(r[0]!.watts, 300);
  assert.equal(r[2]!.watts, 300);
  close(r[3]!.watts, (60 * 300 + 60 * 100) / 120, 1e-9);
});

test("strength: volume = reps * kg per exercise (active sets only), est. 1RM by Epley, muscle groups from the category", () => {
  const sets = [
    { activity_id: 1, date: "2026-10-01", idx: 0, start_s: 0, duration_s: 30, set_type: "active" as const, exercise: "bench_press", reps: 10, weight_kg: 60 },
    { activity_id: 1, date: "2026-10-01", idx: 1, start_s: 60, duration_s: 30, set_type: "rest" as const, exercise: null, reps: null, weight_kg: null },
    { activity_id: 1, date: "2026-10-01", idx: 2, start_s: 90, duration_s: 30, set_type: "active" as const, exercise: "bench_press", reps: 8, weight_kg: 62.5 },
    { activity_id: 1, date: "2026-10-01", idx: 3, start_s: 150, duration_s: 30, set_type: "active" as const, exercise: "squat", reps: 12, weight_kg: 100 },
    { activity_id: 1, date: "2026-10-01", idx: 4, start_s: 200, duration_s: 30, set_type: "active" as const, exercise: "plank", reps: null, weight_kg: null },
  ];
  const r = strengthVolume(sets);
  const bench = r.byExercise.find((e) => e.exercise === "bench_press")!;
  assert.deepEqual([bench.sets, bench.reps, bench.volume_kg, bench.max_weight_kg], [2, 18, 600 + 500, 62.5]);
  close(bench.best_e1rm_kg!, 60 * (1 + 10 / 30), 1e-9); // 80.0 beats 62.5 x 8 = 79.2
  assert.equal(r.byMuscleGroup.find((g) => g.group === "chest")!.volume_kg, 1100);
  assert.equal(r.byMuscleGroup.find((g) => g.group === "legs")!.volume_kg, 1200);
  assert.equal(r.totalVolumeKg, 2300);
  assert.equal(MUSCLE_GROUP.plank, "core");
  assert.equal(r.byExercise.find((e) => e.exercise === "plank")!.volume_kg, 0);
});

test("volume per week/month and sport", () => {
  const a = (date: string, sport: string, dist: number, dur: number, tss = 0) => ({ date, sport, distance_m: dist, duration_s: dur, elevation_gain_m: 10, tss, trimp: tss });
  const rows = volumeBy(
    [a("2026-10-05", "running", 10000, 3000, 60), a("2026-10-11", "running", 5000, 1500, 30), a("2026-10-12", "running", 8000, 2400, 50), a("2026-10-13", "cycling", 40000, 5400, 70)],
    "week",
  );
  const w1 = rows.find((r) => r.period === "2026-10-05" && r.sport === "running")!;
  assert.deepEqual([w1.count, w1.distance_m, w1.duration_s, w1.tss], [2, 15000, 4500, 90]);
  assert.equal(rows.find((r) => r.period === "2026-10-12" && r.sport === "cycling")!.distance_m, 40000);
  assert.equal(volumeBy([a("2026-10-05", "running", 1, 1), a("2026-11-01", "running", 1, 1)], "month").length, 2);
});

test("health: rolling mean ignores gaps, Pearson correlation, trends compare 7 d against the 28 d baseline", () => {
  close(rolling([1, 2, null, 4], 3)[3]!, (2 + 4) / 2, 1e-9);
  close(pearson([1, 2, 3, 4], [2, 4, 6, 8])!, 1, 1e-12);
  close(pearson([1, 2, 3, 4], [8, 6, 4, 2])!, -1, 1e-12);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  const dates = Array.from({ length: 35 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
  const t = healthTrends({
    dates,
    restingHr: dates.map((_, i) => (i < 28 ? 50 : 56)),
    hrv: dates.map((_, i) => (i < 28 ? 60 : 50)),
    sleepHours: dates.map(() => 7),
    atl: dates.map((_, i) => i),
  });
  assert.equal(t.points.length, 35);
  close(t.latest.restingHr.avg7!, 56, 1e-9);
  assert.ok(t.latest.restingHr.deltaVsBaseline! > 0);
  assert.ok(t.latest.hrv.deltaVsBaseline! < 0);
  close(t.correlations.restingHrVsAtl!, 0.6931032800836721, 1e-9); // step function against a ramp
});

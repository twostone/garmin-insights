import { test } from "node:test";
import assert from "node:assert/strict";
import { paddleMetrics, paddleMetricsFromSummary, weeklyPaddling, type PaddleSample } from "../src/analytics/paddling.ts";

const close = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);

// 10 min at 3 m/s (10.8 km/h), 60 s standing still, 10 min at 2 m/s (7.2 km/h); 60 strokes/min, HR 130 / 0 / 110.
function session() {
  const s: PaddleSample[] = [];
  let t = 0;
  const push = (n: number, speed: number, hr: number, cadence: number | null) => {
    for (let i = 0; i < n; i++) s.push({ t: t++, speed, hr, cadence });
  };
  push(600, 3, 130, 60);
  push(60, 0, 90, 0);
  push(600, 2, 110, 60);
  return s;
}

test("paddle metrics: stand-still below the minimum speed is not moving time", () => {
  const m = paddleMetrics(session(), { hrRest: 50 })!;
  assert.equal(m.moving_s, 1200);
  close(m.avg_speed_kmh, 9, 1e-9); // (3 + 2) / 2 m/s = 2.5 m/s
  close(m.pace_s_per_500m, 200, 1e-9);
});

test("paddle metrics: rolling best speed over 1 and 5 minutes", () => {
  const m = paddleMetrics(session(), { hrRest: 50 })!;
  close(m.max_speed_1min_kmh, 10.8, 1e-9);
  close(m.max_speed_5min_kmh, 10.8, 1e-9);
  assert.equal(paddleMetrics(session().slice(0, 100), { hrRest: 50 })!.max_speed_1min_kmh! > 0, true);
  assert.equal(paddleMetrics(session().slice(0, 100), { hrRest: 50 })!.max_speed_5min_kmh, null, "shorter than the window");
});

test("paddle metrics: stroke rate and distance per stroke from cadence", () => {
  const m = paddleMetrics(session(), { hrRest: 50 })!;
  close(m.avg_stroke_rate, 60, 1e-9);
  close(m.distance_per_stroke_m, 2.5, 1e-9); // 2.5 m/s * 60 / 60 spm
  const none = paddleMetrics(session().map((x) => ({ ...x, cadence: null })), { hrRest: 50 })!;
  assert.equal(none.avg_stroke_rate, null);
  assert.equal(none.distance_per_stroke_m, null);
});

test("paddle metrics: efficiency = km/h per bpm above resting HR", () => {
  const m = paddleMetrics(session(), { hrRest: 50 })!;
  close(m.avg_hr, 120, 1e-9);
  close(m.efficiency, 9 / (120 - 50), 1e-9);
  assert.equal(paddleMetrics(session(), { hrRest: null })!.efficiency, null);
  assert.equal(paddleMetrics(session(), { hrRest: 130 })!.efficiency, null, "HR not above rest");
});

test("paddle metrics: nothing to say without moving samples", () => {
  assert.equal(paddleMetrics([], { hrRest: 50 }), null);
  assert.equal(paddleMetrics([{ t: 0, speed: 0 }, { t: 1, speed: 0 }], { hrRest: 50 }), null);
});

test("paddle summary metrics: typical dragon-boat session, 8.4 km in 51 min at HR 128", () => {
  const m = paddleMetricsFromSummary({ distance_m: 8400, moving_s: 3060, avg_hr: 128 }, 45)!;
  close(m.avg_speed_kmh, 9.882353, 1e-5);
  close(m.pace_s_per_500m, 182.142857, 1e-5);
  close(m.efficiency, 9.882353 / 83, 1e-5);
  assert.equal(m.avg_stroke_rate, null);
  assert.equal(paddleMetricsFromSummary({ distance_m: 0, moving_s: 3060, avg_hr: 128 }, 45), null);
  assert.equal(paddleMetricsFromSummary({ distance_m: null, moving_s: 3060, avg_hr: 128 }, 45), null);
});

test("weekly paddling: per week and group, distance-weighted speed, mean efficiency", () => {
  const rows = weeklyPaddling([
    { date: "2026-10-05", group_key: "OC1", distance_m: 8000, moving_s: 3600, efficiency: 0.1 },
    { date: "2026-10-07", group_key: "OC1", distance_m: 4000, moving_s: 3600, efficiency: 0.2 },
    { date: "2026-10-07", group_key: "Dragon boat", distance_m: 6000, moving_s: 3600, efficiency: null },
    { date: "2026-10-13", group_key: "OC1", distance_m: 5000, moving_s: 0, efficiency: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.week, r.group, r.count]), [["2026-10-05", "Dragon boat", 1], ["2026-10-05", "OC1", 2], ["2026-10-12", "OC1", 1]]);
  const oc1 = rows[1]!;
  assert.equal(oc1.distance_m, 12000);
  assert.equal(oc1.duration_s, 7200);
  close(oc1.avg_speed_kmh, 6, 1e-9); // 12 km in 2 h
  close(oc1.avg_efficiency, 0.15, 1e-9);
  assert.equal(rows[0]!.avg_efficiency, null);
  assert.equal(rows[2]!.avg_speed_kmh, null, "no moving time");
});

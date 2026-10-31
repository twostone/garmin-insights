import { test } from "node:test";
import assert from "node:assert/strict";
import { readiness, type ReadinessDay } from "../src/analytics/readiness.ts";

const dateOf = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
const day = (i: number, o: Partial<ReadinessDay> = {}): ReadinessDay => ({
  date: dateOf(i), hrv: 60, hrvBaselineLow: 50, hrvBaselineHigh: 70, restingHr: 50, sleepS: 8 * 3600, sleepScore: 80, bodyBatteryHigh: 90, tsb: 0, ...o,
});
/** 35 steady days; `last` overrides the final one. */
const series = (last: Partial<ReadinessDay> = {}, n = 35): ReadinessDay[] => Array.from({ length: n }, (_, i) => day(i, i === n - 1 ? last : {}));
const status = (r: ReturnType<typeof readiness>, key: string) => r.components.find((c) => c.key === key)!.status;

test("all components fine -> good overall, five components", () => {
  const r = readiness(series(), dateOf(34));
  assert.equal(r.status, "good");
  assert.deepEqual(r.components.map((c) => c.key), ["hrv", "resting_hr", "sleep", "body_battery", "tsb"]);
  assert.ok(r.components.every((c) => c.status === "good" && c.reason.length > 0));
});

test("HRV: inside Garmin's baseline good, slightly below watch, far below poor", () => {
  assert.equal(status(readiness(series({ hrv: 52 }), dateOf(34)), "hrv"), "good");
  assert.equal(status(readiness(series({ hrv: 47 }), dateOf(34)), "hrv"), "watch"); // 50 * 0.9 = 45 <= 47 < 50
  assert.equal(status(readiness(series({ hrv: 40 }), dateOf(34)), "hrv"), "poor");
});

test("HRV without Garmin baseline falls back to the 28-day mean (60): 10 % band", () => {
  const none = { hrvBaselineLow: null, hrvBaselineHigh: null };
  const days = series({ hrv: 56, ...none }).map((d) => ({ ...d, ...none }));
  const r = readiness(days, dateOf(34));
  assert.equal(status(r, "hrv"), "good"); // floor 54
  assert.equal(r.components[0]!.reference, 60);
  const low = series({ hrv: 50 }).map((d) => ({ ...d, ...none }));
  low[34]!.hrv = 50;
  assert.equal(status(readiness(low, dateOf(34)), "hrv"), "watch"); // floor 54, poor below 48.6
});

test("resting HR: deviation from the 28-day mean in bpm", () => {
  assert.equal(status(readiness(series({ restingHr: 52 }), dateOf(34)), "resting_hr"), "good"); // +2
  assert.equal(status(readiness(series({ restingHr: 54 }), dateOf(34)), "resting_hr"), "watch"); // +4
  assert.equal(status(readiness(series({ restingHr: 57 }), dateOf(34)), "resting_hr"), "poor"); // +7
});

test("sleep: minimum duration and drop against the 28-day mean", () => {
  assert.equal(status(readiness(series({ sleepS: 5 * 3600 }), dateOf(34)), "sleep"), "poor");
  assert.equal(status(readiness(series({ sleepS: 6.5 * 3600 }), dateOf(34)), "sleep"), "watch");
  assert.equal(status(readiness(series({ sleepS: 7.2 * 3600 }), dateOf(34)), "sleep"), "good"); // 0.8 h under the mean is still fine
  assert.equal(status(readiness(series({ sleepS: 8 * 3600, sleepScore: 50 }), dateOf(34)), "sleep"), "watch");
  const longSleeper = series({ sleepS: 7.5 * 3600 }).map((d, i) => (i < 34 ? { ...d, sleepS: 9 * 3600 } : d));
  assert.equal(status(readiness(longSleeper, dateOf(34)), "sleep"), "watch"); // 1.5 h under the usual 9 h
});

test("body battery and TSB bands", () => {
  assert.equal(status(readiness(series({ bodyBatteryHigh: 60 }), dateOf(34)), "body_battery"), "watch");
  assert.equal(status(readiness(series({ bodyBatteryHigh: 30 }), dateOf(34)), "body_battery"), "poor");
  assert.equal(status(readiness(series({ tsb: 20 }), dateOf(34)), "tsb"), "good");
  assert.equal(status(readiness(series({ tsb: -20 }), dateOf(34)), "tsb"), "watch");
  assert.equal(status(readiness(series({ tsb: -40 }), dateOf(34)), "tsb"), "poor");
});

test("overall status is the worst known component; unknown does not count", () => {
  assert.equal(readiness(series({ restingHr: 54 }), dateOf(34)).status, "watch");
  assert.equal(readiness(series({ restingHr: 54, tsb: -40 }), dateOf(34)).status, "poor");
  const sparse = readiness(series({ hrv: null, hrvBaselineLow: null, hrvBaselineHigh: null, restingHr: null, sleepS: null, sleepScore: null, bodyBatteryHigh: null }), dateOf(34));
  assert.equal(sparse.components.filter((c) => c.status === "unknown").length, 4);
  assert.equal(sparse.status, "good"); // only TSB is known
});

test("nothing known -> unknown; too little history leaves relative components unknown", () => {
  const empty = readiness([day(0, { hrv: null, hrvBaselineLow: null, hrvBaselineHigh: null, restingHr: null, sleepS: null, sleepScore: null, bodyBatteryHigh: null, tsb: null })], dateOf(0));
  assert.equal(empty.status, "unknown");
  const short = readiness(series({ restingHr: 70 }, 3), dateOf(2));
  assert.equal(status(short, "resting_hr"), "unknown");
});

test("the day itself is excluded from its own baseline", () => {
  const r = readiness(series({ restingHr: 80 }), dateOf(34));
  assert.equal(r.components.find((c) => c.key === "resting_hr")!.reference, 50);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { weekBalances, type WeeklyActivity } from "../src/analytics/weekly.ts";

const close = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);

/** Daily TSS map from a start date and a list of values (one per day). */
const load = (start: string, values: number[]): Map<string, number> => {
  const m = new Map<string, number>();
  values.forEach((v, i) => m.set(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), v));
  return m;
};
const merge = (...maps: Map<string, number>[]) => new Map(maps.flatMap((m) => [...m]));
const act = (date: string, sport: string, duration_s: number, tss: number, hrZoneSeconds: number[] | null = null): WeeklyActivity => ({ date, sport, duration_s, tss, hrZoneSeconds });

test("weekly load, Foster monotony and strain: 10..70 over a week = mean 40, SD 20, monotony 2", () => {
  const [w] = weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss: load("2026-10-05", [10, 20, 30, 40, 50, 60, 70]), activities: [] });
  assert.equal(w!.week, "2026-10-05");
  assert.equal(w!.load, 280);
  close(w!.monotony, 2);
  close(w!.strain, 560);
});

test("rest days count as zero: 100 on three of seven days = monotony sqrt(3/4)", () => {
  const [w] = weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss: new Map([["2026-10-05", 100], ["2026-10-07", 100], ["2026-10-09", 100]]), activities: [] });
  close(w!.monotony, Math.sqrt(3 / 4));
  close(w!.strain, 300 * Math.sqrt(3 / 4));
});

test("monotony is null without variation (identical days or no load at all)", () => {
  const flat = weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss: load("2026-10-05", Array(7).fill(50)), activities: [] })[0]!;
  assert.equal(flat.load, 350);
  assert.equal(flat.monotony, null);
  assert.equal(flat.strain, null);
  const empty = weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss: new Map(), activities: [] })[0]!;
  assert.equal(empty.load, 0);
  assert.equal(empty.monotony, null);
});

test("ACWR: 7-day average over 28-day average at the week's end (21 days of 50, then 10..70 = 40 / 47.5)", () => {
  const dailyTss = merge(load("2026-09-14", Array(21).fill(50)), load("2026-10-05", [10, 20, 30, 40, 50, 60, 70]));
  const [w] = weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss, activities: [] });
  close(w!.acwr, 40 / 47.5);
});

test("ACWR is null when the 28-day average is zero", () => {
  assert.equal(weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss: new Map(), activities: [] })[0]!.acwr, null);
});

test("the current week is cut off at `to`: only the days that happened count", () => {
  const [w] = weekBalances({ from: "2026-10-05", to: "2026-10-07", dailyTss: load("2026-10-05", [10, 20, 30, 99, 99]), activities: [] });
  assert.equal(w!.load, 60);
  close(w!.monotony, 20 / Math.sqrt(200 / 3));
});

test("a range spans whole calendar weeks from Monday, oldest first", () => {
  const weeks = weekBalances({ from: "2026-10-04", to: "2026-10-05", dailyTss: new Map([["2026-10-04", 40], ["2026-10-05", 60]]), activities: [] });
  assert.deepEqual(weeks.map((w) => [w.week, w.load]), [["2026-09-28", 40], ["2026-10-05", 60]]);
});

test("intensity split: easy Z1-2, moderate Z3, hard Z4-5 as share of zoned time", () => {
  const activities = [act("2026-10-05", "rowing", 1800, 40, [600, 600, 300, 200, 100]), act("2026-10-07", "strength", 900, 20, [0, 0, 0, 0, 300]), act("2026-10-08", "other", 600, 5, null)];
  const [w] = weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss: new Map(), activities });
  close(w!.intensity_pct!.easy, (1200 / 2100) * 100);
  close(w!.intensity_pct!.moderate, (300 / 2100) * 100);
  close(w!.intensity_pct!.hard, (600 / 2100) * 100);
  assert.equal(weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss: new Map(), activities: [act("2026-10-05", "other", 600, 5)] })[0]!.intensity_pct, null);
});

test("sport mix: duration and TSS per sport, longest first; activities of other weeks are ignored", () => {
  const activities = [act("2026-10-05", "rowing", 1800, 40), act("2026-10-06", "Kajak", 3600, 30), act("2026-10-09", "rowing", 1200, 25), act("2026-10-01", "rowing", 999, 99)];
  const [w] = weekBalances({ from: "2026-10-05", to: "2026-10-11", dailyTss: new Map(), activities });
  assert.deepEqual(w!.sport_mix, [{ sport: "Kajak", duration_s: 3600, tss: 30 }, { sport: "rowing", duration_s: 3000, tss: 65 }]);
});

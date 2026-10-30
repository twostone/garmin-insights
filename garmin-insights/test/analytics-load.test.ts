import { test } from "node:test";
import assert from "node:assert/strict";
import { hrTss, intensityFactor, normalizedPower, pmc, powerTss, rTss, trimp, trimpFromAverage, normalizedSpeed, type Sample } from "../src/analytics/load.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);
const steady = (seconds: number, values: Partial<Sample>): Sample[] => Array.from({ length: seconds }, (_, t) => ({ t, ...values }));

// Banister TRIMP, male: minutes * HRr * 0.64 * e^(1.92 * HRr). 60 min at HRr = 0.8:
//   60 * 0.8 * 0.64 * e^(1.536) = 142.77 (reference computed by hand).
test("TRIMP: one hour at 80 % heart rate reserve = 142.8 (male), lower coefficient for female", () => {
  const s = steady(3600, { hr: 50 + 0.8 * 140 }); // rest 50, max 190 -> HRr 0.8
  close(trimp(s, { hrRest: 50, hrMax: 190 }), 60 * 0.8 * 0.64 * Math.exp(1.92 * 0.8), 0.05);
  close(trimp(s, { hrRest: 50, hrMax: 190, sex: "f" }), 60 * 0.8 * 0.86 * Math.exp(1.67 * 0.8), 0.05);
  close(trimp(s, { hrRest: 50, hrMax: 190 }), 142.77, 0.1);
});

test("TRIMP: below resting HR counts nothing, above max is capped at HRr = 1, pauses (long gaps) are skipped", () => {
  assert.equal(trimp(steady(600, { hr: 45 }), { hrRest: 50, hrMax: 190 }), 0);
  close(trimp(steady(60, { hr: 250 }), { hrRest: 50, hrMax: 190 }), 1 * 0.64 * Math.exp(1.92), 0.01);
  const paused: Sample[] = [{ t: 0, hr: 150 }, { t: 1, hr: 150 }, { t: 3600, hr: 150 }, { t: 3601, hr: 150 }];
  close(trimp(paused, { hrRest: 50, hrMax: 190 }), trimp(steady(2, { hr: 150 }), { hrRest: 50, hrMax: 190 }) * 2, 1e-9);
});

test("TRIMP from an average (no samples) equals the constant-HR value", () => {
  close(trimpFromAverage(3600, 162, { hrRest: 50, hrMax: 190 }), trimp(steady(3600, { hr: 162 }), { hrRest: 50, hrMax: 190 }), 0.2);
});

test("hrTSS: one hour at LTHR = 100, half the intensity is far below half", () => {
  const cfg = { hrRest: 50, hrMax: 190, lthr: 170 };
  close(hrTss(trimp(steady(3600, { hr: 170 }), cfg), cfg), 100, 0.1);
  assert.ok(hrTss(trimp(steady(3600, { hr: 110 }), cfg), cfg) < 25);
  close(hrTss(trimp(steady(1800, { hr: 170 }), cfg), cfg), 50, 0.1);
});

test("normalized power: constant power is itself; blocks weigh more than their average (Coggan, 30 s, 4th power)", () => {
  close(normalizedPower(new Array(600).fill(200)), 200, 1e-9);
  const blocks = [...new Array(120).fill(100), ...new Array(120).fill(300)];
  // independent naive reference
  const roll: number[] = [];
  for (let i = 29; i < blocks.length; i++) roll.push(blocks.slice(i - 29, i + 1).reduce((a, b) => a + b, 0) / 30);
  const ref = Math.pow(roll.reduce((a, b) => a + b ** 4, 0) / roll.length, 0.25);
  close(normalizedPower(blocks), ref, 1e-6);
  assert.ok(normalizedPower(blocks) > 200);
  assert.equal(normalizedPower(new Array(20).fill(250)), 250, "shorter than the window: plain average");
  assert.equal(normalizedPower([]), 0);
});

test("power TSS: one hour at FTP = 100; IF = NP/FTP; 2 h at 75 % FTP = 112.5", () => {
  close(powerTss(3600, 250, 250), 100, 1e-9);
  close(intensityFactor(200, 250), 0.8, 1e-9);
  close(powerTss(7200, 187.5, 250), 2 * 0.75 * 0.75 * 100, 1e-9);
});

test("rTSS: one hour at threshold pace = 100; normalized speed smooths 30 s", () => {
  const thr = 1000 / 300; // 5:00 min/km
  close(rTss(3600, thr, thr), 100, 1e-9);
  close(rTss(1800, thr * 0.9, thr), 0.5 * 0.81 * 100, 1e-9);
  close(normalizedSpeed(new Array(300).fill(3)), 3, 1e-9);
});

// CTL/ATL: exponentially weighted averages with time constants 42 and 7 days.
test("PMC: a constant load of 100/day converges to 100; after 42 days CTL = 100 * (1 - 1/e)", () => {
  const dates = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  const rows = pmc(new Map(dates.map((d) => [d, 100])), { from: dates[0]!, to: dates.at(-1)! });
  close(rows.at(-1)!.ctl, 100 * (1 - Math.exp(-1)), 1e-9);
  close(rows.at(-1)!.atl, 100 * (1 - Math.exp(-6)), 1e-9);
  assert.equal(pmc(new Map(), { from: "2026-01-01", to: "2026-01-01" })[0]!.ctl, 0);
});

test("PMC: rest days decay, TSB is yesterday's CTL minus ATL, seeds continue an earlier series", () => {
  const rows = pmc(new Map([["2026-02-01", 100]]), { from: "2026-02-01", to: "2026-02-03" });
  assert.deepEqual(rows.map((r) => r.date), ["2026-02-01", "2026-02-02", "2026-02-03"]);
  const k42 = 1 - Math.exp(-1 / 42);
  const k7 = 1 - Math.exp(-1 / 7);
  close(rows[0]!.ctl, 100 * k42, 1e-9);
  close(rows[0]!.tsb, 0, 1e-9); // nothing before the first day
  close(rows[1]!.tsb, rows[0]!.ctl - rows[0]!.atl, 1e-9);
  close(rows[1]!.ctl, rows[0]!.ctl * (1 - k42), 1e-9);
  close(rows[2]!.atl, 100 * k7 * (1 - k7) ** 2, 1e-9);
  const seeded = pmc(new Map(), { from: "2026-02-04", to: "2026-02-04", seed: { ctl: 50, atl: 80 } });
  close(seeded[0]!.ctl, 50 * (1 - k42), 1e-9);
  close(seeded[0]!.tsb, 50 - 80, 1e-9);
});

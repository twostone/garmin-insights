import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHr, HR_MAX_TOLERANCE_BPM, MAX_HR_JUMP_BPM_PER_S, SPIKE_MAX_DURATION_S } from "../src/analytics/hr-artifacts.ts";

// One sample per second from t0 on.
const series = (hrs: (number | null)[], t0 = 0) => hrs.map((hr, i) => ({ t: t0 + i, hr }));
const flat = (n: number, hr: number) => Array.from({ length: n }, () => hr);
const ramp = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const hrs = (s: { hr?: number | null }[]) => s.map((x) => x.hr ?? null);

test("constants: the thresholds the reference cases below are built around", () => {
  // A real heart rate rises by a few bpm per second at most (sprint start); the observed spike (rowing, 19.10.) jumps
  // ~80 bpm within one second. 15 bpm/s leaves room for both smart recording and fast real changes.
  assert.equal(MAX_HR_JUMP_BPM_PER_S, 15);
  // Observed spikes last one to three samples; a real effort keeps the heart rate up for far longer than 10 s.
  assert.equal(SPIKE_MAX_DURATION_S, 10);
  // hr_max is an estimate; a real maximum overshoots it by a few beats, the cardio artifact (183 at hr_max 176) by 7.
  assert.equal(HR_MAX_TOLERANCE_BPM, 5);
});

test("single 201 spike in a 120 trace is removed", () => {
  const input = series([...flat(30, 120), 201, ...flat(30, 120)]);
  const r = cleanHr(input, 176);
  assert.equal(r.samples[30]!.hr, null);
  assert.equal(r.samples.filter((s) => s.hr === null).length, 1);
  assert.equal(r.artifactSeconds, 1);
  assert.equal(r.maxHrClean, 120);
  assert.equal(input[30]!.hr, 201, "input is not changed");
  assert.equal(r.samples[30]!.t, 30, "other fields stay");
});

test("spike over three samples is removed, no interpolation", () => {
  const r = cleanHr(series([...flat(20, 125), 190, 198, 185, ...flat(20, 122)]), 190);
  assert.deepEqual(hrs(r.samples.slice(19, 24)), [125, null, null, null, 122]);
  assert.equal(r.artifactSeconds, 3);
  assert.equal(r.maxHrClean, 125);
});

test("real sprint finish: slow rise above hr_max that stays up is kept", () => {
  const trace = [...flat(30, 150), ...ramp(150, 186, 2), ...flat(20, 186)]; // ends while still up
  const r = cleanHr(series(trace), 176);
  assert.deepEqual(hrs(r.samples), trace);
  assert.equal(r.artifactSeconds, 0);
  assert.equal(r.maxHrClean, 186);
});

test("plateau above hr_max for longer than 10 s is kept, a short one is removed", () => {
  const long = [...flat(20, 170), ...ramp(170, 185, 3), ...flat(15, 185), ...ramp(170, 184, 2).reverse(), ...flat(20, 168)];
  assert.equal(cleanHr(series(long), 176).artifactSeconds, 0);
  assert.equal(cleanHr(series(long), 176).maxHrClean, 185);

  // The cardio case (10.10.): 183 at hr_max 176 for a few seconds, reached and left without a jump.
  const short = [...flat(20, 170), 175, 180, 183, 183, 182, 178, ...flat(20, 172)];
  const r = cleanHr(series(short), 176);
  assert.deepEqual(hrs(r.samples.slice(20, 26)), [175, 180, null, null, null, 178]);
  assert.equal(r.artifactSeconds, 3);
  assert.equal(r.maxHrClean, 180);
});

test("drop-out downwards (40 bpm for 2 s) is removed", () => {
  const r = cleanHr(series([...flat(20, 120), 40, 40, ...flat(20, 121)]), 180);
  assert.deepEqual(hrs(r.samples.slice(19, 23)), [120, null, null, 121]);
  assert.equal(r.artifactSeconds, 2);
});

test("without hr_max only the jump rule applies", () => {
  const short = [...flat(20, 170), 175, 180, 183, 183, 182, 178, ...flat(20, 172)];
  assert.equal(cleanHr(series(short), null).artifactSeconds, 0, "no hr_max, nothing to compare with");
  const spike = cleanHr(series([...flat(20, 120), 201, ...flat(20, 120)]), null);
  assert.equal(spike.artifactSeconds, 1);
  assert.equal(spike.maxHrClean, 120);
});

test("a jump that does not come back within 10 s is not an artifact", () => {
  const trace = [...flat(20, 100), ...flat(30, 160)];
  assert.equal(cleanHr(series(trace), 190).artifactSeconds, 0);
});

test("gaps: the rate uses the real time step, and a pause is no jump", () => {
  // Smart recording: one sample every 4 s, +40 bpm between two samples is 10 bpm/s, a real rise.
  const smart = [0, 4, 8, 12, 16, 20].map((t, i) => ({ t, hr: [120, 160, 162, 125, 124, 123][i]! }));
  assert.equal(cleanHr(smart, 190).artifactSeconds, 0);
  // The same 201 spike between 1 s samples inside a 4 s grid is still caught.
  const spiky = [{ t: 0, hr: 120 }, { t: 4, hr: 121 }, { t: 5, hr: 201 }, { t: 9, hr: 120 }];
  assert.equal(cleanHr(spiky, 190).samples[2]!.hr, null);
  // After a pause of a minute the heart rate is on another level; that is no jump.
  const paused = [...series(flat(10, 100)), ...series([150, 150, 101, 100], 70)];
  assert.equal(cleanHr(paused, 190).artifactSeconds, 0);
});

test("missing values stay missing and do not count as artifacts; no heart rate at all gives null", () => {
  const r = cleanHr(series([120, null, 121, 201, 120, null]), 190);
  assert.deepEqual(hrs(r.samples), [120, null, 121, null, 120, null]);
  assert.equal(r.artifactSeconds, 1);
  assert.deepEqual(cleanHr(series([null, null]), 190), { samples: series([null, null]), artifactSeconds: 0, maxHrClean: null });
  assert.deepEqual(cleanHr([], 190), { samples: [], artifactSeconds: 0, maxHrClean: null });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { FitError, parseFit, sessionAt, sliceSession } from "../src/fit/parse.ts";
import { multisportFit, rideFit, runFit, strengthFit } from "./fit-fixtures.ts";

test("run: records become 1 Hz samples with HR, speed, distance and GPS in degrees", () => {
  const fit = parseFit(runFit());
  assert.equal(fit.samples.length, 600);
  const s = fit.samples[300]!;
  assert.equal(s.t, 300);
  assert.equal(s.hr, 150);
  assert.equal(s.speed, 3);
  assert.ok(Math.abs(s.dist! - 903) < 1);
  assert.ok(Math.abs(s.lat! - 48.003) < 1e-4);
  assert.ok(Math.abs(s.lon! - 11.003) < 1e-4);
  assert.equal(fit.session.sport, "running");
});

test("run: laps carry start offset, duration and distance", () => {
  const fit = parseFit(runFit());
  assert.equal(fit.laps.length, 2);
  assert.equal(fit.laps[1]!.start_s, 300);
  assert.equal(fit.laps[1]!.duration_s, 300);
  assert.ok(Math.abs(fit.laps[0]!.distance_m! - 900) < 5);
});

test("ride: power samples and session normalized power", () => {
  const fit = parseFit(rideFit());
  assert.equal(fit.samples[10]!.power, 210);
  assert.equal(fit.samples[10]!.lat, null);
  assert.equal(fit.session.normalizedPower, 230);
  assert.equal(fit.session.sport, "cycling");
});

test("strength: active and rest sets with reps, weight (kg) and exercise category", () => {
  const fit = parseFit(strengthFit());
  assert.equal(fit.sets.length, 5);
  const active = fit.sets.filter((s) => s.set_type === "active");
  assert.deepEqual(active.map((s) => [s.exercise, s.reps, s.weight_kg]), [["bench_press", 10, 60], ["bench_press", 8, 62.5], ["squat", 12, 100]]);
  assert.equal(active[0]!.start_s, 60);
  assert.equal(active[0]!.duration_s, 40);
  assert.equal(fit.sets[1]!.set_type, "rest");
});

test("garbage is a FitError, not a crash", () => {
  assert.throws(() => parseFit(new Uint8Array([1, 2, 3, 4])), FitError);
});

test("multisport: every session is listed, and a leg's part of the file is sliced relative to its start", () => {
  const fit = parseFit(multisportFit());
  assert.deepEqual(fit.sessions, [
    { start_s: 0, duration_s: 300, sport: "rowing", subSport: "indoorRowing", avg_hr: 130, max_hr: 135 },
    { start_s: 300, duration_s: 300, sport: "training", subSport: "hiit", avg_hr: 160, max_hr: 165 },
  ]);
  assert.equal(fit.samples.length, 600, "the parent keeps the whole recording");
  // Garmin's leg start may be a few seconds off the file's session start.
  const hiit = sessionAt(fit.sessions, 303)!;
  assert.equal(hiit.sport, "training");
  assert.equal(sessionAt(fit.sessions, 1000), null, "too far from any session");
  const part = sliceSession(fit, hiit);
  assert.equal(part.samples.length, 300);
  assert.deepEqual([part.samples[0]!.t, part.samples.at(-1)!.t], [0, 299]);
  assert.ok(part.samples.every((s) => s.hr === 160));
  assert.deepEqual(part.laps.map((l) => [l.idx, l.start_s, l.avg_hr]), [[0, 0, 160]]);
});

test("a plain activity has exactly one session", () => {
  assert.equal(parseFit(runFit()).sessions.length, 1);
});

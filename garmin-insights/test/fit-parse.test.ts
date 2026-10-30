import { test } from "node:test";
import assert from "node:assert/strict";
import { FitError, parseFit } from "../src/fit/parse.ts";
import { rideFit, runFit, strengthFit } from "./fit-fixtures.ts";

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

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { downsample } from "../analytics/downsample.ts";
import { legOverview, parentHr } from "../analytics/multisport.ts";
import { activityAnalysis, parseSummary } from "../analytics/queries.ts";
import { analysisSamples } from "../analytics/recompute.ts";
import { strengthVolume } from "../analytics/strength.ts";
import type { FitStore } from "../fit/store.ts";
import type { Repos } from "../repo/index.ts";
import type { Env } from "../types.ts";
import { customSportQuery, dateSchema, errors, idParam, json, sportSchema, userOf } from "./common.ts";

const activitySchema = z.object({
  id: z.number(), start_utc: z.string(), date: z.string(), name: z.string().nullable(), type_key: z.string(), sport: z.string(),
  distance_m: z.number().nullable(), duration_s: z.number().nullable(), moving_s: z.number().nullable(), elevation_gain_m: z.number().nullable(),
  avg_hr: z.number().nullable(), max_hr: z.number().nullable(), avg_power: z.number().nullable(), norm_power: z.number().nullable(),
  avg_speed: z.number().nullable(), max_speed: z.number().nullable(), calories: z.number().nullable(), vo2max: z.number().nullable(),
  te_aerobic: z.number().nullable(), te_anaerobic: z.number().nullable(), start_lat: z.number().nullable(), start_lon: z.number().nullable(),
  total_sets: z.number().nullable(), total_reps: z.number().nullable(),
  fit_status: z.enum(["pending", "done", "none", "failed"]), trimp: z.number().nullable(), tss: z.number().nullable(), tss_method: z.string().nullable(),
  custom_sport_id: z.number().nullable(), custom_sport: z.string().nullable(), group_key: z.string(),
  parent_id: z.number().nullable(), is_multisport_parent: z.number(), max_hr_clean: z.number().nullable(), hr_artifact_s: z.number().nullable(),
});

const sampleSchema = z.object({
  t: z.number(), lat: z.number().nullable(), lon: z.number().nullable(), alt: z.number().nullable(), hr: z.number().nullable(), power: z.number().nullable(),
  cadence: z.number().nullable(), speed: z.number().nullable(), dist: z.number().nullable(), temp: z.number().nullable(),
});
const lapSchema = z.object({
  idx: z.number(), start_s: z.number().nullable(), duration_s: z.number().nullable(), distance_m: z.number().nullable(), avg_hr: z.number().nullable(),
  max_hr: z.number().nullable(), avg_power: z.number().nullable(), avg_speed: z.number().nullable(), avg_cadence: z.number().nullable(), ascent_m: z.number().nullable(),
});
const setSchema = z.object({
  idx: z.number(), start_s: z.number().nullable(), duration_s: z.number().nullable(), set_type: z.enum(["active", "rest"]), exercise: z.string().nullable(),
  reps: z.number().nullable(), weight_kg: z.number().nullable(),
});
const zoneSchema = z.object({ kind: z.enum(["hr", "power", "pace"]), floors: z.array(z.number()), below: z.number(), seconds: z.array(z.number()), source: z.enum(["samples", "garmin_summary"]) }).nullable();
const paddlingSchema = z.object({
  moving_s: z.number(), avg_speed_kmh: z.number(), pace_s_per_500m: z.number(), max_speed_1min_kmh: z.number().nullable(), max_speed_5min_kmh: z.number().nullable(),
  avg_stroke_rate: z.number().nullable(), distance_per_stroke_m: z.number().nullable(), avg_hr: z.number().nullable(), efficiency: z.number().nullable(),
});
const exerciseSchema = z.object({ exercise: z.string(), muscle_group: z.string(), sets: z.number(), reps: z.number(), volume_kg: z.number(), max_weight_kg: z.number().nullable(), best_e1rm_kg: z.number().nullable() });

const legSchema = z.object({
  id: z.number(), sport: z.string(), garmin_type: z.string(), start_offset_s: z.number(), duration_s: z.number().nullable(), avg_hr: z.number().nullable(), tss: z.number().nullable(),
});

const MAX_SAMPLES = 5000;
const DEFAULT_SAMPLES = 1500;

export function activityRoutes(deps: { repos: Repos; fit: FitStore }) {
  const { repos } = deps;
  return new OpenAPIHono<Env>()
    .openapi(
      createRoute({
        method: "get",
        path: "/activities",
        request: {
          query: z.object({
            sport: sportSchema.optional(), ...customSportQuery, from: dateSchema.optional(), to: dateSchema.optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
            order: z.enum(["asc", "desc"]).default("desc"),
          }),
        },
        responses: { 200: json(z.object({ items: z.array(activitySchema), total: z.number() })) },
      }),
      (c) => {
        const q = c.req.valid("query");
        const f = { sport: q.sport as never, customSportId: q.custom_sport_id, from: q.from, to: q.to, topLevel: true };
        const id = userOf(c).id;
        return c.json({ items: repos.activities.list(id, { ...f, limit: q.limit, offset: q.offset, order: q.order }), total: repos.activities.count(id, f) }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/activities/calendar",
        request: { query: z.object({ from: dateSchema, to: dateSchema }) },
        responses: { 200: json(z.array(z.object({ date: z.string(), count: z.number(), duration_s: z.number(), distance_m: z.number(), tss: z.number() }))) },
      }),
      (c) => {
        const { from, to } = c.req.valid("query");
        return c.json(repos.activities.calendar(userOf(c).id, from, to), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/activities/{id}",
        request: { params: idParam },
        responses: { 200: json(z.object({ activity: activitySchema, summary: z.record(z.string(), z.unknown()), legs: z.array(legSchema) })), ...errors(404) },
      }),
      (c) => {
        const user = userOf(c).id;
        const activity = repos.activities.get(user, c.req.valid("param").id);
        if (!activity) return c.json({ error: "not_found" }, 404);
        // Multisport: the legs, and the parent's average and cleaned max HR from them.
        const legs = repos.activities.legs(user, activity.id);
        return c.json({
          activity: parentHr(activity, legs),
          summary: parseSummary(repos.activities.summaryJson(user, activity.id)),
          legs: legOverview(activity, legs),
        }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/activities/{id}/samples",
        request: {
          params: idParam,
          query: z.object({
            from: z.coerce.number().int().min(0).optional(), to: z.coerce.number().int().min(0).optional(),
            max_points: z.coerce.number().int().min(10).max(MAX_SAMPLES).default(DEFAULT_SAMPLES),
            // Heart-rate artifacts are null (a gap in the chart) unless the raw recording is asked for.
            clean_hr: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
          }),
        },
        responses: { 200: json(z.object({ total: z.number(), samples: z.array(sampleSchema) })), ...errors(404) },
      }),
      (c) => {
        const user = userOf(c).id;
        const { id } = c.req.valid("param");
        const q = c.req.valid("query");
        const activity = repos.activities.get(user, id);
        if (!activity) return c.json({ error: "not_found" }, 404);
        const win = { from: q.from, to: q.to };
        const rows = q.clean_hr ? analysisSamples(repos, user, activity, win) : repos.activities.samples(user, id, win);
        return c.json({ total: rows.length, samples: downsample(rows, q.max_points) }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/activities/{id}/laps",
        request: { params: idParam },
        responses: { 200: json(z.array(lapSchema)), ...errors(404) },
      }),
      (c) => {
        const user = userOf(c).id;
        const { id } = c.req.valid("param");
        if (!repos.activities.has(user, id)) return c.json({ error: "not_found" }, 404);
        return c.json(repos.activities.laps(user, id), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/activities/{id}/strength",
        request: { params: idParam },
        responses: { 200: json(z.object({ sets: z.array(setSchema), byExercise: z.array(exerciseSchema), totalVolumeKg: z.number() })), ...errors(404) },
      }),
      (c) => {
        const user = userOf(c).id;
        const { id } = c.req.valid("param");
        if (!repos.activities.has(user, id)) return c.json({ error: "not_found" }, 404);
        const sets = repos.activities.sets(user, id);
        const v = strengthVolume(sets);
        return c.json({ sets, byExercise: v.byExercise, totalVolumeKg: v.totalVolumeKg }, 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/activities/{id}/analysis",
        request: { params: idParam },
        responses: {
          200: json(z.object({
            zones: z.object({ hr: zoneSchema, power: zoneSchema, pace: zoneSchema }),
            decoupling_pct: z.number().nullable(),
            best_efforts: z.array(z.object({ distance: z.number(), seconds: z.number(), startT: z.number() })),
            mean_max_power: z.array(z.object({ seconds: z.number(), watts: z.number() })),
            paddling: paddlingSchema.optional(),
          })),
          ...errors(404),
        },
      }),
      (c) => {
        const user = userOf(c).id;
        const activity = repos.activities.get(user, c.req.valid("param").id);
        if (!activity) return c.json({ error: "not_found" }, 404);
        return c.json(activityAnalysis(repos, user, activity), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/activities/{id}/fit",
        request: { params: idParam },
        responses: { 200: { description: "The original FIT file", content: { "application/octet-stream": { schema: z.any() } } }, ...errors(404) },
      }),
      (c) => {
        const user = userOf(c).id;
        const { id } = c.req.valid("param");
        const bytes = deps.fit.read(user, id);
        if (!bytes || !repos.activities.has(user, id)) return c.json({ error: "not_found" }, 404);
        return c.body(bytes as unknown as ArrayBuffer, 200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="activity-${id}.fit"`,
        });
      },
    );
}

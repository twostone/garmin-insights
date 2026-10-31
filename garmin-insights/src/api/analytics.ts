import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { bestEffortsInRange, defaultRange, rangeDays, readinessOn, strengthInRange, trendsInRange, volumeInRange, weeklyBalance, zoneDistribution } from "../analytics/queries.ts";
import type { Repos } from "../repo/index.ts";
import type { Env } from "../types.ts";
import { todayLocal } from "../dates.ts";
import { customSportQuery, dateSchema, errors, json, MAX_RANGE_DAYS, rangeQuery, sportSchema, userOf } from "./common.ts";

const DEFAULT_PMC_DAYS = 180;
const DEFAULT_RANGE_DAYS = 90;

const readinessStatus = z.enum(["good", "watch", "poor", "unknown"]);
const trendMetric = z.object({ avg7: z.number().nullable(), baseline28: z.number().nullable(), deltaVsBaseline: z.number().nullable() });

export function analyticsRoutes(deps: { repos: Repos; today?: () => string }) {
  const { repos } = deps;
  const tooLong = (r: { from: string; to: string }) => rangeDays(r) > MAX_RANGE_DAYS || rangeDays(r) < 1;
  return new OpenAPIHono<Env>()
    .openapi(
      createRoute({
        method: "get",
        path: "/analytics/pmc",
        request: { query: rangeQuery },
        responses: { 200: json(z.array(z.object({ date: z.string(), trimp: z.number(), tss: z.number(), ctl: z.number(), atl: z.number(), tsb: z.number() }))), ...errors(400) },
      }),
      (c) => {
        const q = c.req.valid("query");
        const r = defaultRange(q.from, q.to, DEFAULT_PMC_DAYS);
        if (tooLong(r)) return c.json({ error: "bad_range" }, 400);
        return c.json(repos.analytics.range(userOf(c).id, r.from, r.to), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/analytics/zones",
        request: { query: rangeQuery.extend({ kind: z.enum(["hr", "power", "pace"]).default("hr"), sport: sportSchema.optional(), ...customSportQuery }) },
        responses: {
          200: json(z.object({ kind: z.enum(["hr", "power", "pace"]), activities: z.number(), floors: z.array(z.number()), below: z.number(), seconds: z.array(z.number()), source: z.enum(["samples", "garmin_summary"]) })),
          ...errors(400),
        },
      }),
      (c) => {
        const q = c.req.valid("query");
        const r = defaultRange(q.from, q.to, DEFAULT_RANGE_DAYS);
        if (tooLong(r)) return c.json({ error: "bad_range" }, 400);
        return c.json(zoneDistribution(repos, userOf(c).id, { ...r, kind: q.kind, sport: q.sport as never, customSportId: q.custom_sport_id }), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/analytics/volume",
        request: { query: rangeQuery.extend({ by: z.enum(["week", "month"]).default("week"), sport: sportSchema.optional(), ...customSportQuery }) },
        responses: {
          200: json(z.array(z.object({ period: z.string(), sport: z.string(), count: z.number(), distance_m: z.number(), duration_s: z.number(), elevation_gain_m: z.number(), tss: z.number(), trimp: z.number() }))),
          ...errors(400),
        },
      }),
      (c) => {
        const q = c.req.valid("query");
        const r = defaultRange(q.from, q.to, DEFAULT_PMC_DAYS);
        if (tooLong(r)) return c.json({ error: "bad_range" }, 400);
        return c.json(volumeInRange(repos, userOf(c).id, { ...r, by: q.by, sport: q.sport as never, customSportId: q.custom_sport_id }), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/analytics/weekly",
        request: { query: rangeQuery.extend({ sport: sportSchema.optional(), ...customSportQuery }) },
        responses: {
          200: json(z.array(z.object({
            week: z.string(), load: z.number(), acwr: z.number().nullable(), monotony: z.number().nullable(), strain: z.number().nullable(),
            intensity_pct: z.object({ easy: z.number(), moderate: z.number(), hard: z.number() }).nullable(),
            sport_mix: z.array(z.object({ sport: z.string(), duration_s: z.number(), tss: z.number() })),
          }))),
          ...errors(400),
        },
      }),
      (c) => {
        const q = c.req.valid("query");
        const r = defaultRange(q.from, q.to, DEFAULT_RANGE_DAYS);
        if (tooLong(r)) return c.json({ error: "bad_range" }, 400);
        return c.json(weeklyBalance(repos, userOf(c).id, { ...r, sport: q.sport as never, customSportId: q.custom_sport_id }), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/analytics/trends",
        request: { query: rangeQuery },
        responses: {
          200: json(z.object({
            points: z.array(z.object({ date: z.string(), restingHr: z.number().nullable(), restingHr7: z.number().nullable(), hrv: z.number().nullable(), hrv7: z.number().nullable(), sleepHours: z.number().nullable(), sleep7: z.number().nullable(), atl: z.number().nullable() })),
            latest: z.object({ restingHr: trendMetric, hrv: trendMetric, sleepHours: trendMetric }),
            correlations: z.object({ restingHrVsAtl: z.number().nullable(), hrvVsAtl: z.number().nullable(), sleepVsAtl: z.number().nullable() }),
          })),
          ...errors(400),
        },
      }),
      (c) => {
        const q = c.req.valid("query");
        const r = defaultRange(q.from, q.to, DEFAULT_RANGE_DAYS);
        if (tooLong(r)) return c.json({ error: "bad_range" }, 400);
        return c.json(trendsInRange(repos, userOf(c).id, r), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/analytics/best-efforts",
        request: { query: rangeQuery.extend({ sport: z.enum(["running", "cycling"]).default("running"), ...customSportQuery }) },
        responses: {
          200: json(z.object({
            sport: z.enum(["running", "cycling"]),
            efforts: z.array(z.object({ distance_m: z.number(), seconds: z.number(), activity_id: z.number(), date: z.string() })),
            power_curve: z.array(z.object({ seconds: z.number(), watts: z.number(), activity_id: z.number(), date: z.string() })),
          })),
          ...errors(400),
        },
      }),
      (c) => {
        const q = c.req.valid("query");
        const r = defaultRange(q.from, q.to, 365);
        if (tooLong(r)) return c.json({ error: "bad_range" }, 400);
        return c.json(bestEffortsInRange(repos, userOf(c).id, { ...r, sport: q.sport, customSportId: q.custom_sport_id }), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/analytics/strength",
        request: { query: rangeQuery },
        responses: {
          200: json(z.object({
            byExercise: z.array(z.object({ exercise: z.string(), muscle_group: z.string(), sets: z.number(), reps: z.number(), volume_kg: z.number(), max_weight_kg: z.number().nullable(), best_e1rm_kg: z.number().nullable() })),
            byMuscleGroup: z.array(z.object({ group: z.string(), sets: z.number(), volume_kg: z.number() })),
            weekly: z.array(z.object({ week: z.string(), sets: z.number(), volume_kg: z.number() })),
            totalVolumeKg: z.number(), totalSets: z.number(),
          })),
          ...errors(400),
        },
      }),
      (c) => {
        const q = c.req.valid("query");
        const r = defaultRange(q.from, q.to, DEFAULT_RANGE_DAYS);
        if (tooLong(r)) return c.json({ error: "bad_range" }, 400);
        return c.json(strengthInRange(repos, userOf(c).id, r), 200);
      },
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/analytics/readiness",
        request: { query: z.object({ date: dateSchema.optional() }) },
        responses: {
          200: json(z.object({
            date: z.string(), status: readinessStatus,
            components: z.array(z.object({ key: z.enum(["hrv", "resting_hr", "sleep", "body_battery", "tsb"]), value: z.number().nullable(), reference: z.number().nullable(), status: readinessStatus, reason: z.string() })),
          })),
        },
      }),
      (c) => c.json(readinessOn(repos, userOf(c).id, c.req.valid("query").date ?? (deps.today ?? todayLocal)()), 200),
    );
}

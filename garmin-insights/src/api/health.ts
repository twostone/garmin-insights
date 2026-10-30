import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { defaultRange, rangeDays } from "../analytics/queries.ts";
import type { Repos } from "../repo/index.ts";
import type { Env } from "../types.ts";
import { errors, json, MAX_RANGE_DAYS, rangeQuery, userOf } from "./common.ts";

const nullableInt = z.number().nullable();
const dailySchema = z.object({ date: z.string(), steps: nullableInt, resting_hr: nullableInt, min_hr: nullableInt, max_hr: nullableInt, stress_avg: nullableInt, body_battery_high: nullableInt, body_battery_low: nullableInt, active_minutes: nullableInt });
const sleepSchema = z.object({ date: z.string(), sleep_s: nullableInt, deep_s: nullableInt, light_s: nullableInt, rem_s: nullableInt, awake_s: nullableInt, score: nullableInt, avg_spo2: nullableInt, avg_respiration: nullableInt, avg_stress: nullableInt, avg_hr: nullableInt });
const hrvSchema = z.object({ date: z.string(), last_night_avg: nullableInt, weekly_avg: nullableInt, last_night_5min_high: nullableInt, baseline_low: nullableInt, baseline_high: nullableInt, status: z.string().nullable() });

const DEFAULT_DAYS = 90;

export function healthRoutes(deps: { repos: Repos }) {
  const { repos } = deps;
  const range = (q: { from?: string; to?: string }) => {
    const r = defaultRange(q.from, q.to, DEFAULT_DAYS);
    return rangeDays(r) >= 1 && rangeDays(r) <= MAX_RANGE_DAYS ? r : null;
  };
  return new OpenAPIHono<Env>()
    .openapi(createRoute({ method: "get", path: "/health/daily", request: { query: rangeQuery }, responses: { 200: json(z.array(dailySchema)), ...errors(400) } }), (c) => {
      const r = range(c.req.valid("query"));
      return r ? c.json(repos.health.dailies.range(userOf(c).id, r.from, r.to), 200) : c.json({ error: "bad_range" }, 400);
    })
    .openapi(createRoute({ method: "get", path: "/health/sleep", request: { query: rangeQuery }, responses: { 200: json(z.array(sleepSchema)), ...errors(400) } }), (c) => {
      const r = range(c.req.valid("query"));
      return r ? c.json(repos.health.sleep.range(userOf(c).id, r.from, r.to), 200) : c.json({ error: "bad_range" }, 400);
    })
    .openapi(createRoute({ method: "get", path: "/health/hrv", request: { query: rangeQuery }, responses: { 200: json(z.array(hrvSchema)), ...errors(400) } }), (c) => {
      const r = range(c.req.valid("query"));
      return r ? c.json(repos.health.hrv.range(userOf(c).id, r.from, r.to), 200) : c.json({ error: "bad_range" }, 400);
    });
}

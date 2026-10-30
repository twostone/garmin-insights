import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { zoneFloors } from "../analytics/queries.ts";
import { recomputeLoads } from "../analytics/recompute.ts";
import { todayLocal } from "../dates.ts";
import type { FitStore } from "../fit/store.ts";
import type { Repos } from "../repo/index.ts";
import type { AthleteSettings } from "../repo/athlete.ts";
import type { Env } from "../types.ts";
import { dateSchema, errors, json, userOf } from "./common.ts";

const zonesSchema = z.object({ hr: z.array(z.number().positive()).length(5).optional(), pace: z.array(z.number().positive()).length(5).optional(), power: z.array(z.number().nonnegative()).length(7).optional() });
const athleteSchema = z.object({
  valid_from: z.string(),
  hr_max: z.number().nullable(), hr_rest: z.number().nullable(), lthr: z.number().nullable(), ftp: z.number().nullable(),
  threshold_pace_s_per_km: z.number().nullable(), sex: z.enum(["m", "f"]).nullable(), zones: zonesSchema.nullable(), source: z.enum(["garmin", "manual"]),
});
const settingsSchema = z.object({
  language: z.enum(["de", "en"]).nullable(),
  athlete: z.object({
    current: athleteSchema.nullable(),
    history: z.array(athleteSchema),
    effectiveZones: z.object({ hr: z.array(z.number()).nullable(), pace: z.array(z.number()).nullable(), power: z.array(z.number()).nullable() }),
  }),
});
const athleteInput = z.object({
  valid_from: dateSchema.optional(),
  hr_max: z.number().int().min(100).max(250).nullable(),
  hr_rest: z.number().int().min(25).max(120).nullable(),
  lthr: z.number().int().min(80).max(230).nullable(),
  ftp: z.number().int().min(50).max(700).nullable(),
  threshold_pace_s_per_km: z.number().min(120).max(900).nullable(),
  sex: z.enum(["m", "f"]).nullable(),
  zones: zonesSchema.nullable().optional(),
});

const view = (s: AthleteSettings) => ({ ...s, zones: s.zones_json ? (JSON.parse(s.zones_json) as z.infer<typeof zonesSchema>) : null });

export function settingsRoutes(deps: { repos: Repos; fit: FitStore }) {
  const { repos } = deps;
  const snapshot = (userId: string) => {
    const today = todayLocal();
    const current = repos.athlete.at(userId, today);
    return {
      language: repos.users.get(userId)?.language ?? null,
      athlete: {
        current: current ? view(current) : null,
        history: repos.athlete.history(userId).map(view),
        effectiveZones: { hr: zoneFloors(current, "hr"), pace: zoneFloors(current, "pace"), power: zoneFloors(current, "power") },
      },
    };
  };
  return new OpenAPIHono<Env>()
    .openapi(createRoute({ method: "get", path: "/settings", responses: { 200: json(settingsSchema) } }), (c) => c.json(snapshot(userOf(c).id), 200))
    .openapi(
      createRoute({
        method: "put",
        path: "/settings/language",
        request: { body: { content: { "application/json": { schema: z.object({ language: z.enum(["de", "en"]).nullable() }) } }, required: true } },
        responses: { 200: json(settingsSchema) },
      }),
      (c) => {
        const id = userOf(c).id;
        repos.users.setLanguage(id, c.req.valid("json").language);
        return c.json(snapshot(id), 200);
      },
    )
    .openapi(
      createRoute({
        method: "put",
        path: "/settings/athlete",
        request: { body: { content: { "application/json": { schema: athleteInput } }, required: true } },
        responses: { 200: json(settingsSchema), ...errors(400) },
      }),
      (c) => {
        const id = userOf(c).id;
        const b = c.req.valid("json");
        if (b.hr_max !== null && b.hr_rest !== null && b.hr_max <= b.hr_rest) return c.json({ error: "hr_max_below_rest" }, 400);
        const validFrom = b.valid_from ?? todayLocal();
        repos.athlete.upsert(id, {
          valid_from: validFrom, hr_max: b.hr_max, hr_rest: b.hr_rest, lthr: b.lthr, ftp: b.ftp, threshold_pace_s_per_km: b.threshold_pace_s_per_km,
          sex: b.sex, zones_json: b.zones ? JSON.stringify(b.zones) : null, source: "manual",
        });
        // Loads from this date on change with the new thresholds.
        recomputeLoads(repos, id, validFrom);
        return c.json(snapshot(id), 200);
      },
    )
    .openapi(
      createRoute({
        method: "delete",
        path: "/settings/athlete/{valid_from}",
        request: { params: z.object({ valid_from: dateSchema }) },
        responses: { 204: { description: "Version removed" }, ...errors(404) },
      }),
      (c) => {
        const id = userOf(c).id;
        const { valid_from } = c.req.valid("param");
        if (!repos.athlete.history(id).some((s) => s.valid_from === valid_from)) return c.json({ error: "not_found" }, 404);
        repos.athlete.delete(id, valid_from);
        recomputeLoads(repos, id, valid_from);
        return c.body(null, 204);
      },
    )
    .openapi(
      createRoute({
        method: "delete",
        path: "/data",
        // A deliberate second step: the UI asks for confirmation, and the API asks for it in the body as well.
        request: { body: { content: { "application/json": { schema: z.object({ confirm: z.literal("delete-all-data") }) } }, required: true } },
        responses: { 204: { description: "All synced data and FIT files removed (key and account stay)" } },
      }),
      (c) => {
        const id = userOf(c).id;
        repos.deleteAllData(id);
        deps.fit.deleteUser(id);
        return c.body(null, 204);
      },
    );
}

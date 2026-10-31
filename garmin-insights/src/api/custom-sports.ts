import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { recomputeLoads } from "../analytics/recompute.ts";
import type { Repos } from "../repo/index.ts";
import type { Env } from "../types.ts";
import { errors, idParam, json, userOf } from "./common.ts";

const customSportSchema = z.object({ id: z.number(), name: z.string(), type_keys: z.array(z.string()), activity_count: z.number() });
const listSchema = z.object({ items: z.array(customSportSchema), garmin_types: z.array(z.object({ type_key: z.string(), sport: z.string() })) });
const nameSchema = z.string().trim().min(1).max(100);
const typeKeysSchema = z.array(z.string().min(1).max(100)).max(50);

// The user's own sports, and the manual assignment of an activity to one. How an activity is computed still follows its
// Garmin type; a custom sport only changes how activities are filtered and grouped.
export function customSportRoutes(deps: { repos: Repos }) {
  const { repos } = deps;
  const snapshot = (userId: string) => ({ items: repos.customSports.listDetailed(userId), garmin_types: repos.customSports.garminTypes(userId) });
  const exists = (userId: string, id: number) => repos.customSports.list(userId).some((s) => s.id === id);
  const nameTaken = (userId: string, name: string, exceptId?: number) => {
    const id = repos.customSports.idByName(userId, name);
    return id !== undefined && id !== exceptId;
  };
  return new OpenAPIHono<Env>()
    .openapi(createRoute({ method: "get", path: "/custom-sports", responses: { 200: json(listSchema) } }), (c) => c.json(snapshot(userOf(c).id), 200))
    .openapi(
      createRoute({
        method: "post",
        path: "/custom-sports",
        request: { body: { content: { "application/json": { schema: z.object({ name: nameSchema, type_keys: typeKeysSchema.default([]) }) } }, required: true } },
        responses: { 201: json(listSchema), ...errors(409) },
      }),
      (c) => {
        const user = userOf(c).id;
        const b = c.req.valid("json");
        if (nameTaken(user, b.name)) return c.json({ error: "name_taken" }, 409);
        repos.customSports.create(user, b.name, b.type_keys);
        return c.json(snapshot(user), 201);
      },
    )
    .openapi(
      createRoute({
        method: "patch",
        path: "/custom-sports/{id}",
        request: {
          params: idParam,
          body: { content: { "application/json": { schema: z.object({ name: nameSchema.optional(), type_keys: typeKeysSchema.optional() }) } }, required: true },
        },
        responses: { 200: json(listSchema), ...errors(404, 409) },
      }),
      (c) => {
        const user = userOf(c).id;
        const { id } = c.req.valid("param");
        const b = c.req.valid("json");
        if (!exists(user, id)) return c.json({ error: "not_found" }, 404);
        if (b.name !== undefined && nameTaken(user, b.name, id)) return c.json({ error: "name_taken" }, 409);
        if (b.name !== undefined) repos.customSports.rename(user, id, b.name);
        if (b.type_keys !== undefined) repos.customSports.setTypes(user, id, b.type_keys);
        return c.json(snapshot(user), 200);
      },
    )
    .openapi(
      createRoute({
        method: "delete",
        path: "/custom-sports/{id}",
        request: { params: idParam },
        responses: { 204: { description: "Removed; its activities fall back to their Garmin sport" }, ...errors(404) },
      }),
      (c) => {
        const user = userOf(c).id;
        const { id } = c.req.valid("param");
        if (!repos.customSports.delete(user, id)) return c.json({ error: "not_found" }, 404);
        return c.body(null, 204);
      },
    )
    .openapi(
      createRoute({
        method: "patch",
        path: "/activities/{id}",
        request: { params: idParam, body: { content: { "application/json": { schema: z.object({ custom_sport_id: z.number().int().positive().nullable() }) } }, required: true } },
        responses: { 200: json(z.object({ id: z.number(), custom_sport_id: z.number().nullable() })), ...errors(404, 422) },
      }),
      (c) => {
        const user = userOf(c).id;
        const { id } = c.req.valid("param");
        const { custom_sport_id } = c.req.valid("json");
        const activity = repos.activities.get(user, id);
        if (!activity) return c.json({ error: "not_found" }, 404);
        if (custom_sport_id !== null) {
          if (!exists(user, custom_sport_id)) return c.json({ error: "not_found" }, 404);
          const types = repos.customSports.typesOf(user, custom_sport_id);
          if (types.length > 0 && !types.includes(activity.type_key)) return c.json({ error: "type_mismatch" }, 422);
        }
        repos.customSports.assign(user, id, custom_sport_id);
        // Loads follow the Garmin type, so this is cheap insurance rather than a necessity; the spec asks for it.
        recomputeLoads(repos, user, activity.date);
        return c.json({ id, custom_sport_id }, 200);
      },
    );
}

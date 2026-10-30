import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { GarminApiError, GarminKeyError } from "../garmin/client.ts";
import { KeyInputError, type KeyService } from "../garmin/keys.ts";
import type { Repos } from "../repo/index.ts";
import type { SyncWorker } from "../sync/worker.ts";
import type { Env } from "../types.ts";
import { dateSchema, errors, json, userOf } from "./common.ts";

export const keySchema = z.object({
  configured: z.boolean(),
  status: z.enum(["ok", "invalid", "expired"]).nullable(),
  expiresOn: z.string().nullable(),
  daysLeft: z.number().nullable(),
});

const kindSchema = z.object({
  kind: z.string(), cursor: z.string().nullable(), backfillDone: z.boolean(), items: z.number(), lastSyncAt: z.string().nullable(), lastError: z.string().nullable(),
});
const syncSchema = z.object({
  running: z.boolean(), phase: z.string().nullable(), startedAt: z.string().nullable(), finishedAt: z.string().nullable(), error: z.string().nullable(),
  kinds: z.array(kindSchema),
  fit: z.object({ done: z.number(), pending: z.number() }),
  key: keySchema,
});

export function garminRoutes(deps: { repos: Repos; keys: KeyService; sync: SyncWorker }) {
  return new OpenAPIHono<Env>()
    .openapi(createRoute({ method: "get", path: "/garmin/key", responses: { 200: json(keySchema) } }), (c) => c.json(deps.keys.status(userOf(c).id), 200))
    .openapi(
      createRoute({
        method: "put",
        path: "/garmin/key",
        request: { body: { content: { "application/json": { schema: z.object({ key: z.string().min(1).max(512), expires_on: dateSchema.nullable().optional() }) } }, required: true } },
        responses: { 200: json(keySchema), ...errors(400, 422, 502) },
      }),
      async (c) => {
        const { key, expires_on } = c.req.valid("json");
        const user = userOf(c);
        try {
          const status = await deps.keys.put(user.id, key, expires_on ?? null);
          void deps.sync.trigger(user.id); // first sync right away; the backfill starts here
          return c.json(status, 200);
        } catch (e) {
          if (e instanceof KeyInputError) return c.json({ error: "invalid_input" }, 400);
          if (e instanceof GarminKeyError) return c.json({ error: "key_rejected" }, 422);
          if (e instanceof GarminApiError) return c.json({ error: "garmin_unavailable" }, 502);
          throw e;
        }
      },
    )
    .openapi(createRoute({ method: "delete", path: "/garmin/key", responses: { 204: { description: "Key removed; sync stops, data stays" } } }), (c) => {
      deps.keys.remove(userOf(c).id);
      return c.body(null, 204);
    })
    .openapi(createRoute({ method: "get", path: "/sync", responses: { 200: json(syncSchema) } }), (c) => {
      const id = userOf(c).id;
      return c.json({ ...deps.sync.progress(id), key: deps.keys.status(id) }, 200);
    })
    .openapi(
      createRoute({ method: "post", path: "/sync", responses: { 202: json(z.object({ started: z.boolean() }), "Sync started or already running"), ...errors(409) } }),
      (c) => {
        const id = userOf(c).id;
        if (deps.keys.status(id).status !== "ok") return c.json({ error: "no_key" }, 409);
        const wasRunning = deps.sync.isRunning(id);
        void deps.sync.trigger(id);
        return c.json({ started: !wasRunning }, 202);
      },
    );
}

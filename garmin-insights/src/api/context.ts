import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { APP_VERSION } from "../server-info.ts";
import type { Env } from "../types.ts";

const contextSchema = z.object({
  mode: z.enum(["ingress", "external"]),
  basePath: z.string(),
  haUrl: z.string().nullable(),
  clientId: z.string().nullable(),
  version: z.string().nullable(),
});

const userSchema = z.object({ id: z.string(), name: z.string().nullable() });

// `context` is public in external mode (the SPA needs it before it has a token); `me` needs a user.
export const contextRoutes = new OpenAPIHono<Env>()
  .openapi(
    createRoute({
      method: "get",
      path: "/context",
      responses: { 200: { content: { "application/json": { schema: contextSchema } }, description: "UI context" } },
    }),
    (c) => c.json({ ...c.get("appContext"), version: APP_VERSION ?? null }, 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/me",
      responses: { 200: { content: { "application/json": { schema: z.object({ user: userSchema.nullable() }) } }, description: "Current user" } },
    }),
    (c) => c.json({ user: c.get("user") }, 200),
  );

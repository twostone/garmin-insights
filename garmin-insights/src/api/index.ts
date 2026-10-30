import { OpenAPIHono } from "@hono/zod-openapi";
import type { Repos } from "../repo/index.ts";
import type { Env } from "../types.ts";
import { contextRoutes } from "./context.ts";

export type ApiDeps = { repos: Repos };

// The shared application behind both listeners. It trusts `c.var.user` and `c.var.access` only; the listeners set them.
// Mounted at /api by the listeners, so the browser calls relative `api/...` URLs.
export function createApi(deps: ApiDeps) {
  return new OpenAPIHono<Env>()
    .route("/", contextRoutes)
    .use("*", async (c, next) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthenticated" }, 401);
      deps.repos.users.upsert(user);
      await next();
    });
}
export type AppType = ReturnType<typeof createApi>;

import { OpenAPIHono } from "@hono/zod-openapi";
import type { FitStore } from "../fit/store.ts";
import type { KeyService } from "../garmin/keys.ts";
import type { Repos } from "../repo/index.ts";
import type { SyncWorker } from "../sync/worker.ts";
import type { Env } from "../types.ts";
import { activityRoutes } from "./activities.ts";
import { analyticsRoutes } from "./analytics.ts";
import { contextRoutes } from "./context.ts";
import { garminRoutes } from "./garmin.ts";
import { healthRoutes } from "./health.ts";
import { settingsRoutes } from "./settings.ts";

export type ApiDeps = { repos: Repos; keys: KeyService; sync: SyncWorker; fit: FitStore };

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
    })
    .route("/", garminRoutes(deps))
    .route("/", activityRoutes(deps))
    .route("/", analyticsRoutes(deps))
    .route("/", healthRoutes(deps))
    .route("/", settingsRoutes(deps));
}
export type AppType = ReturnType<typeof createApi>;

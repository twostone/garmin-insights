import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { ingressContext } from "../auth/context.ts";
import { logger } from "../log.ts";
import type { Env } from "../types.ts";
import { requestLog, staticFrontend } from "./shared.ts";

const log = logger("ingress");

// Header names the Supervisor's ingress proxy sets (Supervisor PR #4152). Trustworthy only because of the IP guard below.
const USER_ID = "X-Remote-User-Id";
const USER_NAME = "X-Remote-User-Name";
const USER_DISPLAY_NAME = "X-Remote-User-Display-Name";
const INGRESS_PATH = "X-Ingress-Path";

export type IngressOptions = {
  /** The only address allowed to connect (Supervisor's ingress proxy, 172.30.32.2). Empty/undefined disables the guard: dev and tests only. */
  allowedIp: string | undefined;
  api: Hono<Env>;
  staticRoot: string;
  /** Development only: user for requests without X-Remote-User-Id. Honoured only while the IP guard is off. */
  devUserId?: string;
};

// Port 8099, the `ingress_port`. Not published by the app: only Home Assistant's ingress proxy reaches it, and the
// guard enforces that again. This is the one place that reads X-Remote-User-* and X-Ingress-Path.
export function createIngressApp(opts: IngressOptions) {
  const app = new Hono<Env>();
  app.use("*", requestLog("ingress"));
  // Without the guard (dev, tests) a missing header may fall back to a fixed user; with the guard it never does.
  const devUser = !opts.allowedIp && opts.devUserId ? { id: opts.devUserId, name: null } : null;

  if (opts.allowedIp) {
    const allowed = opts.allowedIp;
    app.use("*", async (c, next) => {
      let addr: string | undefined;
      try {
        addr = getConnInfo(c).remote.address?.replace(/^::ffff:/, "");
      } catch {
        // no connection info available -> fail closed
      }
      if (addr !== allowed) return c.text("Forbidden", 403);
      await next();
    });
  } else {
    log.warn("guard_disabled");
  }

  app.use("*", async (c, next) => {
    c.set("access", "ingress");
    c.set("appContext", ingressContext(c.req.header(INGRESS_PATH)));
    const id = c.req.header(USER_ID);
    // The display name is what people recognise; the login name is the fallback. Never logged.
    c.set("user", id ? { id, name: c.req.header(USER_DISPLAY_NAME) || c.req.header(USER_NAME) || null } : devUser);
    await next();
  });

  app.route("/api", opts.api);
  app.route("/", staticFrontend({ root: opts.staticRoot }));
  return app;
}

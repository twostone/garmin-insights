import { OAuthError, OAuthErrorCode, requireBearerAuth, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { Hono, type Context } from "hono";
import { externalContext } from "../auth/context.ts";
import { HaUnavailableError, type HaTokenVerifier } from "../auth/ha-token.ts";
import { metadataUrl, resourceMetadata } from "../auth/resource-metadata.ts";
import { logger } from "../log.ts";
import type { AppUser, Env } from "../types.ts";
import { requestLog, staticFrontend } from "./shared.ts";

const log = logger("external");

// Port 8100, mapped to the outside (behind a TLS reverse proxy). Identity comes from a Home Assistant access token
// only. X-Remote-User-* and X-Ingress-Path are never read here, so forging them has no effect.
export type ExternalOptions = {
  haUrl: string;
  appUrl: string;
  verifier: HaTokenVerifier;
  api: Hono<Env>;
  /** Handles /mcp for an authenticated request. Absent -> /mcp is 404. */
  mcp?: (request: Request, authInfo: AuthInfo) => Promise<Response>;
  staticRoot: string;
};

export function bearerGate(verifier: HaTokenVerifier, appUrl: string) {
  const oauthVerifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      let verified;
      try {
        verified = await verifier(token);
      } catch (e) {
        if (e instanceof HaUnavailableError) throw new OAuthError(OAuthErrorCode.ServerError, "authorization server unavailable");
        throw e;
      }
      if (!verified) throw new OAuthError(OAuthErrorCode.InvalidToken, "invalid token");
      return { token, clientId: "home-assistant", scopes: [], expiresAt: verified.expiresAt, extra: { user: verified.user } };
    },
  };
  return requireBearerAuth({ verifier: oauthVerifier, resourceMetadataUrl: metadataUrl(appUrl) });
}

export function createExternalApp(opts: ExternalOptions) {
  const app = new Hono<Env>();
  const gate = bearerGate(opts.verifier, opts.appUrl);
  app.use("*", requestLog("external"));
  app.use("*", async (c, next) => {
    c.set("access", "external");
    c.set("appContext", externalContext(opts.haUrl, opts.appUrl));
    c.set("user", null);
    await next();
  });

  app.route("/", resourceMetadata(opts.appUrl, opts.haUrl));

  // Bearer token for the API and MCP. `api/context` stays public: the SPA reads it before it can sign in.
  const authenticated = async (c: Context<Env>) => {
    const result = await gate(c.req.raw);
    if (result instanceof Response) return { response: result } as const;
    const user = result.extra?.user as AppUser;
    c.set("user", user);
    return { authInfo: result } as const;
  };
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/context") return next();
    const r = await authenticated(c as unknown as Context<Env>);
    if ("response" in r) return r.response;
    await next();
  });

  if (opts.mcp) {
    const mcp = opts.mcp;
    app.all("/mcp", async (c) => {
      const r = await authenticated(c as unknown as Context<Env>);
      if ("response" in r) return r.response;
      try {
        return await mcp(c.req.raw, r.authInfo);
      } catch (err) {
        log.error("mcp_failed", { err });
        return c.json({ error: "internal error" }, 500);
      }
    });
  }

  app.route("/api", opts.api);
  app.route("/", staticFrontend({ root: opts.staticRoot }));
  return app;
}

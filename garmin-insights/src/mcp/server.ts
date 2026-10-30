import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { logger } from "../log.ts";
import { APP_VERSION } from "../server-info.ts";
import type { AppUser } from "../types.ts";
import { registerPrompts } from "./prompts.ts";
import { registerTools, type McpDeps } from "./tools.ts";

const log = logger("mcp");

const INSTRUCTIONS =
  "Training and health data of the signed-in Home Assistant user, mirrored from Garmin Connect. Distances in km or m, durations in seconds or minutes, " +
  "speed in m/s or km/h, pace in min/km, weights in kg. Dates are the athlete's local calendar days (YYYY-MM-DD). Load numbers: training stress (TSS-like), " +
  "CTL fitness, ATL fatigue, TSB form. All tools only read data, except trigger_sync, which asks Garmin for new data.";

/** One server instance per request or connection, bound to one user. The user can never be changed by tool arguments. */
export function buildMcpServer(deps: McpDeps, user: AppUser): McpServer {
  const server = new McpServer({ name: "garmin-insights", version: APP_VERSION ?? "0.0.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, deps, user);
  registerPrompts(server, deps.today);
  return server;
}

// Streamable HTTP, stateless: every request builds its own server for the user in the verified token (`authInfo`, set by the
// external listener after the Home Assistant token check). Nothing is kept between requests.
export function createMcpEndpoint(deps: McpDeps) {
  const handler = createMcpHandler(
    (ctx) => {
      const user = ctx.authInfo?.extra?.user as AppUser | undefined;
      if (!user) throw new Error("MCP request without an authenticated user"); // the listener never lets that through
      return buildMcpServer(deps, user);
    },
    { onerror: (err) => log.warn("handler_error", { err }) },
  );
  return (request: Request, authInfo: AuthInfo): Promise<Response> => handler.fetch(request, { authInfo });
}

import { serve } from "@hono/node-server";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { recomputeUncleanedHr } from "./analytics/recompute.ts";
import { createApi } from "./api/index.ts";
import { createHaTokenVerifier, DEFAULT_HA_WS_URL } from "./auth/ha-token.ts";
import { openDb } from "./db.ts";
import { createExternalApp } from "./listeners/external.ts";
import { createIngressApp } from "./listeners/ingress.ts";
import { logger, resolveLogLevel, setLogLevel } from "./log.ts";
import { externalEnabled, parseSettings, readAddonOptions } from "./options.ts";
import { loadOrCreateMasterKey } from "./crypto.ts";
import { createMcpEndpoint } from "./mcp/server.ts";
import { createServices } from "./services.ts";
import { APP_VERSION } from "./server-info.ts";

// Options come from /data/options.json (Supervisor); environment variables override them for development and the smoke test.
const log = logger("server");
const options = readAddonOptions(process.env.OPTIONS_PATH ?? "/data/options.json");
const { level: logLevel, invalid: invalidLevel } = resolveLogLevel(options, process.env.LOG_LEVEL);
setLogLevel(logLevel);
if (invalidLevel) log.warn("invalid_log_level", { value: invalidLevel, using: logLevel });
const settings = parseSettings(options, process.env);
for (const name of settings.invalid) log.warn("invalid_option", { name });
log.info("starting", {
  version: APP_VERSION,
  log_level: logLevel,
  external: externalEnabled(settings),
  sync_interval_minutes: settings.syncIntervalMinutes,
  tz: process.env.TZ,
  node: process.version,
});

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const dbPath = process.env.DB_PATH ?? join(dataDir, "garmin-insights.db");
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
// Only inside the app: the Supervisor injects SUPERVISOR_TOKEN (needs homeassistant_api in config.yaml).
const services = createServices({
  db: openDb(dbPath),
  dataDir,
  masterKey: loadOrCreateMasterKey(join(dataDir, "secret.key")),
  supervisorToken: process.env.SUPERVISOR_TOKEN ?? null,
});
// Activities from before HR cleaning existed get checked once; afterwards this finds nothing to do.
for (const u of services.repos.users.list()) recomputeUncleanedHr(services.repos, u.id);
const api = createApi(services);
services.sync.start(settings.syncIntervalMinutes * 60_000);
const EXPIRY_CHECK_MS = 6 * 3600_000;
void services.keys.checkExpiry();
setInterval(() => void services.keys.checkExpiry(), EXPIRY_CHECK_MS).unref();
const staticRoot = resolve(process.env.STATIC_DIR ?? "./dist");

const ingressPort = Number(process.env.PORT ?? 8099);
serve({ fetch: createIngressApp({ allowedIp: process.env.INGRESS_ONLY_IP, api, staticRoot, devUserId: process.env.DEV_USER_ID, mcpUrl: externalEnabled(settings) ? `${settings.appExternalUrl}/mcp` : null }).fetch, port: ingressPort }, (i) =>
  log.info("ingress_listening", { port: i.port }),
);

if (externalEnabled(settings)) {
  const external = createExternalApp({
    haUrl: settings.haExternalUrl,
    appUrl: settings.appExternalUrl,
    verifier: createHaTokenVerifier({ wsUrl: process.env.HA_WS_URL ?? DEFAULT_HA_WS_URL }),
    api,
    mcp: createMcpEndpoint(services),
    staticRoot,
  });
  serve({ fetch: external.fetch, port: Number(process.env.EXTERNAL_PORT ?? 8100) }, (i) => log.info("external_listening", { port: i.port }));
} else {
  log.info("external_disabled", { reason: "ha_external_url and app_external_url must both be set" });
}

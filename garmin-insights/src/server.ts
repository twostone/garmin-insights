import { serve } from "@hono/node-server";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createApi } from "./api/index.ts";
import { createHaTokenVerifier, DEFAULT_HA_WS_URL } from "./auth/ha-token.ts";
import { openDb } from "./db.ts";
import { createExternalApp } from "./listeners/external.ts";
import { createIngressApp } from "./listeners/ingress.ts";
import { logger, resolveLogLevel, setLogLevel } from "./log.ts";
import { externalEnabled, parseSettings, readAddonOptions } from "./options.ts";
import { createRepos } from "./repo/index.ts";
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
const repos = createRepos(openDb(dbPath));
const api = createApi({ repos });
const staticRoot = resolve(process.env.STATIC_DIR ?? "./dist");

const ingressPort = Number(process.env.PORT ?? 8099);
serve({ fetch: createIngressApp({ allowedIp: process.env.INGRESS_ONLY_IP, api, staticRoot }).fetch, port: ingressPort }, (i) =>
  log.info("ingress_listening", { port: i.port }),
);

if (externalEnabled(settings)) {
  const external = createExternalApp({
    haUrl: settings.haExternalUrl,
    appUrl: settings.appExternalUrl,
    verifier: createHaTokenVerifier({ wsUrl: process.env.HA_WS_URL ?? DEFAULT_HA_WS_URL }),
    api,
    staticRoot,
  });
  serve({ fetch: external.fetch, port: Number(process.env.EXTERNAL_PORT ?? 8100) }, (i) => log.info("external_listening", { port: i.port }));
} else {
  log.info("external_disabled", { reason: "ha_external_url and app_external_url must both be set" });
}

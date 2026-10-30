import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { recomputeLoads } from "./analytics/recompute.ts";
import { createFitStore } from "./fit/store.ts";
import { createGarminClient, exchangeKey, type ClientOptions, type GarminApi } from "./garmin/client.ts";
import { createKeyService } from "./garmin/keys.ts";
import { createNotify } from "./ha/notify.ts";
import { createRepos } from "./repo/index.ts";
import { createSyncWorker } from "./sync/worker.ts";

export type ServiceOptions = {
  db: DatabaseSync;
  dataDir: string;
  masterKey: Buffer;
  supervisorToken: string | null;
  garminClient?: ClientOptions;
  /** Tests replace Garmin entirely. */
  garmin?: (userId: string) => GarminApi;
  today?: () => string;
};

// The object graph behind both listeners, the REST API and the MCP server: one place that knows who depends on whom.
export function createServices(o: ServiceOptions) {
  const repos = createRepos(o.db);
  const fit = createFitStore(join(o.dataDir, "fit"));
  const notify = createNotify(o.supervisorToken);
  const keys = createKeyService({ repos, masterKey: o.masterKey, exchange: (apiKey) => exchangeKey(apiKey, o.garminClient), notify, today: o.today });
  const client = createGarminClient((userId) => keys.reveal(userId), o.garminClient);
  const sync = createSyncWorker({
    repos,
    garmin: o.garmin ?? ((userId) => client.forUser(userId)),
    fit,
    onKeyInvalid: (userId) => keys.markInvalid(userId),
    onChanged: (userId, fromDate) => recomputeLoads(repos, userId, fromDate),
    today: o.today,
  });
  return { repos, fit, keys, sync, notify };
}
export type Services = ReturnType<typeof createServices>;

import createClient from "openapi-fetch";
import { logger } from "../log.ts";
import type { components, paths } from "./schema.d.ts";

const log = logger("garmin");

// Client for the Garmin Connect Personal API (spec: docs/garmin-personal-api.openapi.json, notes: docs/garmin-api.md).
// One instance per user and key: it caches the 24 h bearer token, spaces requests out (the rate limits are not documented, so
// the default is conservative), retries 429/5xx with backoff and renews the token once on a 401.

export const GARMIN_BASE_URL = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const TOKEN_REFRESH_WINDOW_MS = 60 * 60 * 1000; // renew when less than an hour is left, like Garmin's reference client
const DEFAULT_MIN_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 1000;
const MAX_RETRY_AFTER_MS = 120_000;

/** The key is missing, wrong, revoked or expired: no point in retrying until the user enters a new one. */
export class GarminKeyError extends Error {
  constructor(readonly reason: "missing" | "invalid") {
    super(reason === "missing" ? "no Garmin key stored" : "Garmin rejected the key");
  }
}
export class GarminApiError extends Error {
  constructor(readonly status: number, readonly path: string, options?: ErrorOptions) {
    super(`Garmin API ${status}`, options);
  }
}

export type Fetch = typeof fetch;
export type ClientOptions = {
  baseUrl?: string;
  fetch?: Fetch;
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** exp (seconds) of the JWT bearer token, or null. */
function tokenExpiry(token: string): number | null {
  try {
    const exp = (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/** Exchanges a Personal API key for a bearer token. Throws GarminKeyError when Garmin refuses the key. */
export async function exchangeKey(apiKey: string, o: ClientOptions = {}): Promise<{ token: string; expiresAt: number }> {
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  let res: Response;
  try {
    res = await doFetch(`${o.baseUrl ?? GARMIN_BASE_URL}${TOKEN_PATH}`, {
      method: "POST",
      headers: { Accept: "*/*", Authorization: `ApiKey ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new GarminApiError(0, TOKEN_PATH, { cause: e });
  }
  if (res.status === 401 || res.status === 403) throw new GarminKeyError("invalid");
  if (!res.ok) throw new GarminApiError(res.status, TOKEN_PATH);
  const token = (await res.text()).trim();
  if (!token) throw new GarminApiError(res.status, TOKEN_PATH);
  // A token without exp is treated as valid for the documented 24 h.
  return { token, expiresAt: (tokenExpiry(token) ?? Math.floor(now() / 1000) + 24 * 3600) * 1000 };
}

export type SummarizedActivity = components["schemas"]["SummarizedActivityDTO"];
export type DailySummary = components["schemas"]["UserDailySummaryV2DTO"];
export type SleepSummary = components["schemas"]["DailySleepDTO"];
export type HrvSummary = components["schemas"]["HrvSummaryDTO"];
export type HeartRateZones = components["schemas"]["HeartRateZonesDTO"];

/** What the sync worker needs from Garmin. Tests implement this interface directly. */
export interface GarminApi {
  searchActivities(q: { startDate: string; endDate: string; start: number; limit: number }): Promise<SummarizedActivity[]>;
  /** The ZIP Garmin returns for an activity, or null when the activity has no file (manual entries). */
  downloadActivityZip(id: number): Promise<Uint8Array | null>;
  dailySummaries(startDate: string, endDate: string): Promise<DailySummary[]>;
  sleepSummaries(startDate: string, endDate: string): Promise<SleepSummary[]>;
  hrvSummaries(startDate: string, endDate: string): Promise<HrvSummary[]>;
  heartRateZones(): Promise<HeartRateZones[]>;
}

export type GarminKeySource = (userId: string) => Promise<string | null>;

export function createGarminClient(keys: GarminKeySource, o: ClientOptions = {}) {
  const baseUrl = o.baseUrl ?? GARMIN_BASE_URL;
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? realSleep;
  const now = o.now ?? Date.now;
  const minInterval = o.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  function forUser(userId: string): GarminApi {
    let bearer: { token: string; expiresAt: number } | null = null;
    let lastRequestAt = 0;
    // Requests of one user run one after another, which also keeps the spacing honest.
    let queue: Promise<unknown> = Promise.resolve();

    async function token(force = false): Promise<string> {
      if (!force && bearer && bearer.expiresAt - now() > TOKEN_REFRESH_WINDOW_MS) return bearer.token;
      const apiKey = await keys(userId);
      if (!apiKey) throw new GarminKeyError("missing");
      bearer = await exchangeKey(apiKey, { baseUrl, fetch: doFetch, now });
      log.debug("token_renewed");
      return bearer.token;
    }

    async function send(request: Request): Promise<Response> {
      let renewed = false;
      for (let attempt = 1; ; attempt++) {
        const wait = lastRequestAt + minInterval - now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = now();
        const req = request.clone();
        req.headers.set("Authorization", `Bearer ${await token()}`);
        const path = new URL(req.url).pathname;
        let res: Response | null = null;
        try {
          res = await doFetch(req, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        } catch (e) {
          if (attempt >= MAX_ATTEMPTS) throw new GarminApiError(0, path, { cause: e });
        }
        if (res) {
          if (res.status === 401 && !renewed) {
            renewed = true;
            await token(true); // throws GarminKeyError when Garmin no longer accepts the key
            continue;
          }
          const retryable = res.status === 429 || res.status >= 500;
          if (!retryable || attempt >= MAX_ATTEMPTS) {
            if (res.status === 401) throw new GarminKeyError("invalid");
            if (!res.ok && res.status !== 204) throw new GarminApiError(res.status, path);
            return res;
          }
          const retryAfter = Number(res.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS) : BACKOFF_BASE_MS * 2 ** (attempt - 1);
          log.warn("retry", { status: res.status, attempt, delay_ms: delay, path });
          await sleep(delay);
          continue;
        }
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      }
    }

    const serial = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = queue.then(fn, fn);
      queue = run.catch(() => undefined);
      return run;
    };
    const api = createClient<paths>({
      baseUrl,
      headers: { Accept: "application/json" },
      fetch: (request) => serial(() => send(request)),
    });

    return {
      async searchActivities({ startDate, endDate, start, limit }) {
        // Children too: the legs of a multisport activity carry the per-sport HR, laps and samples the parent lacks.
        const { data } = await api.GET("/activitylist-service/activities/search/activities", {
          params: { query: { startDate, endDate, start, limit, sortOrder: "desc", excludeChildren: false } },
        });
        return data ?? [];
      },
      async downloadActivityZip(id) {
        let res: Response;
        try {
          res = await serial(() => send(new Request(`${baseUrl}/download-service/files/activity/${id}`, { headers: { Accept: "*/*" } })));
        } catch (e) {
          if (e instanceof GarminApiError && (e.status === 404 || e.status === 204)) return null;
          throw e;
        }
        if (res.status === 204) return null;
        return new Uint8Array(await res.arrayBuffer());
      },
      async dailySummaries(startDate, endDate) {
        const { data } = await api.GET("/usersummary-service/v2/dailysummaries", { params: { query: { startDate, endDate } } });
        return data?.data ?? [];
      },
      async sleepSummaries(startDate, endDate) {
        const { data } = await api.GET("/sleep-service/sleep/dailySleepSummariesByDate", { params: { query: { startDate, endDate } } });
        return data ?? [];
      },
      async hrvSummaries(fromDate, toDate) {
        const { data } = await api.GET("/hrv-service/hrv/daily/{fromDate}/{toDate}", { params: { path: { fromDate, toDate } } });
        return data?.hrvSummaries ?? [];
      },
      async heartRateZones() {
        const { data } = await api.GET("/biometric-service/heartRateZones/v2", { params: { query: { generateDefaults: true } } });
        return data ?? [];
      },
    };
  }
  return { forUser };
}
export type GarminClient = ReturnType<typeof createGarminClient>;

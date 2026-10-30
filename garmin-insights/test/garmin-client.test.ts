import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createGarminClient, exchangeKey, GarminApiError, GarminKeyError } from "../src/garmin/client.ts";
import { jwt } from "./helpers.ts";

type Handler = (req: IncomingMessage, res: ServerResponse, n: number) => void;
const calls: { method: string; url: string; auth: string | undefined }[] = [];
let handler: Handler = (_req, res) => void res.writeHead(500).end();
const server = createServer((req, res) => {
  calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization });
  handler(req, res, calls.length);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => server.close());

const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const json = (res: ServerResponse, body: unknown, status = 200) => void res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
const sleeps: number[] = [];
const fast = { baseUrl, minIntervalMs: 0, sleep: async (ms: number) => void sleeps.push(ms) };
const reset = (h: Handler) => {
  calls.length = 0;
  sleeps.length = 0;
  handler = h;
};

test("token exchange: ApiKey header, plain-text JWT answer, expiry from exp", async () => {
  const tok = jwt(86400);
  reset((req, res) => void res.writeHead(200).end(tok + "\n"));
  const r = await exchangeKey("my-key", { baseUrl });
  assert.equal(r.token, tok);
  assert.ok(Math.abs(r.expiresAt - (Date.now() + 86400_000)) < 5000);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, TOKEN_PATH);
  assert.equal(calls[0]!.auth, "ApiKey my-key");
});

test("token exchange: 401/403 -> GarminKeyError(invalid), 500 -> GarminApiError", async () => {
  reset((_q, res) => void res.writeHead(401).end());
  await assert.rejects(exchangeKey("k", { baseUrl }), (e: unknown) => e instanceof GarminKeyError && e.reason === "invalid");
  reset((_q, res) => void res.writeHead(500).end());
  await assert.rejects(exchangeKey("k", { baseUrl }), GarminApiError);
});

test("search: query parameters, bearer token, one token exchange for several calls", async () => {
  const tok = jwt(86400);
  reset((req, res) => (req.url === TOKEN_PATH ? res.writeHead(200).end(tok) : json(res, [{ activityId: 1 }])));
  const api = createGarminClient(async () => "k", fast).forUser("u1");
  const a = await api.searchActivities({ startDate: "2026-01-01", endDate: "2026-03-31", start: 0, limit: 99 });
  await api.searchActivities({ startDate: "2026-01-01", endDate: "2026-03-31", start: 99, limit: 99 });
  assert.deepEqual(a, [{ activityId: 1 }]);
  assert.equal(calls.filter((c) => c.url === TOKEN_PATH).length, 1);
  const search = calls.find((c) => c.url.startsWith("/activitylist-service"))!;
  const q = new URL(search.url, baseUrl).searchParams;
  assert.equal(q.get("startDate"), "2026-01-01");
  assert.equal(q.get("endDate"), "2026-03-31");
  assert.equal(q.get("limit"), "99");
  assert.equal(search.auth, `Bearer ${tok}`);
});

test("401 on data -> new token once, request repeated; second 401 -> GarminKeyError", async () => {
  const t1 = jwt(86400);
  const t2 = jwt(86400);
  let tokens = 0;
  reset((req, res) => {
    if (req.url === TOKEN_PATH) return void res.writeHead(200).end(++tokens === 1 ? t1 : t2);
    if (req.headers.authorization === `Bearer ${t2}`) return json(res, { data: [] });
    res.writeHead(401).end();
  });
  const api = createGarminClient(async () => "k", fast).forUser("u1");
  assert.deepEqual(await api.dailySummaries("2026-01-01", "2026-01-31"), []);
  assert.equal(tokens, 2);

  reset((req, res) => (req.url === TOKEN_PATH ? res.writeHead(200).end(jwt(86400)) : res.writeHead(401).end()));
  await assert.rejects(createGarminClient(async () => "k", fast).forUser("u2").dailySummaries("a", "b"), GarminKeyError);
});

test("429 honours Retry-After, 500 backs off exponentially, gives up after 4 attempts", async () => {
  reset((req, res, n) => {
    if (req.url === TOKEN_PATH) return void res.writeHead(200).end(jwt(86400));
    if (n === 2) return void res.writeHead(429, { "Retry-After": "7" }).end();
    json(res, []);
  });
  await createGarminClient(async () => "k", fast).forUser("u1").sleepSummaries("2026-01-01", "2026-01-31");
  assert.deepEqual(sleeps, [7000]);

  reset((req, res) => (req.url === TOKEN_PATH ? res.writeHead(200).end(jwt(86400)) : res.writeHead(503).end()));
  await assert.rejects(createGarminClient(async () => "k", fast).forUser("u1").heartRateZones(), (e: unknown) => e instanceof GarminApiError && e.status === 503);
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
  assert.equal(calls.filter((c) => c.url !== TOKEN_PATH).length, 4);
});

test("requests are spaced by the minimum interval", async () => {
  reset((req, res) => (req.url === TOKEN_PATH ? res.writeHead(200).end(jwt(86400)) : json(res, [])));
  let clock = 1_000_000;
  const api = createGarminClient(async () => "k", { baseUrl, minIntervalMs: 1000, now: () => clock, sleep: async (ms) => void (sleeps.push(ms), (clock += ms)) }).forUser("u1");
  await api.heartRateZones();
  await api.heartRateZones();
  assert.ok(sleeps.some((s) => s > 0 && s <= 1000), JSON.stringify(sleeps));
});

test("no stored key -> GarminKeyError(missing); zip download returns bytes, 404 -> null", async () => {
  reset((_q, res) => void res.writeHead(500).end());
  await assert.rejects(createGarminClient(async () => null, fast).forUser("u1").heartRateZones(), (e: unknown) => e instanceof GarminKeyError && e.reason === "missing");

  reset((req, res) => {
    if (req.url === TOKEN_PATH) return void res.writeHead(200).end(jwt(86400));
    if (req.url!.endsWith("/1")) return void res.writeHead(200, { "Content-Type": "application/x-zip-compressed" }).end(Buffer.from([80, 75, 3, 4]));
    res.writeHead(404).end();
  });
  const api = createGarminClient(async () => "k", fast).forUser("u1");
  assert.deepEqual([...(await api.downloadActivityZip(1))!], [80, 75, 3, 4]);
  assert.equal(await api.downloadActivityZip(2), null);
});

import "./helpers.ts"; // quiet log sink
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createNotify, expiringNotification, invalidNotification } from "../src/ha/notify.ts";
import { mapActivity, mapDaily, mapHeartRateZones, mapHrv, mapSleep } from "../src/sync/map.ts";

const seen: { auth: string | undefined; body: Record<string, unknown> }[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ auth: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(200).end("[]");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
after(() => server.close());

test("notifications: posted with the Supervisor token as a persistent notification; disabled without a token", async () => {
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  await createNotify(null, url)(expiringNotification("u1", "Anna", 5, "en"));
  assert.equal(seen.length, 0);
  await createNotify("sup-token", url)(expiringNotification("u1", "Anna", 5, "de"));
  assert.equal(seen[0]!.auth, "Bearer sup-token");
  assert.equal(seen[0]!.body.notification_id, "garmin_insights_expiring_u1");
  assert.match(String(seen[0]!.body.message), /Anna.*5 Tag/);
  assert.match(invalidNotification("u1", "Anna", "en").message, /Anna/);
});

test("notifications: a failing Supervisor never throws", async () => {
  await createNotify("t", "http://127.0.0.1:1/")({ id: "x", title: "t", message: "m" });
});

test("mapping: odd Garmin data becomes nulls, never exceptions", () => {
  assert.equal(mapActivity({} as never), null);
  const a = mapActivity({ activityId: 7, startTimeGMT: "2026-08-31 22:01:18", startTimeLocal: "2026-09-01 00:01:18", activityType: { typeId: 1, typeKey: "trail_running" }, distance: 5000 })!;
  assert.deepEqual([a.id, a.date, a.start_utc, a.sport, a.distance_m, a.avg_hr], [7, "2026-09-01", "2026-08-31T22:01:18.000Z", "running", 5000, null]);
  assert.equal(mapDaily({ calendarDate: "2026-01-01" }), null, "a day without any value is not stored");
  assert.equal(mapDaily({ calendarDate: "2026-01-01", heartRate: { restingValue: 51 } })!.resting_hr, 51);
  assert.equal(mapSleep({ calendarDate: "2026-01-01" }), null);
  assert.equal(mapSleep({ calendarDate: "2026-01-01", sleepTimeSeconds: 100, sleepScores: { overall: { value: 77 } } as never })!.score, 77);
  assert.equal(mapHrv({ calendarDate: "2026-01-01" } as never), null);
  assert.equal(mapHeartRateZones([], "2026-01-01"), null);
  const z = mapHeartRateZones([{ sport: "CYCLING", maxHeartRateUsed: 180 }, { sport: "RUNNING", maxHeartRateUsed: 190, zone1Floor: 95, zone2Floor: 114, zone3Floor: 133, zone4Floor: 152, zone5Floor: 171 }], "2026-01-01")!;
  assert.equal(z.hr_max, 190, "running zones are preferred");
  assert.equal(z.zones_json, JSON.stringify({ hr: [95, 114, 133, 152, 171] }));
});

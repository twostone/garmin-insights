import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createApi } from "../src/api/index.ts";
import { openDb } from "../src/db.ts";
import { setLogSink } from "../src/log.ts";
import { createRepos } from "../src/repo/index.ts";

// Tests stay quiet; the ones that assert on log lines install their own sink.
setLogSink(() => {});

export const INGRESS_IP = "172.30.32.2";
export const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });

export function staticRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gi-static-"));
  writeFileSync(join(dir, "index.html"), `<!doctype html><html><head><title>Garmin Insights</title><link rel="icon" href="/favicon.svg"><script>import("/_app/x.js"); start()</script></head><body></body></html>`);
  writeFileSync(join(dir, "app.js"), "console.log(1)");
  return dir;
}

export function memoryRepos() {
  return createRepos(openDb(":memory:"));
}

export function testApi() {
  const repos = memoryRepos();
  return { repos, api: createApi({ repos }) };
}

export function jwt(expSecondsFromNow = 1800, now = Date.now()): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc({ exp: Math.floor(now / 1000) + expSecondsFromNow, jti: Math.random() })}.sig`;
}

export type HaUserInfo = { id: string; name: string; is_admin?: boolean; credentials?: unknown[] };

// A Home Assistant WebSocket API stand-in: auth handshake and `auth/current_user`.
export async function mockHa(users: Record<string, HaUserInfo>) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const stats = { connections: 0 };
  wss.on("connection", (ws) => {
    stats.connections++;
    let user: HaUserInfo | undefined;
    ws.send(JSON.stringify({ type: "auth_required", ha_version: "2026.10.1" }));
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "auth") {
        user = users[msg.access_token];
        ws.send(JSON.stringify({ type: user ? "auth_ok" : "auth_invalid" }));
      } else if (msg.type === "auth/current_user" && user) {
        ws.send(
          JSON.stringify({
            id: msg.id,
            type: "result",
            success: true,
            result: { is_owner: false, is_admin: false, credentials: [{ auth_provider_type: "homeassistant" }], mfa_modules: [], ...user },
          }),
        );
      }
    });
  });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const port = (wss.address() as { port: number }).port;
  return { url: `ws://127.0.0.1:${port}`, stats, close: () => new Promise<void>((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }) };
}

import type { ActivityInput } from "../src/repo/activities.ts";
import type { Repos } from "../src/repo/index.ts";

export function activity(id: number, date: string, over: Partial<ActivityInput> = {}): ActivityInput {
  return {
    id, start_utc: `${date}T06:00:00.000Z`, date, name: `Activity ${id}`, type_key: "running", sport: "running",
    distance_m: 10000, duration_s: 3000, moving_s: 2950, elevation_gain_m: 50, avg_hr: 150, max_hr: 175, avg_power: null, norm_power: null,
    avg_speed: 3.33, max_speed: 4.5, calories: 700, vo2max: null, te_aerobic: null, te_anaerobic: null, start_lat: null, start_lon: null,
    total_sets: null, total_reps: null, summary_json: "{}", ...over,
  };
}

export function seedUser(repos: Repos, id: string, name = id): void {
  repos.users.upsert({ id, name });
}

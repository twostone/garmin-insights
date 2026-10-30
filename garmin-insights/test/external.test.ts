import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHaTokenVerifier } from "../src/auth/ha-token.ts";
import { createExternalApp } from "../src/listeners/external.ts";
import { jwt, mockHa, staticRoot, testApi } from "./helpers.ts";

const HA = "https://ha.example.test";
const APP = "https://garmin.example.test";
const ha = await mockHa({});
after(() => ha.close());

const tokenA = jwt();
const haUsers = await mockHa({ [tokenA]: { id: "user-a", name: "Anna" } });
after(() => haUsers.close());

const external = (haUrl = haUsers.url) =>
  createExternalApp({
    haUrl: HA,
    appUrl: APP,
    verifier: createHaTokenVerifier({ wsUrl: haUrl, timeoutMs: 1000 }),
    api: testApi().api,
    mcp: async () => new Response("mcp ok"),
    staticRoot: staticRoot(),
  });

test("external: context injection with mode external, HA url, client id and manifest link", async () => {
  const res = await external().request("/");
  const html = await res.text();
  assert.match(html, /"mode":"external"/);
  assert.match(html, new RegExp(`"haUrl":"${HA}"`));
  assert.match(html, new RegExp(`"clientId":"${APP}/"`));
  assert.match(html, /<link rel="manifest"/);
  assert.match(html, /<base href="\/">/);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, new RegExp(`connect-src 'self' https://tiles.openfreemap.org ${HA}`));
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline|unsafe-eval/);
  assert.match(csp, /style-src-attr 'unsafe-inline'/);
});

test("external: forged ingress headers do not authenticate and do not change the base path", async () => {
  const app = external();
  const res = await app.request("/api/me", { headers: { "X-Remote-User-Id": "admin", "X-Remote-User-Name": "admin" } });
  assert.equal(res.status, 401);
  const html = await (await app.request("/", { headers: { "X-Ingress-Path": "/api/hassio_ingress/evil" } })).text();
  assert.match(html, /<base href="\/">/);
  assert.match(html, /"mode":"external"/);
});

test("external: api/context is public, other api routes and /mcp need a token", async () => {
  const app = external();
  assert.equal((await app.request("/api/context")).status, 200);
  const mcp = await app.request("/mcp", { method: "POST" });
  assert.equal(mcp.status, 401);
  assert.match(mcp.headers.get("www-authenticate") ?? "", /^Bearer .*resource_metadata="https:\/\/garmin\.example\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.equal((await app.request("/api/me")).status, 401);
});

test("external: a valid Home Assistant token identifies the user", async () => {
  const app = external();
  const headers = { Authorization: `Bearer ${tokenA}` };
  const res = await app.request("/api/me", { headers });
  assert.deepEqual(await res.json(), { user: { id: "user-a", name: "Anna" } });
  assert.equal(await (await app.request("/mcp", { method: "POST", headers })).text(), "mcp ok");
});

test("external: an unknown or malformed token is 401", async () => {
  const app = external();
  for (const t of [jwt(), "garbage", ""]) {
    const res = await app.request("/api/me", { headers: { Authorization: `Bearer ${t}` } });
    assert.equal(res.status, 401, t);
  }
});

test("external: Home Assistant unreachable fails closed (never anonymous)", async () => {
  const res = await external("ws://127.0.0.1:1").request("/api/me", { headers: { Authorization: `Bearer ${jwt()}` } });
  assert.ok(res.status >= 500, String(res.status));
});

test("external: protected-resource metadata points at Home Assistant", async () => {
  const app = external();
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const res = await app.request(path);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      resource: `${APP}/mcp`,
      authorization_servers: [HA],
      bearer_methods_supported: ["header"],
      resource_name: "Garmin Insights",
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  }
});

test("external: service worker and manifest are served (PWA only here)", async () => {
  const root = staticRoot();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${root}/sw.js`, "//sw");
  const app = createExternalApp({ haUrl: HA, appUrl: APP, verifier: async () => null, api: testApi().api, staticRoot: root });
  assert.equal((await app.request("/sw.js")).status, 200);
});

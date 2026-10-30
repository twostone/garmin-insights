import { test } from "node:test";
import assert from "node:assert/strict";
import { createIngressApp } from "../src/listeners/ingress.ts";
import { from, INGRESS_IP, staticRoot, testApi } from "./helpers.ts";

const ingress = (allowedIp: string | undefined | null = INGRESS_IP) =>
  createIngressApp({ allowedIp: allowedIp ?? undefined, api: testApi().api, staticRoot: staticRoot() });

test("ingress guard: Supervisor address is served (also as IPv4-mapped IPv6)", async () => {
  const app = ingress();
  assert.equal((await app.request("/api/context", {}, from(INGRESS_IP))).status, 200);
  assert.equal((await app.request("/api/context", {}, from("::ffff:" + INGRESS_IP))).status, 200);
});

test("ingress guard: other addresses are refused, forged user headers do not help", async () => {
  const app = ingress();
  for (const ip of ["172.30.32.3", "192.168.1.10", "127.0.0.1", "::1"]) {
    const res = await app.request("/api/me", { headers: { "X-Remote-User-Id": "admin" } }, from(ip));
    assert.equal(res.status, 403, ip);
  }
});

test("ingress guard: without connection info it fails closed", async () => {
  assert.equal((await ingress().request("/api/context")).status, 403);
});

test("ingress guard: disabled when no address is configured (dev/tests)", async () => {
  assert.equal((await ingress(null).request("/api/context")).status, 200);
});

test("ingress: the user comes from the X-Remote-User-* headers", async () => {
  const app = ingress();
  const res = await app.request("/api/me", { headers: { "X-Remote-User-Id": "u1", "X-Remote-User-Display-Name": "Anna", "X-Remote-User-Name": "anna" } }, from(INGRESS_IP));
  assert.deepEqual(await res.json(), { user: { id: "u1", name: "Anna" } });
});

test("ingress: context injection with a validated base path, mode ingress, no manifest", async () => {
  const app = ingress();
  const res = await app.request("/", { headers: { "X-Ingress-Path": "/api/hassio_ingress/abc_DEF-123" } }, from(INGRESS_IP));
  const html = await res.text();
  assert.match(html, /<base href="\/api\/hassio_ingress\/abc_DEF-123\/">/);
  assert.match(html, /"mode":"ingress"/);
  assert.doesNotMatch(html, /manifest/);
  assert.match(res.headers.get("content-security-policy") ?? "", /script-src 'self' 'sha256-/);
  assert.doesNotMatch(res.headers.get("content-security-policy") ?? "", /unsafe-inline/);
});

test("ingress: a malicious X-Ingress-Path falls back to /", async () => {
  const app = ingress();
  for (const bad of ['/"><script>alert(1)</script>', "//evil.example", "/api/hassio_ingress/a b"]) {
    const html = await (await app.request("/", { headers: { "X-Ingress-Path": bad } }, from(INGRESS_IP))).text();
    assert.match(html, /<base href="\/">/, bad);
    assert.doesNotMatch(html, /evil|alert/);
  }
});

test("ingress: api needs a user, static files and context do not", async () => {
  const app = ingress();
  assert.equal((await app.request("/api/context", {}, from(INGRESS_IP))).status, 200);
  assert.equal((await app.request("/app.js", {}, from(INGRESS_IP))).status, 200);
});

test("ingress: PWA files are refused, so no service worker can register under ingress", async () => {
  const app = ingress();
  for (const path of ["/sw.js", "/manifest.webmanifest", "/workbox-abc.js"]) {
    assert.equal((await app.request(path, {}, from(INGRESS_IP))).status, 404, path);
  }
});

test("ingress: there is no /mcp", async () => {
  assert.equal((await ingress().request("/mcp", { method: "POST" }, from(INGRESS_IP))).status, 404);
});

test("ingress: root-absolute asset URLs of the SPA fallback are made relative (they resolve against <base href>)", async () => {
  const html = await (await ingress().request("/", {}, from(INGRESS_IP))).text();
  assert.match(html, /href="\.\/favicon\.svg"/);
  assert.match(html, /import\("\.\/_app\/x\.js"\)/);
  assert.doesNotMatch(html.replace(/<base [^>]*>/, ""), /(href|src)="\//);
});

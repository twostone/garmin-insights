import { test } from "node:test";
import assert from "node:assert/strict";
import { base64url, challengeFor, randomToken } from "../web/src/lib/pkce.ts";
import { redirectUri, startLogin, finishLogin, AuthError } from "../web/src/lib/auth.ts";

test("PKCE S256 challenge matches the RFC 7636 appendix B example", async () => {
  assert.equal(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("random tokens are url-safe and long enough for a verifier", () => {
  const t = randomToken();
  assert.match(t, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(t, randomToken());
  assert.equal(base64url(new Uint8Array([251, 255])), "-_8");
});

test("authorize URL carries client id, redirect on the same host, S256 challenge and state", async () => {
  const store = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const cfg = { haUrl: "https://ha.example.test", clientId: "https://garmin.example.test/", appUrl: "https://garmin.example.test" };
  const url = new URL(await startLogin(cfg, "#/activities"));
  assert.equal(url.origin + url.pathname, "https://ha.example.test/auth/authorize");
  assert.equal(url.searchParams.get("client_id"), "https://garmin.example.test/");
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri(cfg.clientId));
  assert.equal(new URL(redirectUri(cfg.clientId)).host, new URL(cfg.clientId).host);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const pending = JSON.parse([...store.values()][0]!);
  assert.equal(url.searchParams.get("state"), pending.state);
  assert.equal(url.searchParams.get("code_challenge"), await challengeFor(pending.verifier));
  assert.equal(pending.returnTo, "#/activities");

  // A callback with a different state is refused before any request is made.
  await assert.rejects(finishLogin(cfg, "?code=abc&state=forged"), (e: unknown) => e instanceof AuthError && e.reason === "state");
});

test("code exchange and refresh against a token endpoint (form-encoded, PKCE verifier, refresh token kept)", async () => {
  const { createServer } = await import("node:http");
  const { refresh } = await import("../web/src/lib/auth.ts");
  const seen: URLSearchParams[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = new URLSearchParams(body);
      seen.push(p);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(p.get("grant_type") === "authorization_code" ? { access_token: "at1", refresh_token: "rt1", expires_in: 1800 } : { access_token: "at2", expires_in: 1800 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const cfg = { haUrl: `http://127.0.0.1:${port}`, clientId: "https://garmin.example.test/", appUrl: "https://garmin.example.test" };
    const store = new Map<string, string>();
    const area = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    (globalThis as { sessionStorage?: unknown }).sessionStorage = area;
    (globalThis as { localStorage?: unknown }).localStorage = area;
    const authorize = new URL(await startLogin(cfg));
    const { tokens } = await finishLogin(cfg, `?code=thecode&state=${authorize.searchParams.get("state")}`, 1000);
    assert.equal(tokens.accessToken, "at1");
    assert.equal(tokens.expiresAt, 1000 + 1800_000);
    assert.equal(seen[0]!.get("code"), "thecode");
    assert.equal(seen[0]!.get("client_id"), cfg.clientId);
    assert.ok(seen[0]!.get("code_verifier"));
    assert.equal(store.get("gi.refresh_token"), "rt1");
    const renewed = await refresh(cfg, "rt1");
    assert.equal(renewed.accessToken, "at2");
    assert.equal(renewed.refreshToken, "rt1");
    assert.equal(seen[1]!.get("grant_type"), "refresh_token");
  } finally {
    server.close();
  }
});

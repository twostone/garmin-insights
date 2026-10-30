import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHaTokenVerifier, HaUnavailableError, jwtExpiry } from "../src/auth/ha-token.ts";
import { jwt, mockHa } from "./helpers.ts";

const good = jwt();
const sysTok = jwt();
const llat = jwt(3600 * 24 * 365);
const ha = await mockHa({
  [good]: { id: "u1", name: "Anna", is_admin: true },
  [sysTok]: { id: "sys", name: "Supervisor", credentials: [] },
  [llat]: { id: "u2", name: "Ben" },
});
after(() => ha.close());

test("jwtExpiry reads exp and rejects non-JWTs", () => {
  assert.equal(jwtExpiry("a.b.c"), null);
  assert.equal(jwtExpiry("nope"), null);
  const t = jwt(60, 1_000_000);
  assert.equal(jwtExpiry(t), 1000 + 60);
});

test("valid token -> user; any valid token is accepted, including long-lived ones", async () => {
  const verify = createHaTokenVerifier({ wsUrl: ha.url });
  const a = await verify(good);
  assert.deepEqual(a?.user, { id: "u1", name: "Anna" });
  assert.equal(a?.isAdmin, true);
  assert.equal((await verify(llat))?.user.id, "u2");
});

test("unknown token and system user are refused", async () => {
  const verify = createHaTokenVerifier({ wsUrl: ha.url });
  assert.equal(await verify(jwt()), null);
  assert.equal(await verify(sysTok), null);
});

test("expired token is refused without asking Home Assistant", async () => {
  const before = ha.stats.connections;
  const verify = createHaTokenVerifier({ wsUrl: ha.url });
  assert.equal(await verify(jwt(-10)), null);
  assert.equal(ha.stats.connections, before);
});

test("results are cached by token hash and concurrent lookups share one connection", async () => {
  const verify = createHaTokenVerifier({ wsUrl: ha.url });
  const before = ha.stats.connections;
  await Promise.all([verify(good), verify(good), verify(good)]);
  await verify(good);
  assert.equal(ha.stats.connections - before, 1);
});

test("cache lasts at most 60 s and never beyond the token's exp", async () => {
  let now = Date.now();
  const verify = createHaTokenVerifier({ wsUrl: ha.url, now: () => now });
  const short = jwt(30, now);
  const users = await mockHa({ [short]: { id: "u3", name: "C" } });
  try {
    const v = createHaTokenVerifier({ wsUrl: users.url, now: () => now });
    assert.ok(await v(short));
    now += 29_000;
    assert.ok(await v(short));
    assert.equal(users.stats.connections, 1);
    now += 2_000; // past exp
    assert.equal(await v(short), null);
  } finally {
    await users.close();
  }
  void verify;
});

test("Home Assistant down -> HaUnavailableError (callers fail closed)", async () => {
  const verify = createHaTokenVerifier({ wsUrl: "ws://127.0.0.1:1", timeoutMs: 500 });
  await assert.rejects(verify(jwt()), HaUnavailableError);
});

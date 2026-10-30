import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { GarminKeyError } from "../src/garmin/client.ts";
import { createKeyService, KeyInputError } from "../src/garmin/keys.ts";
import type { Notification } from "../src/ha/notify.ts";
import { memoryRepos, seedUser } from "./helpers.ts";

function setup(exchange: (k: string) => Promise<unknown> = async () => ({}), today = "2026-10-30") {
  const repos = memoryRepos();
  seedUser(repos, "u1", "Anna");
  const sent: Notification[] = [];
  const keys = createKeyService({ repos, masterKey: randomBytes(32), exchange, notify: async (n) => void sent.push(n), today: () => today });
  return { repos, keys, sent };
}

test("a valid key is checked against Garmin, stored encrypted and never returned", async () => {
  const seen: string[] = [];
  const { repos, keys } = setup(async (k) => void seen.push(k));
  const status = await keys.put("u1", "  the-api-key ", "2027-01-01");
  assert.deepEqual(seen, ["the-api-key"]);
  assert.deepEqual(status, { configured: true, status: "ok", expiresOn: "2027-01-01", daysLeft: 63 });
  assert.ok(!JSON.stringify(status).includes("the-api-key"));
  assert.ok(!repos.keys.get("u1")!.ciphertext.includes("the-api-key"));
  assert.equal(await keys.reveal("u1"), "the-api-key");
});

test("a key Garmin rejects is not stored", async () => {
  const { repos, keys } = setup(async () => { throw new GarminKeyError("invalid"); });
  await assert.rejects(keys.put("u1", "bad", null), GarminKeyError);
  assert.equal(repos.keys.get("u1"), undefined);
});

test("input checks: empty, whitespace inside, past expiry date", async () => {
  const { keys } = setup();
  await assert.rejects(keys.put("u1", "", null), KeyInputError);
  await assert.rejects(keys.put("u1", "a b", null), KeyInputError);
  await assert.rejects(keys.put("u1", "k", "2020-01-01"), KeyInputError);
  await assert.rejects(keys.put("u1", "k", "not-a-date"), KeyInputError);
});

test("removing the key stops the sync but is just that", async () => {
  const { repos, keys } = setup();
  await keys.put("u1", "k", null);
  keys.remove("u1");
  assert.equal(await keys.reveal("u1"), null);
  assert.deepEqual(keys.status("u1"), { configured: false, status: null, expiresOn: null, daysLeft: null });
  assert.ok(repos.users.get("u1"));
});

test("7 days before expiry: one warning, not repeated; after expiry the key flips to expired", async () => {
  let today = "2026-10-20";
  const repos = memoryRepos();
  seedUser(repos, "u1", "Anna");
  const sent: Notification[] = [];
  const keys = createKeyService({ repos, masterKey: randomBytes(32), exchange: async () => ({}), notify: async (n) => void sent.push(n), today: () => today });
  await keys.put("u1", "k", "2026-10-30");
  await keys.checkExpiry();
  assert.equal(sent.length, 0, "10 days left");
  today = "2026-10-24";
  await keys.checkExpiry();
  await keys.checkExpiry();
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.message, /Anna/);
  today = "2026-10-31";
  await keys.checkExpiry();
  assert.equal(repos.keys.get("u1")!.status, "expired");
  assert.equal(await keys.reveal("u1"), null, "an expired key is not used");
  assert.equal(sent.length, 2);
});

test("Garmin rejecting the key during a sync pauses the sync and notifies once", async () => {
  const { repos, keys, sent } = setup();
  await keys.put("u1", "k", null);
  await keys.markInvalid("u1");
  await keys.markInvalid("u1");
  assert.equal(repos.keys.get("u1")!.status, "invalid");
  assert.equal(sent.length, 1);
  assert.deepEqual(repos.keys.listUsable(), []);
  // Entering a new key makes it usable again.
  await keys.put("u1", "new", null);
  assert.deepEqual(repos.keys.listUsable(), ["u1"]);
});

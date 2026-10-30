import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decrypt, encrypt, loadOrCreateMasterKey } from "../src/crypto.ts";

test("master key is created with mode 0600 and reloaded unchanged", () => {
  const path = join(mkdtempSync(join(tmpdir(), "gi-key-")), "secret.key");
  const a = loadOrCreateMasterKey(path);
  assert.equal(a.length, 32);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(loadOrCreateMasterKey(path), a);
});

test("encrypt/decrypt round trip; ciphertexts differ per call and hide the plaintext", () => {
  const key = loadOrCreateMasterKey(join(mkdtempSync(join(tmpdir(), "gi-key-")), "k"));
  const c1 = encrypt(key, "super-secret-api-key", "user-1");
  const c2 = encrypt(key, "super-secret-api-key", "user-1");
  assert.notEqual(c1, c2);
  assert.ok(!c1.includes("super-secret"));
  assert.equal(decrypt(key, c1, "user-1"), "super-secret-api-key");
});

test("a ciphertext is bound to its user and to its bytes", () => {
  const key = loadOrCreateMasterKey(join(mkdtempSync(join(tmpdir(), "gi-key-")), "k"));
  const c = encrypt(key, "secret", "user-1");
  assert.throws(() => decrypt(key, c, "user-2"));
  const [v, iv, tag, body] = c.split(".");
  assert.throws(() => decrypt(key, [v, iv, tag, Buffer.from("tampered").toString("base64url")].join("."), "user-1"));
  assert.throws(() => decrypt(Buffer.alloc(32, 1), c, "user-1"));
  void body;
});

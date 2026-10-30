import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// AES-256-GCM for the Garmin API keys at rest. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url). The user id is bound
// in as additional authenticated data, so a ciphertext copied to another user's row does not decrypt.

const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

export function loadOrCreateMasterKey(path: string): Buffer {
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
    if (key.length !== KEY_BYTES) throw new Error("master key file is corrupt");
    return key;
  }
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(KEY_BYTES);
  // 0600 from the start: no window in which the key is world-readable.
  writeFileSync(path, key.toString("base64"), { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return key;
}

export function encrypt(masterKey: Buffer, plaintext: string, userId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(masterKey: Buffer, payload: string, userId: string): string {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

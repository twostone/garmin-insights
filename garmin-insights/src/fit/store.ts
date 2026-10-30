import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";

// Original FIT files: <dir>/<user>/<activity id>.fit. The user id becomes a directory name, so it is reduced to a safe name
// (HA user ids are hex, but nothing here should depend on it).
export function createFitStore(dir: string) {
  const userDir = (userId: string) => join(dir, /^[A-Za-z0-9_-]{1,64}$/.test(userId) ? userId : createHash("sha256").update(userId).digest("hex").slice(0, 32));
  const file = (userId: string, id: number) => join(userDir(userId), `${Math.trunc(id)}.fit`);
  return {
    save(userId: string, id: number, bytes: Uint8Array): void {
      mkdirSync(userDir(userId), { recursive: true });
      const tmp = `${file(userId, id)}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, file(userId, id));
    },
    read: (userId: string, id: number): Uint8Array | null => (existsSync(file(userId, id)) ? readFileSync(file(userId, id)) : null),
    has: (userId: string, id: number): boolean => existsSync(file(userId, id)),
    deleteUser: (userId: string): void => rmSync(userDir(userId), { recursive: true, force: true }),
  };
}
export type FitStore = ReturnType<typeof createFitStore>;

// Garmin hands out activity files as a ZIP; the FIT file is the entry ending in .fit.
export function fitFromZip(zip: Uint8Array): Uint8Array | null {
  const entries = unzipSync(zip, { filter: (f) => /\.fit$/i.test(f.name) });
  return Object.values(entries)[0] ?? null;
}

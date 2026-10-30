import type { DatabaseSync } from "node:sqlite";

export type KeyStatus = "ok" | "invalid" | "expired";
export type KeyRow = { user_id: string; ciphertext: string; expires_on: string | null; status: KeyStatus; warned_for: string | null };

export function keysRepo(db: DatabaseSync) {
  const get = db.prepare("SELECT user_id, ciphertext, expires_on, status, warned_for FROM garmin_keys WHERE user_id = ?");
  const put = db.prepare(
    `INSERT INTO garmin_keys (user_id, ciphertext, expires_on, status, warned_for) VALUES (?, ?, ?, 'ok', NULL)
     ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, expires_on = excluded.expires_on, status = 'ok',
       warned_for = NULL, updated_at = datetime('now')`,
  );
  return {
    get: (userId: string): KeyRow | undefined => get.get(userId) as KeyRow | undefined,
    put: (userId: string, ciphertext: string, expiresOn: string | null): void => void put.run(userId, ciphertext, expiresOn),
    setStatus: (userId: string, status: KeyStatus): void =>
      void db.prepare("UPDATE garmin_keys SET status = ? WHERE user_id = ?").run(status, userId),
    markWarned: (userId: string, expiresOn: string): void =>
      void db.prepare("UPDATE garmin_keys SET warned_for = ? WHERE user_id = ?").run(expiresOn, userId),
    delete: (userId: string): void => void db.prepare("DELETE FROM garmin_keys WHERE user_id = ?").run(userId),
    /** Users whose key is usable: the sync scheduler walks these. */
    listUsable: (): string[] =>
      (db.prepare("SELECT user_id FROM garmin_keys WHERE status = 'ok' ORDER BY user_id").all() as { user_id: string }[]).map((r) => r.user_id),
    all: (): KeyRow[] => db.prepare("SELECT user_id, ciphertext, expires_on, status, warned_for FROM garmin_keys").all() as KeyRow[],
  };
}

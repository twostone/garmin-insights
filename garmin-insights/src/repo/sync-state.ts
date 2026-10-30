import type { DatabaseSync } from "node:sqlite";

export type SyncKind = "activities" | "fit" | "dailies" | "sleep" | "hrv" | "zones";
export const SYNC_KINDS: readonly SyncKind[] = ["activities", "fit", "dailies", "sleep", "hrv", "zones"];
export type SyncStateRow = {
  kind: SyncKind;
  cursor: string | null;
  backfill_done: number;
  last_sync_at: string | null;
  last_error: string | null;
  items: number;
};
export type SyncStatePatch = Partial<Omit<SyncStateRow, "kind">>;

export function syncStateRepo(db: DatabaseSync) {
  const get = db.prepare("SELECT kind, cursor, backfill_done, last_sync_at, last_error, items FROM sync_state WHERE user_id = ? AND kind = ?");
  const all = db.prepare("SELECT kind, cursor, backfill_done, last_sync_at, last_error, items FROM sync_state WHERE user_id = ? ORDER BY kind");
  const ensure = db.prepare("INSERT OR IGNORE INTO sync_state (user_id, kind) VALUES (?, ?)");
  return {
    get: (userId: string, kind: SyncKind): SyncStateRow | undefined => get.get(userId, kind) as SyncStateRow | undefined,
    all: (userId: string): SyncStateRow[] => all.all(userId) as SyncStateRow[],
    save(userId: string, kind: SyncKind, patch: SyncStatePatch): void {
      ensure.run(userId, kind);
      const entries = Object.entries(patch);
      if (!entries.length) return;
      // Column names come from the typed patch keys above, never from input.
      const set = entries.map(([k]) => `${k} = ?`).join(", ");
      db.prepare(`UPDATE sync_state SET ${set} WHERE user_id = ? AND kind = ?`).run(...(entries.map(([, v]) => v) as (string | number | null)[]), userId, kind);
    },
  };
}

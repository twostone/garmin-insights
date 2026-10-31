import type { DatabaseSync } from "node:sqlite";

export type CustomSport = { id: number; name: string };

// The athlete's own sports (e.g. "Dragon boat", "OC1"), assigned by hand per activity. Several Garmin types can belong to one.
export function customSportsRepo(db: DatabaseSync) {
  return {
    list: (userId: string): CustomSport[] =>
      db.prepare("SELECT id, name FROM custom_sports WHERE user_id = ? ORDER BY name").all(userId) as CustomSport[],
    /** Resolves a name (as the MCP tools take it) to the id; case-insensitive. */
    idByName: (userId: string, name: string): number | undefined =>
      (db.prepare("SELECT id FROM custom_sports WHERE user_id = ? AND name = ? COLLATE NOCASE").get(userId, name) as { id: number } | undefined)?.id,
  };
}

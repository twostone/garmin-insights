import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db.ts";

export type CustomSport = { id: number; name: string };
export type CustomSportDetail = CustomSport & { type_keys: string[]; activity_count: number };

// The athlete's own sports (e.g. "Dragon boat", "OC1"), assigned by hand per activity. Several Garmin types can belong to one.
// The types are the base: how an activity is computed still follows its Garmin type.
export function customSportsRepo(db: DatabaseSync) {
  const insertType = db.prepare("INSERT INTO custom_sport_types (user_id, custom_sport_id, type_key) VALUES (?, ?, ?)");
  const deleteTypes = db.prepare("DELETE FROM custom_sport_types WHERE user_id = ? AND custom_sport_id = ?");
  const writeTypes = (userId: string, id: number, typeKeys: string[]) => {
    deleteTypes.run(userId, id);
    for (const key of new Set(typeKeys)) insertType.run(userId, id, key);
  };

  return {
    list: (userId: string): CustomSport[] =>
      db.prepare("SELECT id, name FROM custom_sports WHERE user_id = ? ORDER BY name").all(userId) as CustomSport[],
    /** With base types and the number of activities assigned. */
    listDetailed(userId: string): CustomSportDetail[] {
      const types = db.prepare("SELECT custom_sport_id, type_key FROM custom_sport_types WHERE user_id = ? ORDER BY type_key").all(userId) as { custom_sport_id: number; type_key: string }[];
      const counts = db.prepare("SELECT custom_sport_id, COUNT(*) AS n FROM activities WHERE user_id = ? AND custom_sport_id IS NOT NULL GROUP BY custom_sport_id").all(userId) as { custom_sport_id: number; n: number }[];
      return (db.prepare("SELECT id, name FROM custom_sports WHERE user_id = ? ORDER BY name").all(userId) as CustomSport[]).map((s) => ({
        ...s,
        type_keys: types.filter((t) => t.custom_sport_id === s.id).map((t) => t.type_key),
        activity_count: counts.find((c) => c.custom_sport_id === s.id)?.n ?? 0,
      }));
    },
    /** Resolves a name (as the MCP tools take it) to the id; case-insensitive. */
    idByName: (userId: string, name: string): number | undefined =>
      (db.prepare("SELECT id FROM custom_sports WHERE user_id = ? AND name = ? COLLATE NOCASE").get(userId, name) as { id: number } | undefined)?.id,
    typesOf: (userId: string, id: number): string[] =>
      (db.prepare("SELECT type_key FROM custom_sport_types WHERE user_id = ? AND custom_sport_id = ? ORDER BY type_key").all(userId, id) as { type_key: string }[]).map((r) => r.type_key),
    /** Garmin types present in the user's own activities: the choices for a sport's base types. */
    garminTypes: (userId: string): string[] =>
      (db.prepare("SELECT DISTINCT type_key FROM activities WHERE user_id = ? ORDER BY type_key").all(userId) as { type_key: string }[]).map((r) => r.type_key),

    /** Ids are per user (no autoincrement in the composite key). Throws on a duplicate name (UNIQUE), the caller checks first. */
    create(userId: string, name: string, typeKeys: string[]): number {
      return transaction(db, () => {
        const id = (db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM custom_sports WHERE user_id = ?").get(userId) as { id: number }).id;
        db.prepare("INSERT INTO custom_sports (user_id, id, name) VALUES (?, ?, ?)").run(userId, id, name);
        writeTypes(userId, id, typeKeys);
        return id;
      });
    },
    rename: (userId: string, id: number, name: string): boolean =>
      Number(db.prepare("UPDATE custom_sports SET name = ? WHERE user_id = ? AND id = ?").run(name, userId, id).changes) > 0,
    setTypes(userId: string, id: number, typeKeys: string[]): void {
      transaction(db, () => writeTypes(userId, id, typeKeys));
    },
    /** There is no FK from activities, so the assignments are cleared by hand. */
    delete(userId: string, id: number): boolean {
      return transaction(db, () => {
        db.prepare("UPDATE activities SET custom_sport_id = NULL WHERE user_id = ? AND custom_sport_id = ?").run(userId, id);
        return Number(db.prepare("DELETE FROM custom_sports WHERE user_id = ? AND id = ?").run(userId, id).changes) > 0;
      });
    },
    /** Assigns (or, with null, clears) the custom sport of one activity. */
    assign: (userId: string, activityId: number, customSportId: number | null): void =>
      void db.prepare("UPDATE activities SET custom_sport_id = ? WHERE user_id = ? AND id = ?").run(customSportId, userId, activityId),
  };
}

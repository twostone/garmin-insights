import type { DatabaseSync } from "node:sqlite";
import type { AppUser } from "../types.ts";

export type Language = "de" | "en";
export type UserRow = { id: string; name: string | null; language: Language | null };

export function usersRepo(db: DatabaseSync) {
  const upsert = db.prepare(
    `INSERT INTO users (id, name) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, name), last_seen_at = datetime('now')`,
  );
  const get = db.prepare("SELECT id, name, language FROM users WHERE id = ?");
  const all = db.prepare("SELECT id, name, language FROM users ORDER BY id");
  const setLanguage = db.prepare("UPDATE users SET language = ? WHERE id = ?");
  return {
    upsert: (user: AppUser): void => void upsert.run(user.id, user.name),
    get: (userId: string): UserRow | undefined => get.get(userId) as UserRow | undefined,
    list: (): UserRow[] => all.all() as UserRow[],
    setLanguage: (userId: string, language: Language | null): void => void setLanguage.run(language, userId),
    /** Deletes the user and, by cascade, everything stored for them. */
    delete: (userId: string): void => void db.prepare("DELETE FROM users WHERE id = ?").run(userId),
  };
}
export type UsersRepo = ReturnType<typeof usersRepo>;

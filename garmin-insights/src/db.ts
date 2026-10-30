import { DatabaseSync } from "node:sqlite";

// Thin wrapper: all DB access goes through this module and src/repo/*, so node:sqlite (still experimental on
// Node 22) can be swapped later.

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

// One entry per schema version; PRAGMA user_version says how many are applied. Only ever append.
// Every table holding user data has user_id as the first key column (see AGENTS.md).
export const MIGRATIONS: string[] = [
  // v1: users (key = Home Assistant user id) and their UI language override
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT,
    language TEXT CHECK (language IS NULL OR language IN ('de', 'en')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) STRICT;`,
];

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

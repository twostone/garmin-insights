import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, openDb } from "../src/db.ts";

test("a database at schema v1 is migrated forward and keeps its users", () => {
  const path = join(mkdtempSync(join(tmpdir(), "gi-db-")), "old.db");
  const old = new DatabaseSync(path);
  old.exec(MIGRATIONS[0]!);
  old.exec("PRAGMA user_version = 1");
  old.prepare("INSERT INTO users (id, name) VALUES ('u1', 'Anna')").run();
  old.close();

  const db = openDb(path);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, MIGRATIONS.length);
  assert.equal((db.prepare("SELECT name FROM users WHERE id = 'u1'").get() as { name: string }).name, "Anna");
  db.prepare("INSERT INTO garmin_keys (user_id, ciphertext) VALUES ('u1', 'x')").run();
  db.close();
});

test("every table with user data carries user_id and cascades from users", () => {
  const db = openDb(":memory:");
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'users'").all() as { name: string }[]).map((t) => t.name);
  assert.ok(tables.length === 11);
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; pk: number }[]);
    assert.ok(cols.some((c) => c.name === "user_id" && c.pk >= 1), `${t}: user_id is part of the primary key`);
  }
  db.prepare("INSERT INTO users (id) VALUES ('u')").run();
  db.prepare("INSERT INTO dailies (user_id, date, steps) VALUES ('u', '2026-01-01', 1)").run();
  db.prepare("DELETE FROM users WHERE id = 'u'").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM dailies").get() as { n: number }).n, 0);
});

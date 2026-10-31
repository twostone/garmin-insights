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
  // v2: Garmin key (encrypted), sync progress, activities with their FIT-derived detail, health data, athlete settings,
  // materialised daily load. user_id leads every key; deleting a user cascades through all of it.
  `CREATE TABLE garmin_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    expires_on TEXT,
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'invalid', 'expired')),
    warned_for TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) STRICT;

  CREATE TABLE sync_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    cursor TEXT,
    backfill_done INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT,
    last_error TEXT,
    items INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, kind)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE activities (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id INTEGER NOT NULL,
    start_utc TEXT NOT NULL,
    date TEXT NOT NULL,
    name TEXT,
    type_key TEXT NOT NULL,
    sport TEXT NOT NULL,
    distance_m REAL,
    duration_s REAL,
    moving_s REAL,
    elevation_gain_m REAL,
    avg_hr REAL,
    max_hr REAL,
    avg_power REAL,
    norm_power REAL,
    avg_speed REAL,
    max_speed REAL,
    calories REAL,
    vo2max REAL,
    te_aerobic REAL,
    te_anaerobic REAL,
    start_lat REAL,
    start_lon REAL,
    total_sets INTEGER,
    total_reps INTEGER,
    summary_json TEXT NOT NULL,
    fit_status TEXT NOT NULL DEFAULT 'pending' CHECK (fit_status IN ('pending', 'done', 'none', 'failed')),
    trimp REAL,
    tss REAL,
    tss_method TEXT,
    PRIMARY KEY (user_id, id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX activities_by_date ON activities(user_id, date);

  CREATE TABLE activity_samples (
    user_id TEXT NOT NULL,
    activity_id INTEGER NOT NULL,
    t INTEGER NOT NULL,
    lat REAL, lon REAL, alt REAL,
    hr INTEGER, power INTEGER, cadence INTEGER,
    speed REAL, dist REAL, temp REAL,
    PRIMARY KEY (user_id, activity_id, t),
    FOREIGN KEY (user_id, activity_id) REFERENCES activities(user_id, id) ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE laps (
    user_id TEXT NOT NULL,
    activity_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    start_s REAL, duration_s REAL, distance_m REAL,
    avg_hr REAL, max_hr REAL, avg_power REAL, avg_speed REAL, avg_cadence REAL, ascent_m REAL,
    PRIMARY KEY (user_id, activity_id, idx),
    FOREIGN KEY (user_id, activity_id) REFERENCES activities(user_id, id) ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE strength_sets (
    user_id TEXT NOT NULL,
    activity_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    start_s REAL, duration_s REAL,
    set_type TEXT NOT NULL CHECK (set_type IN ('active', 'rest')),
    exercise TEXT,
    reps INTEGER,
    weight_kg REAL,
    PRIMARY KEY (user_id, activity_id, idx),
    FOREIGN KEY (user_id, activity_id) REFERENCES activities(user_id, id) ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE dailies (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    steps INTEGER,
    resting_hr INTEGER, min_hr INTEGER, max_hr INTEGER,
    stress_avg REAL,
    body_battery_high INTEGER, body_battery_low INTEGER,
    active_minutes REAL,
    PRIMARY KEY (user_id, date)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE sleep (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    sleep_s INTEGER, deep_s INTEGER, light_s INTEGER, rem_s INTEGER, awake_s INTEGER,
    score INTEGER,
    avg_spo2 REAL, avg_respiration REAL, avg_stress REAL, avg_hr REAL,
    PRIMARY KEY (user_id, date)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE hrv (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    last_night_avg INTEGER, weekly_avg INTEGER, last_night_5min_high INTEGER,
    baseline_low INTEGER, baseline_high INTEGER,
    status TEXT,
    PRIMARY KEY (user_id, date)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE athlete_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    valid_from TEXT NOT NULL,
    hr_max INTEGER, hr_rest INTEGER, lthr INTEGER,
    ftp INTEGER,
    threshold_pace_s_per_km REAL,
    sex TEXT CHECK (sex IS NULL OR sex IN ('m', 'f')),
    zones_json TEXT,
    source TEXT NOT NULL CHECK (source IN ('garmin', 'manual')),
    PRIMARY KEY (user_id, valid_from)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE analytics_daily (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    trimp REAL NOT NULL,
    tss REAL NOT NULL,
    ctl REAL NOT NULL,
    atl REAL NOT NULL,
    tsb REAL NOT NULL,
    PRIMARY KEY (user_id, date)
  ) STRICT, WITHOUT ROWID;`,
  // v3: the athlete's own sports (several Garmin types each, assigned by hand per activity), multisport legs (parent_id) and
  // the heart-rate artefact cleaning results. The UPDATEs re-map existing rows to the new paddling/rowing sports; they are a
  // snapshot of src/sport.ts at this version.
  `CREATE TABLE custom_sports (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (user_id, id),
    UNIQUE (user_id, name)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE custom_sport_types (
    user_id TEXT NOT NULL,
    custom_sport_id INTEGER NOT NULL,
    type_key TEXT NOT NULL,
    PRIMARY KEY (user_id, custom_sport_id, type_key),
    FOREIGN KEY (user_id, custom_sport_id) REFERENCES custom_sports(user_id, id) ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  ALTER TABLE activities ADD COLUMN custom_sport_id INTEGER;
  ALTER TABLE activities ADD COLUMN parent_id INTEGER;
  ALTER TABLE activities ADD COLUMN is_multisport_parent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE activities ADD COLUMN max_hr_clean REAL;
  ALTER TABLE activities ADD COLUMN hr_artifact_s INTEGER;
  CREATE INDEX activities_by_parent ON activities(user_id, parent_id) WHERE parent_id IS NOT NULL;

  UPDATE activities SET sport = 'rowing' WHERE type_key IN ('rowing', 'rowing_v2', 'indoor_rowing');
  UPDATE activities SET sport = 'paddling'
  WHERE type_key LIKE 'stand\\_up\\_paddleboarding%' ESCAPE '\\' OR type_key LIKE 'kayaking%' OR type_key LIKE 'canoeing%'
     OR type_key LIKE 'whitewater%' OR type_key LIKE 'paddling%' OR type_key LIKE 'outrigger%' OR type_key LIKE 'dragon\\_boat%' ESCAPE '\\';`,
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

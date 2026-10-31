import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { transaction } from "../db.ts";
import type { Sport } from "../sport.ts";

export type FitStatus = "pending" | "done" | "none" | "failed";

export type ActivityInput = {
  id: number;
  start_utc: string;
  date: string;
  name: string | null;
  type_key: string;
  sport: Sport;
  distance_m: number | null;
  duration_s: number | null;
  moving_s: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  norm_power: number | null;
  avg_speed: number | null;
  max_speed: number | null;
  calories: number | null;
  vo2max: number | null;
  te_aerobic: number | null;
  te_anaerobic: number | null;
  start_lat: number | null;
  start_lon: number | null;
  total_sets: number | null;
  total_reps: number | null;
  summary_json: string;
};

const SUMMARY_COLUMNS = [
  "start_utc", "date", "name", "type_key", "sport", "distance_m", "duration_s", "moving_s", "elevation_gain_m", "avg_hr", "max_hr",
  "avg_power", "norm_power", "avg_speed", "max_speed", "calories", "vo2max", "te_aerobic", "te_anaerobic", "start_lat", "start_lon",
  "total_sets", "total_reps", "summary_json",
] as const;

// Columns the sync never writes: the user's own sport, the multisport link and the HR cleaning results survive every re-sync.
const DERIVED_COLUMNS = ["fit_status", "trimp", "tss", "tss_method", "custom_sport_id", "parent_id", "is_multisport_parent", "max_hr_clean", "hr_artifact_s"] as const;

// Everything but the raw JSON (list and analytics queries stay small), plus the name of the user's own sport.
const LIGHT_COLUMNS = [
  ...["id", ...SUMMARY_COLUMNS.filter((c) => c !== "summary_json"), ...DERIVED_COLUMNS].map((c) => `a.${c}`),
  "cs.name AS custom_sport",
  "COALESCE(cs.name, a.sport) AS group_key",
].join(", ");
const FROM_ACTIVITIES = "activities a LEFT JOIN custom_sports cs ON cs.user_id = a.user_id AND cs.id = a.custom_sport_id";

/**
 * Activities that count in load, volume, zones and bests: multisport legs count, their parent does not (it would count the
 * same time twice). A parent without synced legs still counts as one activity.
 */
export const COUNTED = `NOT (a.is_multisport_parent = 1 AND EXISTS (SELECT 1 FROM activities leg WHERE leg.user_id = a.user_id AND leg.parent_id = a.id))`;

export type ActivityRow = Omit<ActivityInput, "summary_json"> & {
  fit_status: FitStatus;
  trimp: number | null;
  tss: number | null;
  tss_method: string | null;
  custom_sport_id: number | null;
  /** Name of the user's own sport, if one is assigned. */
  custom_sport: string | null;
  /** What analyses group by: the user's own sport if assigned, else the Garmin-derived sport. */
  group_key: string;
  parent_id: number | null;
  is_multisport_parent: 0 | 1;
  max_hr_clean: number | null;
  hr_artifact_s: number | null;
};

/** Which activities an analysis looks at: a Garmin-derived sport, the user's own sport, or both. */
export type SportFilter = { sport?: Sport; customSportId?: number };

export type ListFilter = SportFilter & {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  /** Listing view: multisport legs are left out (they hang under their parent). */
  topLevel?: boolean;
  /** Analysis view: only activities that count (see COUNTED). */
  counted?: boolean;
};

function whereOf(userId: string, f: Omit<ListFilter, "limit" | "offset" | "order">): { sql: string; args: SQLInputValue[] } {
  const where = ["a.user_id = ?"];
  const args: SQLInputValue[] = [userId];
  if (f.sport) (where.push("a.sport = ?"), args.push(f.sport));
  if (f.customSportId !== undefined) (where.push("a.custom_sport_id = ?"), args.push(f.customSportId));
  if (f.from) (where.push("a.date >= ?"), args.push(f.from));
  if (f.to) (where.push("a.date <= ?"), args.push(f.to));
  if (f.topLevel) where.push("a.parent_id IS NULL");
  if (f.counted) where.push(COUNTED);
  return { sql: where.join(" AND "), args };
}

export type SampleRow = {
  t: number; lat: number | null; lon: number | null; alt: number | null; hr: number | null; power: number | null;
  cadence: number | null; speed: number | null; dist: number | null; temp: number | null;
};
export type LapRow = {
  idx: number; start_s: number | null; duration_s: number | null; distance_m: number | null; avg_hr: number | null; max_hr: number | null;
  avg_power: number | null; avg_speed: number | null; avg_cadence: number | null; ascent_m: number | null;
};
export type StrengthSetRow = {
  idx: number; start_s: number | null; duration_s: number | null; set_type: "active" | "rest"; exercise: string | null;
  reps: number | null; weight_kg: number | null;
};
export type StrengthSetWithActivity = StrengthSetRow & { activity_id: number; date: string };

export function activitiesRepo(db: DatabaseSync) {
  const upsert = db.prepare(
    `INSERT INTO activities (user_id, id, ${SUMMARY_COLUMNS.join(", ")}) VALUES (?, ?, ${SUMMARY_COLUMNS.map(() => "?").join(", ")})
     ON CONFLICT(user_id, id) DO UPDATE SET ${SUMMARY_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ")}`,
  );
  const exists = db.prepare("SELECT 1 AS x FROM activities WHERE user_id = ? AND id = ?");
  const getLight = db.prepare(`SELECT ${LIGHT_COLUMNS} FROM ${FROM_ACTIVITIES} WHERE a.user_id = ? AND a.id = ?`);
  const getSummary = db.prepare("SELECT summary_json FROM activities WHERE user_id = ? AND id = ?");

  const insertSample = db.prepare(
    "INSERT OR REPLACE INTO activity_samples (user_id, activity_id, t, lat, lon, alt, hr, power, cadence, speed, dist, temp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertLap = db.prepare(
    "INSERT OR REPLACE INTO laps (user_id, activity_id, idx, start_s, duration_s, distance_m, avg_hr, max_hr, avg_power, avg_speed, avg_cadence, ascent_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertSet = db.prepare(
    "INSERT OR REPLACE INTO strength_sets (user_id, activity_id, idx, start_s, duration_s, set_type, exercise, reps, weight_kg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  return {
    upsertSummary(userId: string, a: ActivityInput): void {
      upsert.run(userId, a.id, ...SUMMARY_COLUMNS.map((c) => a[c] as SQLInputValue));
    },
    has: (userId: string, id: number): boolean => exists.get(userId, id) !== undefined,
    get: (userId: string, id: number): ActivityRow | undefined => getLight.get(userId, id) as ActivityRow | undefined,
    summaryJson: (userId: string, id: number): string | undefined => (getSummary.get(userId, id) as { summary_json: string } | undefined)?.summary_json,

    list(userId: string, f: ListFilter = {}): ActivityRow[] {
      const { sql, args } = whereOf(userId, f);
      const dir = f.order === "asc" ? "ASC" : "DESC";
      return db
        .prepare(`SELECT ${LIGHT_COLUMNS} FROM ${FROM_ACTIVITIES} WHERE ${sql} ORDER BY a.start_utc ${dir} LIMIT ? OFFSET ?`)
        .all(...args, f.limit ?? 50, f.offset ?? 0) as ActivityRow[];
    },
    count(userId: string, f: Omit<ListFilter, "limit" | "offset" | "order"> = {}): number {
      const { sql, args } = whereOf(userId, f);
      return (db.prepare(`SELECT COUNT(*) AS n FROM activities a WHERE ${sql}`).get(...args) as { n: number }).n;
    },
    /** Per-day totals for the calendar view. */
    calendar(userId: string, from: string, to: string): { date: string; count: number; duration_s: number; distance_m: number; tss: number }[] {
      return db
        .prepare(
          `SELECT date, COUNT(*) AS count, COALESCE(SUM(duration_s), 0) AS duration_s, COALESCE(SUM(distance_m), 0) AS distance_m,
                  COALESCE(SUM(tss), 0) AS tss
           FROM activities a WHERE a.user_id = ? AND a.date >= ? AND a.date <= ? AND ${COUNTED} GROUP BY a.date ORDER BY a.date`,
        )
        .all(userId, from, to) as { date: string; count: number; duration_s: number; distance_m: number; tss: number }[];
    },
    /** Activities still waiting for their FIT file, newest first. */
    pendingFit: (userId: string, limit: number): { id: number; date: string }[] =>
      db.prepare("SELECT id, date FROM activities WHERE user_id = ? AND fit_status = 'pending' ORDER BY start_utc DESC LIMIT ?").all(userId, limit) as { id: number; date: string }[],
    pendingFitCount: (userId: string): number =>
      (db.prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND fit_status = 'pending'").get(userId) as { n: number }).n,
    setFitStatus: (userId: string, id: number, status: FitStatus): void =>
      void db.prepare("UPDATE activities SET fit_status = ? WHERE user_id = ? AND id = ?").run(status, userId, id),
    setLoad: (userId: string, id: number, load: { trimp: number | null; tss: number | null; tss_method: string | null }): void =>
      void db.prepare("UPDATE activities SET trimp = ?, tss = ?, tss_method = ? WHERE user_id = ? AND id = ?").run(load.trimp, load.tss, load.tss_method, userId, id),
    setHrClean: (userId: string, id: number, c: { max_hr_clean: number | null; hr_artifact_s: number }): void =>
      void db.prepare("UPDATE activities SET max_hr_clean = ?, hr_artifact_s = ? WHERE user_id = ? AND id = ?").run(c.max_hr_clean, c.hr_artifact_s, userId, id),
    /** Activities with a FIT file whose heart rate has not been checked for artifacts yet. */
    hrUncleaned: (userId: string): { id: number; date: string }[] =>
      db.prepare("SELECT id, date FROM activities WHERE user_id = ? AND fit_status = 'done' AND hr_artifact_s IS NULL ORDER BY start_utc").all(userId) as { id: number; date: string }[],
    /** Highest heart rate ever recorded: the fallback for HR max when the athlete has none configured. */
    maxHr: (userId: string): number | null =>
      (db.prepare("SELECT MAX(COALESCE(max_hr_clean, max_hr)) AS m FROM activities WHERE user_id = ?").get(userId) as { m: number | null }).m,
    /** Summed load per day, from the per-activity values. */
    dailyLoad: (userId: string, from: string, to: string): { date: string; trimp: number; tss: number }[] =>
      db
        .prepare(
          `SELECT a.date, COALESCE(SUM(a.trimp), 0) AS trimp, COALESCE(SUM(a.tss), 0) AS tss FROM activities a
           WHERE a.user_id = ? AND a.date >= ? AND a.date <= ? AND ${COUNTED} GROUP BY a.date ORDER BY a.date`,
        )
        .all(userId, from, to) as { date: string; trimp: number; tss: number }[],
    /** Oldest and newest activity date, for the range pickers. */
    span: (userId: string): { first: string | null; last: string | null } =>
      db.prepare("SELECT MIN(date) AS first, MAX(date) AS last FROM activities WHERE user_id = ?").get(userId) as { first: string | null; last: string | null },

    replaceDetail(
      userId: string,
      id: number,
      detail: { samples: SampleRow[]; laps: LapRow[]; sets: StrengthSetRow[] },
    ): void {
      transaction(db, () => {
        for (const table of ["activity_samples", "laps", "strength_sets"]) {
          db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND activity_id = ?`).run(userId, id);
        }
        for (const s of detail.samples) insertSample.run(userId, id, s.t, s.lat, s.lon, s.alt, s.hr, s.power, s.cadence, s.speed, s.dist, s.temp);
        for (const l of detail.laps) insertLap.run(userId, id, l.idx, l.start_s, l.duration_s, l.distance_m, l.avg_hr, l.max_hr, l.avg_power, l.avg_speed, l.avg_cadence, l.ascent_m);
        for (const s of detail.sets) insertSet.run(userId, id, s.idx, s.start_s, s.duration_s, s.set_type, s.exercise, s.reps, s.weight_kg);
      });
    },
    samples(userId: string, id: number, win: { from?: number; to?: number } = {}): SampleRow[] {
      return db
        .prepare(
          "SELECT t, lat, lon, alt, hr, power, cadence, speed, dist, temp FROM activity_samples WHERE user_id = ? AND activity_id = ? AND t >= ? AND t <= ? ORDER BY t",
        )
        .all(userId, id, win.from ?? 0, win.to ?? 2 ** 31) as SampleRow[];
    },
    laps: (userId: string, id: number): LapRow[] =>
      db.prepare("SELECT idx, start_s, duration_s, distance_m, avg_hr, max_hr, avg_power, avg_speed, avg_cadence, ascent_m FROM laps WHERE user_id = ? AND activity_id = ? ORDER BY idx").all(userId, id) as LapRow[],
    sets: (userId: string, id: number): StrengthSetRow[] =>
      db.prepare("SELECT idx, start_s, duration_s, set_type, exercise, reps, weight_kg FROM strength_sets WHERE user_id = ? AND activity_id = ? ORDER BY idx").all(userId, id) as StrengthSetRow[],
    /** Active sets of all strength activities in a date range, for volume per exercise and muscle group. */
    setsInRange: (userId: string, from: string, to: string): StrengthSetWithActivity[] =>
      db
        .prepare(
          `SELECT s.activity_id, a.date, s.idx, s.start_s, s.duration_s, s.set_type, s.exercise, s.reps, s.weight_kg
           FROM strength_sets s JOIN activities a ON a.user_id = s.user_id AND a.id = s.activity_id
           WHERE s.user_id = ? AND a.date >= ? AND a.date <= ? AND s.set_type = 'active' ORDER BY a.start_utc, s.idx`,
        )
        .all(userId, from, to) as StrengthSetWithActivity[],
    deleteAll: (userId: string): void => void db.prepare("DELETE FROM activities WHERE user_id = ?").run(userId),
  };
}

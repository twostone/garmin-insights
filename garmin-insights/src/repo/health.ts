import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { transaction } from "../db.ts";

export type DailyRow = {
  date: string; steps: number | null; resting_hr: number | null; min_hr: number | null; max_hr: number | null; stress_avg: number | null;
  body_battery_high: number | null; body_battery_low: number | null; active_minutes: number | null;
};
export type SleepRow = {
  date: string; sleep_s: number | null; deep_s: number | null; light_s: number | null; rem_s: number | null; awake_s: number | null;
  score: number | null; avg_spo2: number | null; avg_respiration: number | null; avg_stress: number | null; avg_hr: number | null;
};
export type HrvRow = {
  date: string; last_night_avg: number | null; weekly_avg: number | null; last_night_5min_high: number | null;
  baseline_low: number | null; baseline_high: number | null; status: string | null;
};

const DAILY_COLS = ["steps", "resting_hr", "min_hr", "max_hr", "stress_avg", "body_battery_high", "body_battery_low", "active_minutes"] as const;
const SLEEP_COLS = ["sleep_s", "deep_s", "light_s", "rem_s", "awake_s", "score", "avg_spo2", "avg_respiration", "avg_stress", "avg_hr"] as const;
const HRV_COLS = ["last_night_avg", "weekly_avg", "last_night_5min_high", "baseline_low", "baseline_high", "status"] as const;

// One generic upsert per table: user id first, then date, then the value columns.
function table<Row extends { date: string }>(db: DatabaseSync, name: string, cols: readonly (keyof Row & string)[]) {
  const upsert = db.prepare(
    `INSERT INTO ${name} (user_id, date, ${cols.join(", ")}) VALUES (?, ?, ${cols.map(() => "?").join(", ")})
     ON CONFLICT(user_id, date) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`,
  );
  const range = db.prepare(`SELECT date, ${cols.join(", ")} FROM ${name} WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`);
  return {
    upsertMany: (userId: string, rows: Row[]): void =>
      transaction(db, () => {
        for (const r of rows) upsert.run(userId, r.date, ...cols.map((c) => r[c] as SQLInputValue));
      }),
    range: (userId: string, from: string, to: string): Row[] => range.all(userId, from, to) as Row[],
    deleteAll: (userId: string): void => void db.prepare(`DELETE FROM ${name} WHERE user_id = ?`).run(userId),
    count: (userId: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE user_id = ?`).get(userId) as { n: number }).n,
  };
}

export function healthRepo(db: DatabaseSync) {
  return {
    dailies: table<DailyRow>(db, "dailies", DAILY_COLS),
    sleep: table<SleepRow>(db, "sleep", SLEEP_COLS),
    hrv: table<HrvRow>(db, "hrv", HRV_COLS),
  };
}

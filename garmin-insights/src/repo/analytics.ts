import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db.ts";

export type DailyLoadRow = { date: string; trimp: number; tss: number; ctl: number; atl: number; tsb: number };

export function analyticsRepo(db: DatabaseSync) {
  const insert = db.prepare("INSERT OR REPLACE INTO analytics_daily (user_id, date, trimp, tss, ctl, atl, tsb) VALUES (?, ?, ?, ?, ?, ?, ?)");
  return {
    /** Replaces everything from `fromDate` on (the recomputed tail). */
    replaceFrom(userId: string, fromDate: string, rows: DailyLoadRow[]): void {
      transaction(db, () => {
        db.prepare("DELETE FROM analytics_daily WHERE user_id = ? AND date >= ?").run(userId, fromDate);
        for (const r of rows) insert.run(userId, r.date, r.trimp, r.tss, r.ctl, r.atl, r.tsb);
      });
    },
    range: (userId: string, from: string, to: string): DailyLoadRow[] =>
      db.prepare("SELECT date, trimp, tss, ctl, atl, tsb FROM analytics_daily WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date").all(userId, from, to) as DailyLoadRow[],
    lastBefore: (userId: string, date: string): DailyLoadRow | undefined =>
      db.prepare("SELECT date, trimp, tss, ctl, atl, tsb FROM analytics_daily WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 1").get(userId, date) as DailyLoadRow | undefined,
    deleteAll: (userId: string): void => void db.prepare("DELETE FROM analytics_daily WHERE user_id = ?").run(userId),
  };
}

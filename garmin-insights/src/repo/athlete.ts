import type { DatabaseSync } from "node:sqlite";

export type AthleteSettings = {
  valid_from: string;
  hr_max: number | null;
  hr_rest: number | null;
  lthr: number | null;
  ftp: number | null;
  threshold_pace_s_per_km: number | null;
  sex: "m" | "f" | null;
  /** JSON: `{ hr?: number[]; pace?: number[]; power?: number[] }`, lower bounds of the zones. */
  zones_json: string | null;
  source: "garmin" | "manual";
};

const COLS = "valid_from, hr_max, hr_rest, lthr, ftp, threshold_pace_s_per_km, sex, zones_json, source";

// Settings are historised: a row is valid from its date until the next row. Loads are computed with the settings that were
// valid on the day of the activity, so changing the FTP today does not rewrite last year's training stress.
export function athleteRepo(db: DatabaseSync) {
  const upsert = db.prepare(
    `INSERT INTO athlete_settings (user_id, ${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, valid_from) DO UPDATE SET hr_max = excluded.hr_max, hr_rest = excluded.hr_rest, lthr = excluded.lthr,
       ftp = excluded.ftp, threshold_pace_s_per_km = excluded.threshold_pace_s_per_km, sex = excluded.sex,
       zones_json = excluded.zones_json, source = excluded.source`,
  );
  return {
    upsert(userId: string, s: AthleteSettings): void {
      upsert.run(userId, s.valid_from, s.hr_max, s.hr_rest, s.lthr, s.ftp, s.threshold_pace_s_per_km, s.sex, s.zones_json, s.source);
    },
    /** All versions, oldest first. */
    history: (userId: string): AthleteSettings[] =>
      db.prepare(`SELECT ${COLS} FROM athlete_settings WHERE user_id = ? ORDER BY valid_from`).all(userId) as AthleteSettings[],
    /** The version valid on `date` (latest valid_from on or before it), or the oldest one for earlier dates. */
    at(userId: string, date: string): AthleteSettings | undefined {
      return (
        (db.prepare(`SELECT ${COLS} FROM athlete_settings WHERE user_id = ? AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1`).get(userId, date) as AthleteSettings | undefined) ??
        (db.prepare(`SELECT ${COLS} FROM athlete_settings WHERE user_id = ? ORDER BY valid_from LIMIT 1`).get(userId) as AthleteSettings | undefined)
      );
    },
    delete: (userId: string, validFrom: string): void =>
      void db.prepare("DELETE FROM athlete_settings WHERE user_id = ? AND valid_from = ?").run(userId, validFrom),
    deleteAll: (userId: string): void => void db.prepare("DELETE FROM athlete_settings WHERE user_id = ?").run(userId),
  };
}

// Shapes the pages read from the API. The server types (hc<AppType>) are used for requests; responses are narrowed here to
// what the UI needs, so the pages do not depend on every column.
export type ActivityLite = { id: number; date: string; name: string | null; sport: string; distance_m: number | null; duration_s: number | null; tss: number | null };
export type ActivityFull = ActivityLite & {
  start_utc: string; type_key: string; moving_s: number | null; elevation_gain_m: number | null; avg_hr: number | null; max_hr: number | null;
  avg_power: number | null; norm_power: number | null; avg_speed: number | null; max_speed: number | null; calories: number | null; vo2max: number | null;
  te_aerobic: number | null; te_anaerobic: number | null; start_lat: number | null; start_lon: number | null; total_sets: number | null; total_reps: number | null;
  fit_status: "pending" | "done" | "none" | "failed"; trimp: number | null; tss_method: string | null;
};
export type Sample = { t: number; lat: number | null; lon: number | null; alt: number | null; hr: number | null; power: number | null; cadence: number | null; speed: number | null; dist: number | null; temp: number | null };
export type Lap = { idx: number; start_s: number | null; duration_s: number | null; distance_m: number | null; avg_hr: number | null; max_hr: number | null; avg_power: number | null; avg_speed: number | null; avg_cadence: number | null; ascent_m: number | null };
export type Zone = { kind: "hr" | "power" | "pace"; floors: number[]; below: number; seconds: number[]; source: "samples" | "garmin_summary" } | null;
export type SetRow = { idx: number; start_s: number | null; duration_s: number | null; set_type: "active" | "rest"; exercise: string | null; reps: number | null; weight_kg: number | null };

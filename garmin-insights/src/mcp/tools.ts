import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { downsample } from "../analytics/downsample.ts";
import { legOverview, parentHr } from "../analytics/multisport.ts";
import type { PaddleMetrics } from "../analytics/paddling.ts";
import { activityAnalysis, athleteSnapshot, bestEffortsInRange, defaultRange, paddlingTrends, rangeDays, readinessOn, strengthInRange, trendsInRange, volumeInRange, weeklyBalance, zoneDistribution } from "../analytics/queries.ts";
import { analysisSamples } from "../analytics/recompute.ts";
import { strengthVolume } from "../analytics/strength.ts";
import { isDate, todayLocal, weekStart } from "../dates.ts";
import type { KeyService } from "../garmin/keys.ts";
import type { ActivityRow } from "../repo/activities.ts";
import type { Repos } from "../repo/index.ts";
import { SPORTS, type Sport } from "../sport.ts";
import type { SyncWorker } from "../sync/worker.ts";
import type { AppUser } from "../types.ts";

// The MCP tools: a curated set, no SQL. All read-only except trigger_sync, all scoped to the user from the token (the user is
// bound when the server is built, tool arguments cannot name another one). Output is English, metric, JSON as structured
// content (plus the same JSON as text for clients that ignore structured content). Numbers are rounded for readability.

export type McpDeps = { repos: Repos; sync: SyncWorker; keys: KeyService; today?: () => string };

const MAX_DAILY_DAYS = 366;
const MAX_LIST = 100;
const DEFAULT_SAMPLES = 300;
const MAX_SAMPLES = 2000;
const MAX_LAPS = 40;
const HEALTH_POINTS = 120;

const date = z.string().refine(isDate, "date as YYYY-MM-DD");
const sport = z.enum(SPORTS as unknown as [Sport, ...Sport[]]);
const range = { from: date.optional().describe("first day, YYYY-MM-DD"), to: date.optional().describe("last day, YYYY-MM-DD (default: today)") };
const customSport = z.string().min(1).max(100).optional().describe("one of the athlete's own sports by name (see list_custom_sports)");

const round = (v: number | null | undefined, digits = 1): number | null => (v === null || v === undefined ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const result = <T extends object>(output: T) => ({ content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output as Record<string, unknown> });
const failure = (message: string) => ({ isError: true as const, content: [{ type: "text" as const, text: message }] });

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const paddlingOutput = z.object({
  moving_min: z.number(), avg_speed_kmh: z.number(), pace_min_per_500m: z.number(), max_speed_1min_kmh: z.number().nullable(), max_speed_5min_kmh: z.number().nullable(),
  avg_stroke_rate_spm: z.number().nullable(), distance_per_stroke_m: z.number().nullable(), avg_hr_bpm: z.number().nullable(),
  efficiency_kmh_per_bpm_above_rest: z.number().nullable().describe("average speed (km/h) per bpm above resting heart rate; higher = more speed for the same effort"),
});
const paddlingView = (p: PaddleMetrics) => ({
  moving_min: round(p.moving_s / 60, 1)!, avg_speed_kmh: round(p.avg_speed_kmh, 2)!, pace_min_per_500m: round(p.pace_s_per_500m / 60, 2)!,
  max_speed_1min_kmh: round(p.max_speed_1min_kmh, 2), max_speed_5min_kmh: round(p.max_speed_5min_kmh, 2), avg_stroke_rate_spm: round(p.avg_stroke_rate, 1),
  distance_per_stroke_m: round(p.distance_per_stroke_m, 2), avg_hr_bpm: round(p.avg_hr, 0), efficiency_kmh_per_bpm_above_rest: round(p.efficiency, 3),
});

const paceMinPerKm = (speedMps: number | null) => (speedMps && speedMps > 0 ? round(1000 / speedMps / 60, 2) : null);

/** The short form of an activity used in lists and comparisons. */
export function brief(a: ActivityRow) {
  return {
    id: a.id,
    date: a.date,
    start_utc: a.start_utc,
    name: a.name,
    sport: a.sport,
    custom_sport: a.custom_sport,
    garmin_type: a.type_key,
    distance_km: round(a.distance_m === null ? null : a.distance_m / 1000, 2),
    duration_min: round(a.duration_s === null ? null : a.duration_s / 60, 1),
    avg_pace_min_per_km: a.sport === "running" || a.sport === "walking" || a.sport === "hiking" ? paceMinPerKm(a.avg_speed) : null,
    // Indoor sessions report 0 m/s; without a distance there is no speed to speak of.
    avg_speed_kmh: a.avg_speed === null || !a.distance_m ? null : round(a.avg_speed * 3.6, 1),
    avg_hr_bpm: round(a.avg_hr, 0),
    // Cleaned of optical HR artifacts where some were found; the raw value stays available.
    max_hr_bpm: round(a.max_hr_clean ?? a.max_hr, 0),
    max_hr_raw_bpm: round(a.max_hr, 0),
    hr_artifact_s: a.hr_artifact_s,
    avg_power_w: round(a.avg_power, 0),
    normalized_power_w: round(a.norm_power, 0),
    elevation_gain_m: round(a.elevation_gain_m, 0),
    training_stress: round(a.tss, 0),
    training_stress_method: a.tss_method,
    trimp: round(a.trimp, 0),
  };
}
const briefSchema = z.object({
  id: z.number(), date: z.string(), start_utc: z.string(), name: z.string().nullable(), sport: z.string(), custom_sport: z.string().nullable(), garmin_type: z.string(),
  distance_km: z.number().nullable(), duration_min: z.number().nullable(), avg_pace_min_per_km: z.number().nullable(), avg_speed_kmh: z.number().nullable(),
  avg_hr_bpm: z.number().nullable(), max_hr_bpm: z.number().nullable().describe("cleaned of measurement artifacts"),
  max_hr_raw_bpm: z.number().nullable().describe("as recorded"), hr_artifact_s: z.number().nullable().describe("seconds of heart rate removed as artifacts; null = not checked"),
  avg_power_w: z.number().nullable(), normalized_power_w: z.number().nullable(),
  elevation_gain_m: z.number().nullable(), training_stress: z.number().nullable(), training_stress_method: z.string().nullable(), trimp: z.number().nullable(),
});

const legSchema = z.object({
  id: z.number(), sport: z.string(), garmin_type: z.string(), start_offset_s: z.number(), duration_s: z.number().nullable(), avg_hr: z.number().nullable(), tss: z.number().nullable(),
});

const interpretForm = (tsb: number) =>
  tsb > 15 ? "very fresh (rested or detraining)" : tsb > 5 ? "fresh" : tsb >= -10 ? "neutral" : tsb >= -30 ? "productive training load" : "very fatigued (overreaching risk)";

export function registerTools(server: McpServer, deps: McpDeps, user: AppUser): void {
  const { repos } = deps;
  const uid = user.id;
  const today = () => (deps.today ?? todayLocal)();
  const resolveRange = (q: { from?: string; to?: string }, days: number) => defaultRange(q.from, q.to, days, today());
  /** The user's own sport by name -> filter; `undefined` id with an error message when the name is unknown. */
  const resolveCustomSport = (name: string | undefined): { customSportId?: number; error?: string } => {
    if (name === undefined) return {};
    const id = repos.customSports.idByName(uid, name);
    return id === undefined ? { error: `Unknown custom sport '${name}'. Known: ${repos.customSports.list(uid).map((s) => s.name).join(", ") || "none"}.` } : { customSportId: id };
  };
  const rangeError = (r: { from: string; to: string }) => (rangeDays(r) < 1 ? "'from' must not be after 'to'" : rangeDays(r) > 3700 ? "range too long (max 10 years)" : null);

  server.registerTool(
    "list_activities",
    {
      title: "List activities",
      description: "Lists the user's synced activities (newest first by default) with the main metrics. Filter by sport and date range, page with offset. Use get_activity for the details of one.",
      inputSchema: z.object({
        sport: sport.optional(), custom_sport: customSport, ...range,
        limit: z.number().int().min(1).max(MAX_LIST).default(20), offset: z.number().int().min(0).default(0), order: z.enum(["desc", "asc"]).default("desc"),
      }),
      outputSchema: z.object({ total: z.number(), returned: z.number(), activities: z.array(briefSchema.extend({ legs_count: z.number().optional() })) }),
      annotations: readOnly,
    },
    async (q) => {
      const cs = resolveCustomSport(q.custom_sport);
      if (cs.error) return failure(cs.error);
      const f = { sport: q.sport, customSportId: cs.customSportId, from: q.from, to: q.to, topLevel: true };
      const rows = repos.activities.list(uid, { ...f, limit: q.limit, offset: q.offset, order: q.order });
      // Multisport parents: how many legs (see get_activity), and the average and cleaned max HR from them.
      const activities = rows.map((a) => {
        if (!a.is_multisport_parent) return brief(a);
        const legs = repos.activities.legs(uid, a.id);
        return { ...brief(parentHr(a, legs)), legs_count: legs.length };
      });
      return result({ total: repos.activities.count(uid, f), returned: rows.length, activities });
    },
  );

  server.registerTool(
    "get_activity",
    {
      title: "Get activity",
      description:
        "Details of one activity: metrics, laps, multisport legs (each leg is an activity of its own; a leg names its parent), time in heart-rate/power/pace zones, aerobic decoupling (Pa:Hr, positive = efficiency dropped), best efforts (running), mean-maximal power (cycling), paddling metrics (speed, pace per 500 m, stroke rate, efficiency) and strength totals. Time series are available through get_activity_samples.",
      inputSchema: z.object({ activity_id: z.number().int().positive() }),
      outputSchema: z.object({
        activity: briefSchema,
        details_available: z.boolean(),
        parent_activity_id: z.number().nullable(),
        legs: z.array(legSchema),
        extra: z.object({ calories: z.number().nullable(), vo2max: z.number().nullable(), training_effect_aerobic: z.number().nullable(), training_effect_anaerobic: z.number().nullable() }),
        laps: z.array(z.object({ lap: z.number(), distance_km: z.number().nullable(), duration_s: z.number().nullable(), avg_pace_min_per_km: z.number().nullable(), avg_hr_bpm: z.number().nullable(), avg_power_w: z.number().nullable() })),
        zones: z.record(z.string(), z.object({ zone_lower_bounds: z.array(z.number()), seconds_below_zone_1: z.number(), seconds_per_zone: z.array(z.number()), source: z.string() })),
        decoupling_pct: z.number().nullable(),
        best_efforts: z.array(z.object({ distance_m: z.number(), seconds: z.number(), start_s: z.number() })),
        mean_max_power: z.array(z.object({ seconds: z.number(), watts: z.number() })),
        strength: z.object({ total_volume_kg: z.number(), exercises: z.array(z.object({ exercise: z.string(), sets: z.number(), reps: z.number(), volume_kg: z.number(), max_weight_kg: z.number().nullable() })) }).nullable(),
        paddling: paddlingOutput.optional(),
      }),
      annotations: readOnly,
    },
    async ({ activity_id }) => {
      const a = repos.activities.get(uid, activity_id);
      if (!a) return failure("Activity not found.");
      const analysis = activityAnalysis(repos, uid, a);
      const zones = Object.fromEntries(
        Object.entries(analysis.zones)
          .filter(([, z]) => z)
          .map(([k, z]) => [k, { zone_lower_bounds: z!.floors, seconds_below_zone_1: Math.round(z!.below), seconds_per_zone: z!.seconds.map(Math.round), source: z!.source }]),
      );
      const sets = repos.activities.sets(uid, activity_id);
      const strength = sets.length ? strengthVolume(sets) : null;
      const legs = repos.activities.legs(uid, activity_id);
      return result({
        activity: brief(parentHr(a, legs)),
        details_available: a.fit_status === "done",
        parent_activity_id: a.parent_id,
        legs: legOverview(a, legs),
        extra: { calories: round(a.calories, 0), vo2max: round(a.vo2max, 0), training_effect_aerobic: round(a.te_aerobic), training_effect_anaerobic: round(a.te_anaerobic) },
        laps: repos.activities.laps(uid, activity_id).slice(0, MAX_LAPS).map((l) => ({
          lap: l.idx + 1, distance_km: round(l.distance_m === null ? null : l.distance_m / 1000, 2), duration_s: round(l.duration_s, 0),
          avg_pace_min_per_km: paceMinPerKm(l.avg_speed), avg_hr_bpm: round(l.avg_hr, 0), avg_power_w: round(l.avg_power, 0),
        })),
        zones,
        decoupling_pct: round(analysis.decoupling_pct),
        best_efforts: analysis.best_efforts.map((e) => ({ distance_m: e.distance, seconds: round(e.seconds, 1)!, start_s: Math.round(e.startT) })),
        mean_max_power: analysis.mean_max_power.map((p) => ({ seconds: p.seconds, watts: round(p.watts, 0)! })),
        ...(analysis.paddling ? { paddling: paddlingView(analysis.paddling) } : {}),
        strength: strength && { total_volume_kg: round(strength.totalVolumeKg, 0)!, exercises: strength.byExercise.map((e) => ({ exercise: e.exercise, sets: e.sets, reps: e.reps, volume_kg: round(e.volume_kg, 0)!, max_weight_kg: e.max_weight_kg })) },
      });
    },
  );

  const SAMPLE_FIELDS = ["hr", "power", "speed", "altitude", "cadence", "distance"] as const;
  server.registerTool(
    "get_activity_samples",
    {
      title: "Get activity time series",
      description:
        "Second-by-second recordings of an activity as columns, downsampled to max_points (default 300) and optionally cut to a time window. Units: hr bpm, power W, speed m/s, altitude m, cadence rpm/spm, distance m. Use a window (from_s, to_s) to zoom in. Heart-rate artifacts (spikes, drop-outs) are null unless clean_hr is false.",
      inputSchema: z.object({
        activity_id: z.number().int().positive(),
        from_s: z.number().int().min(0).optional().describe("window start, seconds since the activity started"), to_s: z.number().int().min(0).optional(),
        max_points: z.number().int().min(10).max(MAX_SAMPLES).default(DEFAULT_SAMPLES),
        fields: z.array(z.enum(SAMPLE_FIELDS)).min(1).default(["hr", "speed", "power", "altitude"]),
        clean_hr: z.boolean().default(true).describe("false = raw heart rate including measurement artifacts"),
      }),
      outputSchema: z.object({ activity_id: z.number(), samples_in_window: z.number(), returned: z.number(), t_s: z.array(z.number()), series: z.record(z.string(), z.array(z.number().nullable())) }),
      annotations: readOnly,
    },
    async (q) => {
      const a = repos.activities.get(uid, q.activity_id);
      if (!a) return failure("Activity not found.");
      if (a.fit_status !== "done") return failure("No detailed recording is available for this activity (file missing or still loading).");
      const win = { from: q.from_s, to: q.to_s };
      const rows = q.clean_hr ? analysisSamples(repos, uid, a, win) : repos.activities.samples(uid, q.activity_id, win);
      const picked = downsample(rows, q.max_points);
      const column = { hr: (s: (typeof rows)[number]) => s.hr, power: (s: (typeof rows)[number]) => s.power, speed: (s: (typeof rows)[number]) => round(s.speed, 2), altitude: (s: (typeof rows)[number]) => round(s.alt, 1), cadence: (s: (typeof rows)[number]) => s.cadence, distance: (s: (typeof rows)[number]) => round(s.dist, 0) };
      return result({
        activity_id: q.activity_id,
        samples_in_window: rows.length,
        returned: picked.length,
        t_s: picked.map((s) => s.t),
        series: Object.fromEntries([...new Set(q.fields)].map((f) => [f, picked.map(column[f])])),
      });
    },
  );

  server.registerTool(
    "get_strength_sets",
    {
      title: "Get strength sets",
      description: "Strength training from Garmin's recorded sets. With activity_id: every set (exercise category, reps, weight in kg) and totals. With from/to: volume (reps x kg) per exercise and muscle group over the range. Volume counts active sets only.",
      inputSchema: z.object({ activity_id: z.number().int().positive().optional(), ...range }),
      outputSchema: z.object({
        sets: z.array(z.object({ set: z.number(), type: z.string(), exercise: z.string().nullable(), reps: z.number().nullable(), weight_kg: z.number().nullable(), duration_s: z.number().nullable() })),
        by_exercise: z.array(z.object({ exercise: z.string(), muscle_group: z.string(), sets: z.number(), reps: z.number(), volume_kg: z.number(), max_weight_kg: z.number().nullable(), best_estimated_1rm_kg: z.number().nullable() })),
        by_muscle_group: z.array(z.object({ group: z.string(), sets: z.number(), volume_kg: z.number() })),
        total_volume_kg: z.number(),
      }),
      annotations: readOnly,
    },
    async (q) => {
      let summary;
      let sets: { set: number; type: string; exercise: string | null; reps: number | null; weight_kg: number | null; duration_s: number | null }[] = [];
      if (q.activity_id !== undefined) {
        if (!repos.activities.has(uid, q.activity_id)) return failure("Activity not found.");
        const rows = repos.activities.sets(uid, q.activity_id);
        sets = rows.map((s) => ({ set: s.idx + 1, type: s.set_type, exercise: s.exercise, reps: s.reps, weight_kg: s.weight_kg, duration_s: round(s.duration_s, 0) }));
        summary = strengthVolume(rows);
      } else {
        const r = resolveRange(q, 90);
        const err = rangeError(r);
        if (err) return failure(err);
        summary = strengthInRange(repos, uid, r);
      }
      return result({
        sets,
        by_exercise: summary.byExercise.map((e) => ({ exercise: e.exercise, muscle_group: e.muscle_group, sets: e.sets, reps: e.reps, volume_kg: round(e.volume_kg, 0)!, max_weight_kg: e.max_weight_kg, best_estimated_1rm_kg: round(e.best_e1rm_kg) })),
        by_muscle_group: summary.byMuscleGroup.map((g) => ({ group: g.group, sets: g.sets, volume_kg: round(g.volume_kg, 0)! })),
        total_volume_kg: round(summary.totalVolumeKg, 0)!,
      });
    },
  );

  server.registerTool(
    "compare_activities",
    {
      title: "Compare activities",
      description: "Puts 2 to 5 activities side by side (same metrics as list_activities) and gives each one's difference to the first. Useful for the same route or workout on different days.",
      inputSchema: z.object({ activity_ids: z.array(z.number().int().positive()).min(2).max(5) }),
      outputSchema: z.object({ activities: z.array(briefSchema), differences_to_first: z.array(z.object({ id: z.number(), distance_km: z.number().nullable(), duration_min: z.number().nullable(), avg_hr_bpm: z.number().nullable(), avg_power_w: z.number().nullable(), avg_speed_kmh: z.number().nullable(), training_stress: z.number().nullable() })) }),
      annotations: readOnly,
    },
    async ({ activity_ids }) => {
      const rows = activity_ids.map((id) => repos.activities.get(uid, id));
      const missing = activity_ids.filter((_, i) => !rows[i]);
      if (missing.length) return failure(`Activities not found: ${missing.join(", ")}.`);
      const [first, ...rest] = rows.map((a) => brief(a!));
      const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : round(a - b, 2));
      return result({
        activities: [first!, ...rest],
        differences_to_first: rest.map((a) => ({
          id: a.id, distance_km: delta(a.distance_km, first!.distance_km), duration_min: delta(a.duration_min, first!.duration_min), avg_hr_bpm: delta(a.avg_hr_bpm, first!.avg_hr_bpm),
          avg_power_w: delta(a.avg_power_w, first!.avg_power_w), avg_speed_kmh: delta(a.avg_speed_kmh, first!.avg_speed_kmh), training_stress: delta(a.training_stress, first!.training_stress),
        })),
      });
    },
  );

  server.registerTool(
    "get_training_load",
    {
      title: "Get training load (fitness, fatigue, form)",
      description:
        "Performance management chart. Per day: training stress (TSS-like load of all sports), CTL = fitness (42-day exponential average), ATL = fatigue (7-day), TSB = form (yesterday's CTL minus ATL; above +5 fresh, -10 to -30 productive, below -30 overreaching risk). granularity 'weekly' returns one row per week (week-ending CTL/ATL/TSB, summed load) and adds the weekly balance: acwr (acute:chronic workload ratio, mean daily load of the last 7 days over the last 28; 0.8-1.3 is the sweet spot), monotony (Foster: mean daily load over its standard deviation, rest days count as 0; above 2 is a warning, null without variation), strain (load x monotony), intensity_split_pct (easy = heart-rate zones 1-2, moderate = zone 3, hard = zones 4-5, share of zoned time) and sport_mix (duration and load per sport). The last week only counts the days up to 'to'. Optional 'custom_sport' or 'sport' (weekly only) limits training_stress, monotony, acwr, strain, the split and the mix to that sport; ctl, atl and tsb stay whole-athlete values. Default range: last 90 days.",
      inputSchema: z.object({ ...range, granularity: z.enum(["daily", "weekly"]).default("daily"), sport: sport.optional(), custom_sport: customSport }),
      outputSchema: z.object({
        range: z.object({ from: z.string(), to: z.string() }),
        latest: z.object({ date: z.string(), ctl: z.number(), atl: z.number(), tsb: z.number(), form: z.string() }).nullable(),
        series: z.array(z.object({
          date: z.string(), training_stress: z.number(), trimp: z.number(), ctl: z.number(), atl: z.number(), tsb: z.number(),
          week_start: z.string().optional(), acwr: z.number().nullable().optional(), monotony: z.number().nullable().optional(), strain: z.number().nullable().optional(),
          intensity_split_pct: z.object({ easy: z.number(), moderate: z.number(), hard: z.number() }).nullable().optional(),
          sport_mix: z.array(z.object({ sport: z.string(), duration_min: z.number(), training_stress: z.number() })).optional(),
        })),
      }),
      annotations: readOnly,
    },
    async (q) => {
      const r = resolveRange(q, 90);
      const err = rangeError(r);
      if (err) return failure(err);
      const cs = resolveCustomSport(q.custom_sport);
      if (cs.error) return failure(cs.error);
      const filtered = q.sport !== undefined || cs.customSportId !== undefined;
      if (filtered && q.granularity === "daily") return failure("Sport filters are only supported with granularity 'weekly'.");
      if (q.granularity === "daily" && rangeDays(r) > MAX_DAILY_DAYS) return failure(`Daily rows are limited to ${MAX_DAILY_DAYS} days; use granularity 'weekly' for longer ranges.`);
      const rows = repos.analytics.range(uid, r.from, r.to);
      const daily = rows.map((d) => ({ date: d.date, training_stress: round(d.tss, 0)!, trimp: round(d.trimp, 0)!, ctl: round(d.ctl)!, atl: round(d.atl)!, tsb: round(d.tsb)! }));
      let series: Record<string, unknown>[] = daily;
      if (q.granularity === "weekly") {
        const weeks = new Map<string, (typeof daily)[number]>();
        for (const d of daily) {
          const key = weekStart(d.date);
          const w = weeks.get(key);
          weeks.set(key, { ...d, training_stress: round((w?.training_stress ?? 0) + d.training_stress, 0)!, trimp: round((w?.trimp ?? 0) + d.trimp, 0)! });
        }
        const balance = new Map(weeklyBalance(repos, uid, { ...r, sport: q.sport, customSportId: cs.customSportId }).map((w) => [w.week, w]));
        series = [...weeks.values()].map((w) => {
          const b = balance.get(weekStart(w.date))!;
          return {
            ...w, ...(filtered ? { training_stress: round(b.load, 0)! } : {}), week_start: b.week, acwr: b.acwr, monotony: b.monotony, strain: b.strain, intensity_split_pct: b.intensity_pct,
            sport_mix: b.sport_mix.map((x) => ({ sport: x.sport, duration_min: round(x.duration_s / 60, 0)!, training_stress: round(x.tss, 0)! })),
          };
        });
      }
      const last = rows.at(-1);
      return result({ range: r, latest: last ? { date: last.date, ctl: round(last.ctl)!, atl: round(last.atl)!, tsb: round(last.tsb)!, form: interpretForm(last.tsb) } : null, series });
    },
  );

  server.registerTool(
    "get_zone_distribution",
    {
      title: "Get zone distribution",
      description: "Total seconds spent in each heart-rate, power or pace zone over a date range (optionally one sport). Zone bounds are the athlete's settings valid at the time (see get_athlete_settings); activities without a detailed recording use Garmin's own zone times. Pace zones are given as lower bounds in m/s. Default range: last 90 days.",
      inputSchema: z.object({ kind: z.enum(["hr", "power", "pace"]).default("hr"), sport: sport.optional(), custom_sport: customSport, ...range }),
      outputSchema: z.object({ kind: z.string(), activities_counted: z.number(), zone_lower_bounds: z.array(z.number()), seconds_below_zone_1: z.number(), seconds_per_zone: z.array(z.number()), share_per_zone_pct: z.array(z.number()), source: z.string() }),
      annotations: readOnly,
    },
    async (q) => {
      const r = resolveRange(q, 90);
      const err = rangeError(r);
      if (err) return failure(err);
      const cs = resolveCustomSport(q.custom_sport);
      if (cs.error) return failure(cs.error);
      const z = zoneDistribution(repos, uid, { ...r, kind: q.kind, sport: q.sport, customSportId: cs.customSportId });
      const total = z.seconds.reduce((a, b) => a + b, 0);
      return result({
        kind: z.kind, activities_counted: z.activities, zone_lower_bounds: z.floors, seconds_below_zone_1: Math.round(z.below), seconds_per_zone: z.seconds.map(Math.round),
        share_per_zone_pct: z.seconds.map((s) => (total ? round((s / total) * 100)! : 0)), source: z.source,
      });
    },
  );

  server.registerTool(
    "get_volume",
    {
      title: "Get training volume",
      description: "Training volume per week (starting Monday) or month and sport (the athlete's own sport where one is assigned): number of activities, distance, duration, elevation gain, training stress. `period` is the first day of the period. Default range: last 12 weeks.",
      inputSchema: z.object({ by: z.enum(["week", "month"]).default("week"), sport: sport.optional(), custom_sport: customSport, ...range }),
      outputSchema: z.object({ rows: z.array(z.object({ period: z.string(), sport: z.string(), activities: z.number(), distance_km: z.number(), duration_h: z.number(), elevation_gain_m: z.number(), training_stress: z.number() })) }),
      annotations: readOnly,
    },
    async (q) => {
      const r = resolveRange(q, 84);
      const err = rangeError(r);
      if (err) return failure(err);
      const cs = resolveCustomSport(q.custom_sport);
      if (cs.error) return failure(cs.error);
      const rows = volumeInRange(repos, uid, { ...r, by: q.by, sport: q.sport, customSportId: cs.customSportId });
      return result({ rows: rows.map((v) => ({ period: v.period, sport: v.sport, activities: v.count, distance_km: round(v.distance_m / 1000)!, duration_h: round(v.duration_s / 3600, 2)!, elevation_gain_m: round(v.elevation_gain_m, 0)!, training_stress: round(v.tss, 0)! })) });
    },
  );

  server.registerTool(
    "get_best_efforts",
    {
      title: "Get best efforts",
      description: "Personal bests in a date range from Garmin's per-activity records. Running: fastest time for 1 km, 1 mile, 5 km, 10 km, half and full marathon. Cycling: best average power for 1 s to 5 h (power curve). Each entry names the activity and date. Default range: last 12 months.",
      inputSchema: z.object({ sport: z.enum(["running", "cycling"]).default("running"), custom_sport: customSport, ...range }),
      outputSchema: z.object({
        sport: z.string(),
        running: z.array(z.object({ distance_m: z.number(), seconds: z.number(), pace_min_per_km: z.number().nullable(), activity_id: z.number(), date: z.string() })),
        power_curve: z.array(z.object({ seconds: z.number(), watts: z.number(), activity_id: z.number(), date: z.string() })),
      }),
      annotations: readOnly,
    },
    async (q) => {
      const r = resolveRange(q, 365);
      const err = rangeError(r);
      if (err) return failure(err);
      const cs = resolveCustomSport(q.custom_sport);
      if (cs.error) return failure(cs.error);
      const b = bestEffortsInRange(repos, uid, { ...r, sport: q.sport, customSportId: cs.customSportId });
      return result({
        sport: q.sport,
        running: b.efforts.map((e) => ({ distance_m: e.distance_m, seconds: round(e.seconds, 1)!, pace_min_per_km: round(e.seconds / 60 / (e.distance_m / 1000), 2), activity_id: e.activity_id, date: e.date })),
        power_curve: b.power_curve.map((p) => ({ seconds: p.seconds, watts: round(p.watts, 0)!, activity_id: p.activity_id, date: p.date })),
      });
    },
  );

  server.registerTool(
    "get_paddling_trends",
    {
      title: "Get paddling trends",
      description: "Weekly paddling (SUP, kayak, dragon boat, outrigger) per group: distance, moving time, average speed (total distance over moving time) and mean efficiency (km/h per bpm above resting HR). Activities are grouped by the athlete's own sport where one is assigned (e.g. OC1, dragon boat), else 'paddling'. Default range: last 180 days.",
      inputSchema: z.object({ custom_sport: customSport, ...range }),
      outputSchema: z.object({
        weeks: z.array(z.object({ week_start: z.string(), group: z.string(), activities: z.number(), distance_km: z.number(), moving_min: z.number(), avg_speed_kmh: z.number().nullable(), avg_efficiency_kmh_per_bpm_above_rest: z.number().nullable() })),
      }),
      annotations: readOnly,
    },
    async (q) => {
      const r = resolveRange(q, 180);
      const err = rangeError(r);
      if (err) return failure(err);
      const cs = resolveCustomSport(q.custom_sport);
      if (cs.error) return failure(cs.error);
      return result({
        weeks: paddlingTrends(repos, uid, { ...r, customSportId: cs.customSportId }).map((w) => ({
          week_start: w.week, group: w.group, activities: w.count, distance_km: round(w.distance_m / 1000, 2)!, moving_min: round(w.duration_s / 60, 0)!,
          avg_speed_kmh: round(w.avg_speed_kmh, 2), avg_efficiency_kmh_per_bpm_above_rest: round(w.avg_efficiency, 3),
        })),
      });
    },
  );

  const metric = z.object({ avg_last_7_days: z.number().nullable(), baseline_28_days_before: z.number().nullable(), delta: z.number().nullable() });
  server.registerTool(
    "get_health_trends",
    {
      title: "Get health trends",
      description: "Resting heart rate, overnight HRV and sleep duration (hours) with 7-day averages, the last 7 days against the 28 days before, and the correlation of each with the 7-day training load (ATL). A rising resting HR or falling HRV together with rising load points to accumulated fatigue. Default range: last 90 days; long ranges are thinned to about 120 points.",
      inputSchema: z.object({ ...range }),
      outputSchema: z.object({
        latest: z.object({ resting_hr_bpm: metric, hrv_ms: metric, sleep_hours: metric }),
        correlation_with_atl: z.object({ resting_hr: z.number().nullable(), hrv: z.number().nullable(), sleep: z.number().nullable() }),
        points: z.array(z.object({ date: z.string(), resting_hr_bpm: z.number().nullable(), hrv_ms: z.number().nullable(), sleep_hours: z.number().nullable(), atl: z.number().nullable() })),
      }),
      annotations: readOnly,
    },
    async (q) => {
      const r = resolveRange(q, 90);
      const err = rangeError(r);
      if (err) return failure(err);
      const t = trendsInRange(repos, uid, r);
      const m = (x: { avg7: number | null; baseline28: number | null; deltaVsBaseline: number | null }) => ({ avg_last_7_days: round(x.avg7, 1), baseline_28_days_before: round(x.baseline28, 1), delta: round(x.deltaVsBaseline, 1) });
      return result({
        latest: { resting_hr_bpm: m(t.latest.restingHr), hrv_ms: m(t.latest.hrv), sleep_hours: m(t.latest.sleepHours) },
        correlation_with_atl: { resting_hr: round(t.correlations.restingHrVsAtl, 2), hrv: round(t.correlations.hrvVsAtl, 2), sleep: round(t.correlations.sleepVsAtl, 2) },
        points: downsample(t.points, HEALTH_POINTS).map((p) => ({ date: p.date, resting_hr_bpm: p.restingHr, hrv_ms: p.hrv, sleep_hours: round(p.sleepHours, 1), atl: round(p.atl, 1) })),
      });
    },
  );

  server.registerTool(
    "get_athlete_settings",
    {
      title: "Get athlete settings",
      description: "The thresholds the analyses use today (max and resting heart rate, lactate threshold HR, FTP, threshold pace in s/km, sex for the TRIMP formula), where they come from (Garmin or manual), their history, and the zone lower bounds in effect.",
      inputSchema: z.object({}),
      outputSchema: z.object({ current: z.record(z.string(), z.unknown()).nullable(), history: z.array(z.record(z.string(), z.unknown())), zone_lower_bounds: z.object({ hr: z.array(z.number()).nullable(), pace_mps: z.array(z.number()).nullable(), power: z.array(z.number()).nullable() }) }),
      annotations: readOnly,
    },
    async () => {
      const s = athleteSnapshot(repos, uid, today());
      const clean = (v: object | null) => (v ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "zones_json")) : null);
      return result({ current: clean(s.current), history: s.history.map((h) => clean(h)!), zone_lower_bounds: { hr: s.effectiveZones.hr, pace_mps: s.effectiveZones.pace, power: s.effectiveZones.power } });
    },
  );

  server.registerTool(
    "trigger_sync",
    {
      title: "Sync with Garmin now",
      description: "Starts a sync with Garmin in the background (new activities and health data). It returns immediately; the data appears in the other tools when the sync is done, which can take a few minutes after a first connection.",
      inputSchema: z.object({}),
      outputSchema: z.object({ started: z.boolean(), already_running: z.boolean(), last_finished_at: z.string().nullable() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      if (deps.keys.status(uid).status !== "ok") return failure("No usable Garmin key is stored for this user. The key has to be entered in the app's settings.");
      const running = deps.sync.isRunning(uid);
      void deps.sync.trigger(uid);
      return result({ started: !running, already_running: running, last_finished_at: deps.sync.progress(uid).finishedAt });
    },
  );

  server.registerTool(
    "list_custom_sports",
    {
      title: "List custom sports",
      description: "The athlete's own sports (e.g. 'Dragon boat'), each with the Garmin activity types it is based on and the number of activities assigned. Pass a name as 'custom_sport' to the other tools to filter by it.",
      inputSchema: z.object({}),
      outputSchema: z.object({ custom_sports: z.array(z.object({ name: z.string(), garmin_types: z.array(z.string()), activities: z.number() })) }),
      annotations: readOnly,
    },
    async () => result({ custom_sports: repos.customSports.listDetailed(uid).map((s) => ({ name: s.name, garmin_types: s.type_keys, activities: s.activity_count })) }),
  );

  server.registerTool(
    "get_readiness",
    {
      title: "Get readiness",
      description: "Readiness of one day: overnight HRV (against Garmin's baseline, else the 28-day average), resting heart rate (deviation from the 28-day average in bpm), sleep (duration, against the 28-day average and a minimum), body battery peak and training form (TSB). Each component is good, watch, poor or unknown (no data) with a reason; the overall status is the worst known component. Default date: today.",
      inputSchema: z.object({ date: date.optional().describe("YYYY-MM-DD (default: today)") }),
      outputSchema: z.object({
        date: z.string(), status: z.enum(["good", "watch", "poor", "unknown"]),
        components: z.array(z.object({ key: z.enum(["hrv", "resting_hr", "sleep", "body_battery", "tsb"]), value: z.number().nullable(), reference: z.number().nullable(), status: z.enum(["good", "watch", "poor", "unknown"]), reason: z.string() })),
      }),
      annotations: readOnly,
    },
    async (q) => {
      const r = readinessOn(repos, uid, q.date ?? today());
      return result({ ...r, components: r.components.map((c) => ({ ...c, value: round(c.value, 1), reference: round(c.reference, 1) })) });
    },
  );
}

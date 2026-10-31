import { addDays, diffDays, todayLocal } from "../dates.ts";
import { fitFromZip, type FitStore } from "../fit/store.ts";
import { parseFit, sessionAt, sliceSession, type ParsedFit } from "../fit/parse.ts";
import { GarminKeyError, type GarminApi } from "../garmin/client.ts";
import { logger } from "../log.ts";
import type { Repos } from "../repo/index.ts";
import { isSyncMarker, type SyncKind, type SyncMarker } from "../repo/sync-state.ts";
import { mapActivity, mapDaily, mapHeartRateZones, mapHrv, mapMultisport, mapSleep } from "./map.ts";

const log = logger("sync");

// Pulls a user's Garmin data into the local mirror. Per data kind a cursor remembers how far back the backfill has come;
// every run first fetches the newest data (so the dashboard fills immediately) and then walks backwards in windows until the
// history is exhausted. All limits come from the Swagger spec (docs/garmin-api.md): dailies up to a year per request, sleep
// 31 days, activities by date window (the spec gives no window limit; 90 days keeps pages small).

export const FLOOR_DATE = "2005-01-01"; // before Garmin Connect existed in a usable form: the backfill never goes further
const REFRESH_OVERLAP_DAYS = 3; // re-fetch the last days on every run, late-arriving data (sleep, HRV) lands there
const ACTIVITY_WINDOW_DAYS = 90;
const ACTIVITY_PAGE_SIZE = 99;
const MAX_PAGES_PER_WINDOW = 200;
const FIT_BATCH = 25;
const DEFAULT_MAX_RUN_MS = 30 * 60 * 1000;
const RESUME_DELAY_MS = 60_000;

type RangeKind = Exclude<SyncKind, "fit" | "zones" | SyncMarker>;
type RangeSpec = { windowDays: number; emptyStop: number };
const RANGES: Record<RangeKind, RangeSpec> = {
  activities: { windowDays: ACTIVITY_WINDOW_DAYS, emptyStop: 8 }, // two years without a single activity ends the backfill
  dailies: { windowDays: 365, emptyStop: 2 },
  sleep: { windowDays: 31, emptyStop: 12 },
  hrv: { windowDays: 28, emptyStop: 12 },
};

export type SyncProgress = {
  running: boolean;
  phase: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  kinds: { kind: SyncKind; cursor: string | null; backfillDone: boolean; items: number; lastSyncAt: string | null; lastError: string | null }[];
  fit: { done: number; pending: number };
};

export type SyncDeps = {
  repos: Repos;
  garmin: (userId: string) => GarminApi;
  fit: FitStore;
  /** Garmin refused the key. */
  onKeyInvalid: (userId: string) => Promise<void>;
  /** New or changed data from `fromDate` on: recompute loads and the PMC. */
  onChanged: (userId: string, fromDate: string) => void;
  today?: () => string;
  now?: () => number;
  maxRunMs?: number;
};

export function createSyncWorker(deps: SyncDeps) {
  const { repos } = deps;
  const today = deps.today ?? (() => todayLocal());
  const now = deps.now ?? Date.now;
  const maxRunMs = deps.maxRunMs ?? DEFAULT_MAX_RUN_MS;

  const running = new Map<string, Promise<void>>();
  const live = new Map<string, { phase: string | null; startedAt: string | null; finishedAt: string | null; error: string | null }>();
  const liveOf = (userId: string) => live.get(userId) ?? { phase: null, startedAt: null, finishedAt: null, error: null };

  function progress(userId: string): SyncProgress {
    const l = liveOf(userId);
    const pending = repos.activities.pendingFitCount(userId);
    const total = repos.activities.count(userId);
    return {
      running: running.has(userId),
      phase: l.phase,
      startedAt: l.startedAt,
      finishedAt: l.finishedAt,
      error: l.error,
      kinds: repos.syncState.all(userId).filter((r) => !isSyncMarker(r.kind)).map((r) => ({
        kind: r.kind,
        cursor: r.cursor,
        backfillDone: r.backfill_done === 1,
        items: r.items,
        lastSyncAt: r.last_sync_at,
        lastError: r.last_error,
      })),
      fit: { done: total - pending, pending },
    };
  }

  /** Walks windows from the newest data backwards. Returns the oldest date at which something changed. */
  async function syncRange(userId: string, kind: RangeKind, fetchWindow: (start: string, end: string) => Promise<number>, deadline: number): Promise<string | null> {
    const spec = RANGES[kind];
    const state = repos.syncState.get(userId, kind);
    const t = today();
    let touched: string | null = null;
    let items = state?.items ?? 0;

    // 1) The newest data: from a few days before the last successful run, or the first window.
    const lastRun = state?.last_sync_at?.slice(0, 10);
    const freshStart = lastRun ? addDays(lastRun, -REFRESH_OVERLAP_DAYS) : addDays(t, -(spec.windowDays - 1));
    // After a long pause the gap can exceed what one request allows, so it is fetched in window-sized chunks.
    let fresh = 0;
    for (let from = freshStart; from <= t; from = addDays(from, spec.windowDays)) {
      fresh += await fetchWindow(from, addDays(from, spec.windowDays - 1) < t ? addDays(from, spec.windowDays - 1) : t);
    }
    items += fresh;
    if (fresh) touched = freshStart;
    let cursor = state?.cursor ?? freshStart;
    if (freshStart < cursor) cursor = freshStart;
    repos.syncState.save(userId, kind, { cursor, items, last_error: null });

    // 2) The backfill, one window per step, with the cursor saved after each so a restart resumes.
    let done = state?.backfill_done === 1;
    let empty = 0;
    while (!done && now() < deadline) {
      const end = addDays(cursor, -1);
      if (end < FLOOR_DATE) {
        done = true;
        break;
      }
      const start = addDays(end, -(spec.windowDays - 1));
      const found = await fetchWindow(start < FLOOR_DATE ? FLOOR_DATE : start, end);
      items += found;
      empty = found ? 0 : empty + 1;
      if (found) touched = !touched || start < touched ? start : touched;
      cursor = start;
      done = empty >= spec.emptyStop || start <= FLOOR_DATE;
      repos.syncState.save(userId, kind, { cursor, items, backfill_done: done ? 1 : 0 });
    }
    repos.syncState.save(userId, kind, { last_sync_at: new Date(now()).toISOString(), backfill_done: done ? 1 : 0 });
    return touched;
  }

  async function fetchActivities(userId: string, api: GarminApi, start: string, end: string): Promise<number> {
    let stored = 0;
    for (let page = 0; page < MAX_PAGES_PER_WINDOW; page++) {
      const batch = await api.searchActivities({ startDate: start, endDate: end, start: page * ACTIVITY_PAGE_SIZE, limit: ACTIVITY_PAGE_SIZE });
      for (const dto of batch) {
        const row = mapActivity(dto);
        if (!row) continue;
        const known = repos.activities.has(userId, row.id);
        repos.activities.upsertSummary(userId, row);
        repos.activities.setMultisport(userId, row.id, mapMultisport(dto));
        if (!known) stored++;
      }
      if (batch.length < ACTIVITY_PAGE_SIZE) break;
    }
    return stored;
  }

  /**
   * Activities synced before multisport support lack their legs (the list skipped children). Once per user the activity
   * backfill starts over, so the legs of older multisport activities arrive too; the marker row keeps it from repeating.
   */
  function startMultisportBackfill(userId: string): void {
    if (repos.syncState.get(userId, "multisport_backfill")) return;
    if (repos.syncState.get(userId, "activities")) repos.syncState.save(userId, "activities", { cursor: null, backfill_done: 0 });
    repos.syncState.save(userId, "multisport_backfill", { last_sync_at: new Date(now()).toISOString() });
    log.info("multisport_backfill_started");
  }

  /** Gives a leg the samples, laps and sets of its session in the parent's file. False when there is nothing to take. */
  function fillLeg(userId: string, legId: number, parent: { id: number; start_utc: string }, parentFit: ParsedFit): boolean {
    const leg = repos.activities.get(userId, legId);
    if (!leg) return false;
    const session = sessionAt(parentFit.sessions, (Date.parse(leg.start_utc) - Date.parse(parent.start_utc)) / 1000);
    if (!session) return false;
    const detail = sliceSession(parentFit, session);
    if (!detail.samples.length) return false;
    repos.activities.replaceDetail(userId, legId, detail);
    repos.activities.setFitStatus(userId, legId, "done");
    return true;
  }

  /** A leg without a file of its own: try the parent's stored file. */
  function fillLegFromParent(userId: string, legId: number): boolean {
    const parentId = repos.activities.get(userId, legId)?.parent_id;
    const parent = parentId == null ? undefined : repos.activities.get(userId, parentId);
    const bytes = parent?.fit_status === "done" ? deps.fit.read(userId, parent.id) : null;
    return parent && bytes ? fillLeg(userId, legId, parent, parseFit(bytes)) : false;
  }

  /** A freshly parsed parent: legs that found no file of their own earlier get their part of it. Returns how many. */
  function fillLegsOf(userId: string, parentId: number, parentFit: ParsedFit): number {
    const parent = repos.activities.get(userId, parentId);
    if (!parent || parentFit.sessions.length < 2) return 0;
    return repos.activities.legs(userId, parentId).filter((leg) => leg.fit_status === "none" && fillLeg(userId, leg.id, parent, parentFit)).length;
  }

  async function syncZones(userId: string, api: GarminApi): Promise<void> {
    const mapped = mapHeartRateZones(await api.heartRateZones(), today());
    if (!mapped) return;
    const latest = repos.athlete.history(userId).filter((s) => s.source === "garmin").at(-1);
    const same = latest && latest.hr_max === mapped.hr_max && latest.hr_rest === mapped.hr_rest && latest.lthr === mapped.lthr && latest.zones_json === mapped.zones_json;
    if (same) return;
    // Keep manual values (FTP, threshold pace, sex) the user entered for the version in force.
    const current = repos.athlete.at(userId, mapped.valid_from);
    repos.athlete.upsert(userId, {
      ...mapped,
      // A manual override of a Garmin value (HR max, LTHR) lives in its own manual row and is never overwritten here.
      ftp: current?.ftp ?? null,
      threshold_pace_s_per_km: current?.threshold_pace_s_per_km ?? null,
      sex: current?.sex ?? null,
    });
    repos.syncState.save(userId, "zones", { last_sync_at: new Date(now()).toISOString(), last_error: null, items: 1 });
  }

  /** Downloads and parses the FIT files of activities that have none yet. Returns the oldest date touched. */
  async function syncFit(userId: string, api: GarminApi, deadline: number): Promise<string | null> {
    let touched: string | null = null;
    let processed = 0;
    for (;;) {
      if (now() >= deadline) break;
      const batch = repos.activities.pendingFit(userId, FIT_BATCH);
      if (!batch.length) break;
      for (const { id, date } of batch) {
        if (now() >= deadline) break;
        try {
          const zip = await api.downloadActivityZip(id);
          const bytes = zip ? fitFromZip(zip) : null;
          if (!bytes) {
            if (fillLegFromParent(userId, id)) {
              processed++;
              if (!touched || date < touched) touched = date;
            } else repos.activities.setFitStatus(userId, id, "none");
            continue;
          }
          deps.fit.save(userId, id, bytes);
          const parsed = parseFit(bytes);
          repos.activities.replaceDetail(userId, id, { samples: parsed.samples, laps: parsed.laps, sets: parsed.sets });
          repos.activities.setFitStatus(userId, id, "done");
          processed += 1 + fillLegsOf(userId, id, parsed);
          if (!touched || date < touched) touched = date;
        } catch (e) {
          if (e instanceof GarminKeyError) throw e;
          // One broken file must not stop the rest; it is marked failed and left alone.
          log.warn("fit_failed", { activity: id, err: e });
          repos.activities.setFitStatus(userId, id, "failed");
        }
      }
    }
    repos.syncState.save(userId, "fit", { last_sync_at: new Date(now()).toISOString(), items: repos.activities.count(userId) - repos.activities.pendingFitCount(userId) });
    log.debug("fit_done", { processed });
    return touched;
  }

  async function run(userId: string): Promise<void> {
    const l = { phase: "starting" as string | null, startedAt: new Date(now()).toISOString(), finishedAt: null as string | null, error: null as string | null };
    live.set(userId, l);
    const t0 = now();
    const deadline = t0 + maxRunMs;
    const api = deps.garmin(userId);
    let changedFrom: string | null = null;
    const touch = (d: string | null) => {
      if (d && (!changedFrom || d < changedFrom)) changedFrom = d;
    };
    const step = async (name: string, kind: SyncKind, fn: () => Promise<void>) => {
      l.phase = name;
      try {
        await fn();
      } catch (e) {
        if (e instanceof GarminKeyError) throw e;
        // A failing data kind (e.g. an endpoint Garmin rejects for this account) must not block the others.
        log.warn("step_failed", { step: name, err: e });
        repos.syncState.save(userId, kind, { last_error: e instanceof Error ? e.message : "error" });
      }
    };
    try {
      await step("zones", "zones", () => syncZones(userId, api));
      await step("activities", "activities", async () => {
        startMultisportBackfill(userId);
        touch(await syncRange(userId, "activities", (s, e) => fetchActivities(userId, api, s, e), deadline));
      });
      // Loads from the summaries are available now; the FIT detail refines them later.
      if (changedFrom) deps.onChanged(userId, changedFrom);
      await step("dailies", "dailies", async () => {
        await syncRange(userId, "dailies", async (s, e) => {
          const rows = (await api.dailySummaries(s, e)).map(mapDaily).filter((r) => r !== null);
          repos.health.dailies.upsertMany(userId, rows);
          return rows.length;
        }, deadline);
      });
      await step("sleep", "sleep", async () => {
        await syncRange(userId, "sleep", async (s, e) => {
          const rows = (await api.sleepSummaries(s, e)).map(mapSleep).filter((r) => r !== null);
          repos.health.sleep.upsertMany(userId, rows);
          return rows.length;
        }, deadline);
      });
      await step("hrv", "hrv", async () => {
        await syncRange(userId, "hrv", async (s, e) => {
          const rows = (await api.hrvSummaries(s, e)).map(mapHrv).filter((r) => r !== null);
          repos.health.hrv.upsertMany(userId, rows);
          return rows.length;
        }, deadline);
      });
      await step("fit", "fit", async () => touch(await syncFit(userId, api, deadline)));
      if (changedFrom) deps.onChanged(userId, changedFrom);
      l.phase = null;
      log.info("run_done", { ms: now() - t0, pending_fit: repos.activities.pendingFitCount(userId) });
    } catch (e) {
      l.phase = null;
      if (e instanceof GarminKeyError) {
        l.error = "key";
        await deps.onKeyInvalid(userId);
      } else {
        l.error = "failed";
        log.error("run_failed", { err: e });
      }
    } finally {
      l.finishedAt = new Date(now()).toISOString();
    }
  }

  /** Starts a run unless one is already going; resolves when it ends. */
  function trigger(userId: string): Promise<void> {
    const existing = running.get(userId);
    if (existing) return existing;
    const p = run(userId).finally(() => running.delete(userId));
    running.set(userId, p);
    return p;
  }

  // Scheduler: every interval each usable key syncs; a run that stopped at its time budget with work left resumes soon.
  let timer: NodeJS.Timeout | undefined;
  const resume = new Map<string, NodeJS.Timeout>();
  function tick(): void {
    for (const userId of repos.keys.listUsable()) {
      void trigger(userId).then(() => {
        if (repos.activities.pendingFitCount(userId) > 0 && repos.keys.get(userId)?.status === "ok" && !resume.has(userId)) {
          resume.set(
            userId,
            setTimeout(() => {
              resume.delete(userId);
              void trigger(userId);
            }, RESUME_DELAY_MS).unref(),
          );
        }
      });
    }
  }

  return {
    trigger,
    progress,
    isRunning: (userId: string) => running.has(userId),
    start(intervalMs: number): void {
      timer = setInterval(tick, intervalMs).unref();
      setTimeout(tick, 5000).unref(); // one run shortly after start
    },
    stop(): void {
      clearInterval(timer);
      for (const t of resume.values()) clearTimeout(t);
    },
    /** For tests and the settings page: how many days the backfill covers. */
    backfillDays: (userId: string): number | null => {
      const c = repos.syncState.get(userId, "activities")?.cursor;
      return c ? diffDays(today(), c) : null;
    },
  };
}
export type SyncWorker = ReturnType<typeof createSyncWorker>;

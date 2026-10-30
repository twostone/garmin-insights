import { api, unwrap } from "./api.ts";

type Progress = Awaited<ReturnType<typeof fetchProgress>>;
const fetchProgress = () => unwrap<{
  running: boolean; phase: string | null; startedAt: string | null; finishedAt: string | null; error: string | null;
  kinds: { kind: string; cursor: string | null; backfillDone: boolean; items: number; lastSyncAt: string | null; lastError: string | null }[];
  fit: { done: number; pending: number };
  key: { configured: boolean; status: "ok" | "invalid" | "expired" | null; expiresOn: string | null; daysLeft: number | null };
}>(api.sync.$get());

const POLL_MS = 3000;
const IDLE_POLL_MS = 60_000;

// Shared sync state for the whole UI: polls while a sync runs (progress banner), slowly otherwise.
class SyncState {
  progress: Progress | null = $state(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  /** Bumped whenever a sync run finished, pages watch it to reload their data. */
  finishedCount = $state(0);

  get needsKey() {
    return !!this.progress && this.progress.key.status !== "ok";
  }

  /** Called once after sign-in: starts a sync (new data on open) and the polling loop. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.refresh();
    if (this.progress?.key.status === "ok") await this.trigger();
  }

  async trigger(): Promise<void> {
    try {
      await unwrap(api.sync.$post());
    } catch {
      // no key (409) or a transient error: the next poll shows the state
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    clearTimeout(this.timer);
    const wasRunning = this.progress?.running ?? false;
    try {
      this.progress = await fetchProgress();
    } catch {
      // keep the last known state; try again later
    }
    if (wasRunning && !this.progress?.running) this.finishedCount++;
    this.timer = setTimeout(() => void this.refresh(), this.progress?.running ? POLL_MS : IDLE_POLL_MS);
  }
}
export const sync = new SyncState();

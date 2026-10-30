// Calendar-date helpers on `YYYY-MM-DD` strings. All arithmetic is done in UTC on the date itself, so daylight saving time
// never shifts a day. A "date" in this app is always the user's local calendar day as Garmin reports it.

export const DAY_MS = 86_400_000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
export const fromMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, days: number): string => fromMs(toMs(date) + days * DAY_MS);
export const diffDays = (later: string, earlier: string): number => Math.round((toMs(later) - toMs(earlier)) / DAY_MS);
export const isDate = (value: string): boolean => DATE_RE.test(value) && !Number.isNaN(toMs(value)) && fromMs(toMs(value)) === value;

/** Today's date in the server's time zone (TZ), not UTC. */
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const dow = new Date(toMs(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

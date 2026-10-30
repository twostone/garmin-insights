import { logger } from "../log.ts";

const log = logger("ha-notify");

// Notifications go through the Supervisor's Core proxy (needs `homeassistant_api: true`) as persistent notifications.
// Deliberately plain fetch: the target is fixed in code, never user input. Home Assistant has no per-user persistent
// notifications, so the text names the person and every HA user with access to the notification panel can see it.
export const SUPERVISOR_NOTIFY_URL = "http://supervisor/core/api/services/persistent_notification/create";
const TIMEOUT_MS = 5000;

export type Notification = { id: string; title: string; message: string };
export type Notify = (n: Notification) => Promise<void>;

/** `token` null (development, tests) -> disabled. `url` is only overridden by tests. */
export function createNotify(token: string | null, url = SUPERVISOR_NOTIFY_URL): Notify {
  return async (n) => {
    if (!token) return;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notification_id: n.id, title: n.title, message: n.message }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`supervisor responded ${res.status}`);
      log.debug("notification_sent");
    } catch (err) {
      log.warn("notification_failed", { err });
    }
  };
}

type Lang = "de" | "en";
const TEXTS = {
  de: {
    expiringTitle: "Garmin-Key läuft bald ab",
    expiringBody: (name: string, days: number) => `Der Garmin-Key von ${name} läuft in ${days} Tag(en) ab. Bitte in Garmin Connect einen neuen Key erzeugen und in Garmin Insights hinterlegen.`,
    invalidTitle: "Garmin-Key ungültig",
    invalidBody: (name: string) => `Garmin hat den Key von ${name} abgelehnt (abgelaufen oder widerrufen). Der Sync ist pausiert, bis ein neuer Key hinterlegt ist.`,
  },
  en: {
    expiringTitle: "Garmin key expires soon",
    expiringBody: (name: string, days: number) => `${name}'s Garmin key expires in ${days} day(s). Create a new key in Garmin Connect and enter it in Garmin Insights.`,
    invalidTitle: "Garmin key invalid",
    invalidBody: (name: string) => `Garmin rejected ${name}'s key (expired or revoked). Syncing is paused until a new key is entered.`,
  },
} as const;

export const expiringNotification = (userId: string, name: string, days: number, lang: Lang): Notification => ({
  id: `garmin_insights_expiring_${userId}`,
  title: TEXTS[lang].expiringTitle,
  message: TEXTS[lang].expiringBody(name, days),
});
export const invalidNotification = (userId: string, name: string, lang: Lang): Notification => ({
  id: `garmin_insights_invalid_${userId}`,
  title: TEXTS[lang].invalidTitle,
  message: TEXTS[lang].invalidBody(name),
});

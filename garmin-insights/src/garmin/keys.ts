import { decrypt, encrypt } from "../crypto.ts";
import { diffDays, isDate, todayLocal } from "../dates.ts";
import { expiringNotification, invalidNotification, type Notify } from "../ha/notify.ts";
import { logger } from "../log.ts";
import type { Repos } from "../repo/index.ts";

const log = logger("garmin-keys");

export const EXPIRY_WARNING_DAYS = 7;
const MAX_KEY_LENGTH = 512;

export class KeyInputError extends Error {}

export type KeyStatusView = {
  configured: boolean;
  status: "ok" | "invalid" | "expired" | null;
  expiresOn: string | null;
  daysLeft: number | null;
};

// Stores the Garmin API key encrypted (src/crypto.ts) and checks it with a token exchange before keeping it. The key never
// leaves this module in clear text except to the Garmin client (`reveal`), and is never logged or returned by the API.
export function createKeyService(opts: { repos: Repos; masterKey: Buffer; exchange: (apiKey: string) => Promise<unknown>; notify: Notify; today?: () => string }) {
  const { repos, masterKey } = opts;
  const today = opts.today ?? (() => todayLocal());

  const view = (userId: string): KeyStatusView => {
    const row = repos.keys.get(userId);
    if (!row) return { configured: false, status: null, expiresOn: null, daysLeft: null };
    return { configured: true, status: row.status, expiresOn: row.expires_on, daysLeft: row.expires_on ? diffDays(row.expires_on, today()) : null };
  };

  const userName = (userId: string) => repos.users.get(userId)?.name ?? "Garmin Insights";
  const language = (userId: string) => repos.users.get(userId)?.language ?? "en";

  return {
    status: view,

    /** Validates against Garmin first: a rejected key is not stored. Throws KeyInputError / GarminKeyError. */
    async put(userId: string, apiKey: string, expiresOn: string | null): Promise<KeyStatusView> {
      const key = apiKey.trim();
      if (!key || key.length > MAX_KEY_LENGTH || /\s/.test(key)) throw new KeyInputError("key");
      if (expiresOn !== null && (!isDate(expiresOn) || expiresOn < today())) throw new KeyInputError("expires_on");
      await opts.exchange(key); // GarminKeyError("invalid") when Garmin refuses it
      repos.keys.put(userId, encrypt(masterKey, key, userId), expiresOn);
      log.info("key_stored");
      return view(userId);
    },

    /** Stops the sync; synced data stays until "delete all data". */
    remove(userId: string): void {
      repos.keys.delete(userId);
      log.info("key_removed");
    },

    /** Clear-text key for the Garmin client; null when none is stored or it is not usable. */
    async reveal(userId: string): Promise<string | null> {
      const row = repos.keys.get(userId);
      if (!row || row.status !== "ok") return null;
      return decrypt(masterKey, row.ciphertext, userId);
    },

    /** Garmin refused the key during a sync: pause syncing and tell the user once. */
    async markInvalid(userId: string): Promise<void> {
      const row = repos.keys.get(userId);
      if (!row || row.status !== "ok") return;
      repos.keys.setStatus(userId, "invalid");
      log.warn("key_invalid");
      await opts.notify(invalidNotification(userId, userName(userId), language(userId)));
    },

    /** Daily check: warn 7 days before the date the user entered, and flip to expired after it. */
    async checkExpiry(): Promise<void> {
      for (const row of repos.keys.all()) {
        if (!row.expires_on || row.status !== "ok") continue;
        const daysLeft = diffDays(row.expires_on, today());
        if (daysLeft < 0) {
          repos.keys.setStatus(row.user_id, "expired");
          await opts.notify(invalidNotification(row.user_id, userName(row.user_id), language(row.user_id)));
        } else if (daysLeft <= EXPIRY_WARNING_DAYS && row.warned_for !== row.expires_on) {
          repos.keys.markWarned(row.user_id, row.expires_on);
          await opts.notify(expiringNotification(row.user_id, userName(row.user_id), daysLeft, language(row.user_id)));
        }
      }
    },
  };
}
export type KeyService = ReturnType<typeof createKeyService>;

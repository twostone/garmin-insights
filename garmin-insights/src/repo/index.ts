import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db.ts";
import { activitiesRepo } from "./activities.ts";
import { analyticsRepo } from "./analytics.ts";
import { athleteRepo } from "./athlete.ts";
import { healthRepo } from "./health.ts";
import { keysRepo } from "./keys.ts";
import { syncStateRepo } from "./sync-state.ts";
import { usersRepo } from "./users.ts";

// All data access. Every method that touches user data takes the user id as its first parameter; there is no
// "current user" state in here, so one user's request can never read another's rows by accident.
export function createRepos(db: DatabaseSync) {
  const repos = {
    users: usersRepo(db),
    keys: keysRepo(db),
    syncState: syncStateRepo(db),
    activities: activitiesRepo(db),
    health: healthRepo(db),
    athlete: athleteRepo(db),
    analytics: analyticsRepo(db),
  };
  return {
    ...repos,
    /** "Delete all my data": every synced row of the user. The user and the Garmin key stay. */
    deleteAllData: (userId: string): void =>
      transaction(db, () => {
        repos.analytics.deleteAll(userId);
        repos.activities.deleteAll(userId);
        repos.health.dailies.deleteAll(userId);
        repos.health.sleep.deleteAll(userId);
        repos.health.hrv.deleteAll(userId);
        repos.athlete.deleteAll(userId);
        db.prepare("DELETE FROM sync_state WHERE user_id = ?").run(userId);
      }),
  };
}
export type Repos = ReturnType<typeof createRepos>;

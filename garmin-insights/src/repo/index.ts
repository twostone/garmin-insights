import type { DatabaseSync } from "node:sqlite";
import { usersRepo } from "./users.ts";

// All data access. Every method that touches user data takes the user id as its first parameter; there is no
// "current user" state in here, so one user's request can never read another's rows by accident.
export function createRepos(db: DatabaseSync) {
  return { users: usersRepo(db) };
}
export type Repos = ReturnType<typeof createRepos>;

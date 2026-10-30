import type { AppContext } from "./auth/context.ts";

// Which listener a request came in on. Decided by the listener, never by headers.
export type Access = "ingress" | "external";

// The Home Assistant user a request acts for. `id` is the HA user id and the key of all stored data.
export type AppUser = { id: string; name: string | null };

// Set by the listener's middleware before the shared app runs. The shared app never reads identity headers itself.
export type Env = { Variables: { access: Access; user: AppUser | null; appContext: AppContext } };

import type { SportFilterValue } from "./types.ts";

/** Query parameters for the analysis endpoints (all of them take `sport` and `custom_sport_id`). */
export const sportQuery = (f: SportFilterValue): { sport?: string; custom_sport_id?: string } => ({
  ...(f.sport ? { sport: f.sport } : {}),
  ...(f.customSportId !== undefined ? { custom_sport_id: String(f.customSportId) } : {}),
});

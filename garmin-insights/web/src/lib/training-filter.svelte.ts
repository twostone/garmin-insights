import type { SportFilterValue } from "./types.ts";

// Range (days) and sport filter shared by the Training sub-pages, so switching between them keeps the selection.
export const TRAINING_RANGES = [90, 180, 365, 1825] as const;
export const trainingFilter = $state<{ days: number; sport: SportFilterValue }>({ days: 180, sport: {} });

// Garmin activity type keys -> the handful of sports the app analyses differently.
export type Sport = "running" | "cycling" | "swimming" | "strength" | "walking" | "hiking" | "paddling" | "rowing" | "other";
export const SPORTS: readonly Sport[] = ["running", "cycling", "swimming", "strength", "walking", "hiking", "paddling", "rowing", "other"];

const BY_KEY: Record<string, Sport> = {
  running: "running",
  trail_running: "running",
  treadmill_running: "running",
  track_running: "running",
  virtual_run: "running",
  ultra_run: "running",
  obstacle_run: "running",
  cycling: "cycling",
  road_biking: "cycling",
  mountain_biking: "cycling",
  gravel_cycling: "cycling",
  indoor_cycling: "cycling",
  virtual_ride: "cycling",
  cyclocross: "cycling",
  bmx: "cycling",
  e_bike_fitness: "cycling",
  e_bike_mountain: "cycling",
  track_cycling: "cycling",
  lap_swimming: "swimming",
  open_water_swimming: "swimming",
  swimming: "swimming",
  strength_training: "strength",
  walking: "walking",
  casual_walking: "walking",
  speed_walking: "walking",
  hiking: "hiking",
  rowing: "rowing",
  rowing_v2: "rowing",
  indoor_rowing: "rowing",
};

// Garmin versions some paddle types (stand_up_paddleboarding_v2, kayaking_v2, …): these match by prefix.
const BY_PREFIX: [string, Sport][] = [
  ["stand_up_paddleboarding", "paddling"],
  ["kayaking", "paddling"],
  ["canoeing", "paddling"],
  ["whitewater", "paddling"],
  ["paddling", "paddling"],
  ["outrigger", "paddling"],
  ["dragon_boat", "paddling"],
];

export function sportOf(typeKey: string | null | undefined): Sport {
  if (!typeKey) return "other";
  const key = typeKey.toLowerCase();
  return BY_KEY[key] ?? BY_PREFIX.find(([prefix]) => key.startsWith(prefix))?.[1] ?? "other";
}

export const isSport = (value: string): value is Sport => (SPORTS as readonly string[]).includes(value);

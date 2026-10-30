// Garmin activity type keys -> the handful of sports the app analyses differently.
export type Sport = "running" | "cycling" | "swimming" | "strength" | "walking" | "hiking" | "other";
export const SPORTS: readonly Sport[] = ["running", "cycling", "swimming", "strength", "walking", "hiking", "other"];

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
};

export function sportOf(typeKey: string | null | undefined): Sport {
  return (typeKey && BY_KEY[typeKey.toLowerCase()]) || "other";
}

export const isSport = (value: string): value is Sport => (SPORTS as readonly string[]).includes(value);

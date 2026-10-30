import type { StrengthSetWithActivity } from "../repo/activities.ts";

// Garmin's exercise categories (FIT profile `exercise_category`, snake_case) -> the one muscle group they mainly train.
// A heuristic for a volume overview, not anatomy: deadlifts count as back, olympic lifts as full body.
export const MUSCLE_GROUP: Record<string, string> = {
  bench_press: "chest", flye: "chest", push_up: "chest",
  row: "back", pull_up: "back", hyperextension: "back", deadlift: "back",
  shoulder_press: "shoulders", lateral_raise: "shoulders", shoulder_stability: "shoulders", shrug: "shoulders",
  curl: "biceps", triceps_extension: "triceps",
  squat: "legs", lunge: "legs", leg_curl: "legs", calf_raise: "legs",
  hip_raise: "glutes", hip_stability: "glutes", hip_swing: "glutes",
  core: "core", crunch: "core", sit_up: "core", plank: "core", leg_raise: "core", chop: "core",
  olympic_lift: "full_body", total_body: "full_body", plyo: "full_body", carry: "full_body", cardio: "full_body",
};
export const muscleGroupOf = (exercise: string | null): string => (exercise && MUSCLE_GROUP[exercise]) || "other";

export type ExerciseVolume = { exercise: string; muscle_group: string; sets: number; reps: number; volume_kg: number; max_weight_kg: number | null; best_e1rm_kg: number | null };
export type MuscleVolume = { group: string; sets: number; volume_kg: number };
export type StrengthSummary = { byExercise: ExerciseVolume[]; byMuscleGroup: MuscleVolume[]; totalVolumeKg: number; totalSets: number };

// Epley: weight * (1 + reps / 30). Only meaningful for low rep counts, shown as an estimate.
const epley = (kg: number, reps: number) => kg * (1 + reps / 30);

/** Volume = reps x weight, over active sets only. Sets without reps or weight (planks) count as sets with zero volume. */
export function strengthVolume(sets: readonly Pick<StrengthSetWithActivity, "set_type" | "exercise" | "reps" | "weight_kg">[]): StrengthSummary {
  const byExercise = new Map<string, ExerciseVolume>();
  for (const s of sets) {
    if (s.set_type !== "active") continue;
    const exercise = s.exercise ?? "unknown";
    const e = byExercise.get(exercise) ?? { exercise, muscle_group: muscleGroupOf(s.exercise), sets: 0, reps: 0, volume_kg: 0, max_weight_kg: null, best_e1rm_kg: null };
    e.sets++;
    if (s.reps && s.weight_kg) {
      e.reps += s.reps;
      e.volume_kg += s.reps * s.weight_kg;
      e.max_weight_kg = Math.max(e.max_weight_kg ?? 0, s.weight_kg);
      e.best_e1rm_kg = Math.max(e.best_e1rm_kg ?? 0, epley(s.weight_kg, s.reps));
    } else if (s.reps) {
      e.reps += s.reps;
    }
    byExercise.set(exercise, e);
  }
  const exercises = [...byExercise.values()].sort((a, b) => b.volume_kg - a.volume_kg || a.exercise.localeCompare(b.exercise));
  const groups = new Map<string, MuscleVolume>();
  for (const e of exercises) {
    const g = groups.get(e.muscle_group) ?? { group: e.muscle_group, sets: 0, volume_kg: 0 };
    g.sets += e.sets;
    g.volume_kg += e.volume_kg;
    groups.set(e.muscle_group, g);
  }
  return {
    byExercise: exercises,
    byMuscleGroup: [...groups.values()].sort((a, b) => b.volume_kg - a.volume_kg || a.group.localeCompare(b.group)),
    totalVolumeKg: exercises.reduce((a, e) => a + e.volume_kg, 0),
    totalSets: exercises.reduce((a, e) => a + e.sets, 0),
  };
}

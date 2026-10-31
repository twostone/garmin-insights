<script lang="ts">
  import InfoTip from "$lib/components/InfoTip.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { addDays, num, today } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import { trainingFilter } from "$lib/training-filter.svelte.ts";

  const TOP_EXERCISES = 10;
  const to = today();
  const from = $derived(addDays(to, -(trainingFilter.days - 1)));
  const strength = new Resource(() => unwrap<{ byMuscleGroup: { group: string; sets: number; volume_kg: number }[]; byExercise: { exercise: string; sets: number; volume_kg: number; best_e1rm_kg: number | null }[]; totalVolumeKg: number }>(api.analytics.strength.$get({ query: { from, to } })));

  $effect(() => {
    void [from, sync.finishedCount];
    void strength.reload();
  });

  const groupName = (g: string) => ({ chest: m.muscle_chest(), back: m.muscle_back(), shoulders: m.muscle_shoulders(), biceps: m.muscle_biceps(), triceps: m.muscle_triceps(), legs: m.muscle_legs(), glutes: m.muscle_glutes(), core: m.muscle_core(), full_body: m.muscle_full_body(), other: m.muscle_other() })[g] ?? g;
</script>

<section class="card">
  <h2>{m.trends_strength()}</h2>
  {#if strength.data && strength.data.byMuscleGroup.length}
    <p class="muted">{m.strength_total({ volume: num(strength.data.totalVolumeKg) })}</p>
    <div class="two-col">
      <table><thead><tr><th>{m.strength_muscle_group()}</th><th class="r">{m.strength_sets()}</th><th class="r">{m.strength_volume()}</th></tr></thead>
        <tbody>{#each strength.data.byMuscleGroup as g (g.group)}<tr><td>{groupName(g.group)}</td><td class="r">{g.sets}</td><td class="r">{num(g.volume_kg)} kg</td></tr>{/each}</tbody></table>
      <table><thead><tr><th>{m.strength_exercise()}</th><th class="r">{m.strength_volume()}</th><th class="r">{m.strength_e1rm()}<InfoTip metric="e1rm" /></th></tr></thead>
        <tbody>{#each strength.data.byExercise.slice(0, TOP_EXERCISES) as e (e.exercise)}<tr><td>{e.exercise.replaceAll("_", " ")}</td><td class="r">{num(e.volume_kg)} kg</td><td class="r">{e.best_e1rm_kg ? `${num(e.best_e1rm_kg, 1)} kg` : "–"}</td></tr>{/each}</tbody></table>
    </div>
  {:else if !strength.loading}<p class="muted">{m.empty_data()}</p>{/if}
</section>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { pmcOption, volumeOption, zoneOption } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import LoadHeatmap from "$lib/components/LoadHeatmap.svelte";
  import PaddlingCard from "$lib/components/PaddlingCard.svelte";
  import SportFilter from "$lib/components/SportFilter.svelte";
  import WeeklyBalanceCard from "$lib/components/WeeklyBalanceCard.svelte";
  import { addDays, dateLabel, duration, num, pace, today } from "$lib/format.ts";
  import { sportQuery } from "$lib/sport-filter.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import type { SportFilterValue, Zone } from "$lib/types.ts";

  const RANGES = [90, 180, 365, 1825] as const;
  let days = $state<number>(180);
  let metric = $state<"hours" | "km">("hours");
  let bestSport = $state<"running" | "cycling">("running");
  let zoneKind = $state<"hr" | "power" | "pace">("hr");
  let sportFilter = $state<SportFilterValue>({});
  const to = today();
  const from = $derived(addDays(to, -(days - 1)));

  const pmc = new Resource(() => unwrap<{ date: string; ctl: number; atl: number; tsb: number; tss: number }[]>(api.analytics.pmc.$get({ query: { from, to } })));
  const volume = new Resource(() => unwrap<{ period: string; sport: string; duration_s: number; distance_m: number }[]>(api.analytics.volume.$get({ query: { from, to, by: days > 400 ? "month" : "week", ...sportQuery(sportFilter) } as never })));
  const best = new Resource(() => unwrap<{ efforts: { distance_m: number; seconds: number; activity_id: number; date: string }[]; power_curve: { seconds: number; watts: number; date: string }[] }>(api.analytics["best-efforts"].$get({ query: { from: addDays(to, -364), to, sport: bestSport } })));
  const zones = new Resource(() => unwrap<NonNullable<Zone> & { activities: number }>(api.analytics.zones.$get({ query: { from, to, kind: zoneKind, ...sportQuery(sportFilter) } as never })));
  const strength = new Resource(() => unwrap<{ byMuscleGroup: { group: string; sets: number; volume_kg: number }[]; byExercise: { exercise: string; sets: number; volume_kg: number; best_e1rm_kg: number | null }[]; totalVolumeKg: number }>(api.analytics.strength.$get({ query: { from, to } })));

  $effect(() => {
    void [from, sportFilter, sync.finishedCount];
    void pmc.reload();
    void volume.reload();
    void strength.reload();
  });
  $effect(() => {
    void [from, zoneKind, sportFilter, sync.finishedCount];
    void zones.reload();
  });
  $effect(() => {
    void [bestSport, sync.finishedCount];
    void best.reload();
  });

  const groupName = (g: string) => ({ chest: m.muscle_chest(), back: m.muscle_back(), shoulders: m.muscle_shoulders(), biceps: m.muscle_biceps(), triceps: m.muscle_triceps(), legs: m.muscle_legs(), glutes: m.muscle_glutes(), core: m.muscle_core(), full_body: m.muscle_full_body(), other: m.muscle_other() })[g] ?? g;
  const rangeLabel = (d: number) => (d === 90 ? m.range_3m() : d === 180 ? m.range_6m() : d === 365 ? m.range_1y() : m.range_5y());
  const effortName = (d: number) => (d === 1609 ? m.effort_mile() : d === 21098 ? m.effort_half() : d === 42195 ? m.effort_marathon() : `${d / 1000} km`);
  const zoneLabels = (n: number) => Array.from({ length: n }, (_, i) => m.zone_n({ n: i + 1 }));
</script>

<h1>{m.nav_trends()}</h1>

<div class="chips" role="group" aria-label={m.range_label()} style="margin-bottom:1rem">
  {#each RANGES as d (d)}
    <button type="button" class="chip" aria-pressed={days === d} onclick={() => (days = d)}>{rangeLabel(d)}</button>
  {/each}
</div>
<SportFilter bind:value={sportFilter} />

<section class="card">
  <h2>{m.trends_pmc()}</h2>
  {#if pmc.data?.length}<Chart option={pmcOption(pmc.data)} height={300} label={m.chart_pmc_label()} />{:else if !pmc.loading}<p class="muted">{m.empty_data()}</p>{/if}
  <p class="muted small">{m.trends_pmc_hint()}</p>
</section>

<LoadHeatmap {to} />
<WeeklyBalanceCard {from} {to} filter={sportFilter} />
<PaddlingCard {from} {to} filter={sportFilter} />

<section class="card">
  <div class="row between">
    <h2>{m.trends_volume()}</h2>
    <div class="chips">
      <button type="button" class="chip" aria-pressed={metric === "hours"} onclick={() => (metric = "hours")}>{m.unit_hours()}</button>
      <button type="button" class="chip" aria-pressed={metric === "km"} onclick={() => (metric = "km")}>{m.unit_km()}</button>
    </div>
  </div>
  {#if volume.data?.length}<Chart option={volumeOption(volume.data, metric)} height={280} label={m.trends_volume()} />{:else if !volume.loading}<p class="muted">{m.empty_data()}</p>{/if}
</section>

<div class="two-col">
  <section class="card">
    <div class="row between">
      <h2>{m.trends_zones()}</h2>
      <div class="chips">
        {#each ["hr", "power", "pace"] as const as k (k)}
          <button type="button" class="chip" aria-pressed={zoneKind === k} onclick={() => (zoneKind = k)}>{k === "hr" ? m.zones_hr_short() : k === "power" ? m.zones_power_short() : m.zones_pace_short()}</button>
        {/each}
      </div>
    </div>
    {#if zones.data?.seconds.length}
      <Chart option={zoneOption(zones.data.seconds, zoneLabels(zones.data.seconds.length))} height={zones.data.seconds.length * 34 + 24} label={m.trends_zones()} />
    {:else if !zones.loading}<p class="muted">{m.empty_data()}</p>{/if}
  </section>

  <section class="card">
    <div class="row between">
      <h2>{m.trends_best()}</h2>
      <div class="chips">
        <button type="button" class="chip" aria-pressed={bestSport === "running"} onclick={() => (bestSport = "running")}>{m.sport_running()}</button>
        <button type="button" class="chip" aria-pressed={bestSport === "cycling"} onclick={() => (bestSport = "cycling")}>{m.sport_cycling()}</button>
      </div>
    </div>
    <p class="muted small">{m.trends_best_hint()}</p>
    {#if bestSport === "running" && best.data?.efforts.length}
      <table><thead><tr><th>{m.metric_distance()}</th><th class="r">{m.metric_time()}</th><th class="r">{m.metric_pace()}</th><th class="r">{m.metric_date()}</th></tr></thead>
        <tbody>{#each best.data.efforts as e (e.distance_m)}<tr><td>{effortName(e.distance_m)}</td><td class="r">{duration(e.seconds)}</td><td class="r">{pace(e.distance_m / e.seconds)}</td><td class="r">{dateLabel(e.date, { day: "numeric", month: "short", year: "2-digit" })}</td></tr>{/each}</tbody></table>
    {:else if bestSport === "cycling" && best.data?.power_curve.length}
      <table><thead><tr><th>{m.metric_duration()}</th><th class="r">{m.metric_avg_power()}</th><th class="r">{m.metric_date()}</th></tr></thead>
        <tbody>{#each best.data.power_curve as p (p.seconds)}<tr><td>{duration(p.seconds)}</td><td class="r">{num(p.watts)} W</td><td class="r">{dateLabel(p.date, { day: "numeric", month: "short", year: "2-digit" })}</td></tr>{/each}</tbody></table>
    {:else if !best.loading}<p class="muted">{m.empty_data()}</p>{/if}
  </section>
</div>

<section class="card">
  <h2>{m.trends_strength()}</h2>
  {#if strength.data && strength.data.byMuscleGroup.length}
    <p class="muted">{m.strength_total({ volume: num(strength.data.totalVolumeKg) })}</p>
    <div class="two-col">
      <table><thead><tr><th>{m.strength_muscle_group()}</th><th class="r">{m.strength_sets()}</th><th class="r">{m.strength_volume()}</th></tr></thead>
        <tbody>{#each strength.data.byMuscleGroup as g (g.group)}<tr><td>{groupName(g.group)}</td><td class="r">{g.sets}</td><td class="r">{num(g.volume_kg)} kg</td></tr>{/each}</tbody></table>
      <table><thead><tr><th>{m.strength_exercise()}</th><th class="r">{m.strength_volume()}</th><th class="r">{m.strength_e1rm()}</th></tr></thead>
        <tbody>{#each strength.data.byExercise.slice(0, 10) as e (e.exercise)}<tr><td>{e.exercise.replaceAll("_", " ")}</td><td class="r">{num(e.volume_kg)} kg</td><td class="r">{e.best_e1rm_kg ? `${num(e.best_e1rm_kg, 1)} kg` : "–"}</td></tr>{/each}</tbody></table>
    </div>
  {:else if !strength.loading}<p class="muted">{m.empty_data()}</p>{/if}
</section>

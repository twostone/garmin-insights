<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { zoneOption } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import { addDays, dateLabel, duration, num, pace, today } from "$lib/format.ts";
  import { sportQuery } from "$lib/sport-filter.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import { trainingFilter } from "$lib/training-filter.svelte.ts";
  import type { Zone } from "$lib/types.ts";

  // Best efforts always look at the last 12 months (Garmin's records per activity), independent of the range.
  const BEST_EFFORT_DAYS = 365;
  const ZONE_BAR_HEIGHT = 34;
  let bestSport = $state<"running" | "cycling">("running");
  let zoneKind = $state<"hr" | "power" | "pace">("hr");
  const to = today();
  const from = $derived(addDays(to, -(trainingFilter.days - 1)));

  const best = new Resource(() => unwrap<{ efforts: { distance_m: number; seconds: number; activity_id: number; date: string }[]; power_curve: { seconds: number; watts: number; date: string }[] }>(api.analytics["best-efforts"].$get({ query: { from: addDays(to, -(BEST_EFFORT_DAYS - 1)), to, sport: bestSport } })));
  const zones = new Resource(() => unwrap<NonNullable<Zone> & { activities: number }>(api.analytics.zones.$get({ query: { from, to, kind: zoneKind, ...sportQuery(trainingFilter.sport) } as never })));

  $effect(() => {
    void [from, zoneKind, trainingFilter.sport, sync.finishedCount];
    void zones.reload();
  });
  $effect(() => {
    void [bestSport, sync.finishedCount];
    void best.reload();
  });

  const effortName = (d: number) => (d === 1609 ? m.effort_mile() : d === 21098 ? m.effort_half() : d === 42195 ? m.effort_marathon() : `${d / 1000} km`);
  const zoneLabels = (n: number) => Array.from({ length: n }, (_, i) => m.zone_n({ n: i + 1 }));
  const shortDate = (d: string) => dateLabel(d, { day: "numeric", month: "short", year: "2-digit" });
</script>

<div class="two-col">
  <section class="card">
    <div class="head">
      <h2>{m.trends_zones()}</h2>
      <div class="seg" role="group" aria-label={m.trends_zones()}>
        {#each ["hr", "power", "pace"] as const as k (k)}
          <button type="button" aria-pressed={zoneKind === k} onclick={() => (zoneKind = k)}>{k === "hr" ? m.zones_hr_short() : k === "power" ? m.zones_power_short() : m.zones_pace_short()}</button>
        {/each}
      </div>
    </div>
    {#if zones.data?.seconds.length}
      <Chart option={zoneOption(zones.data.seconds, zoneLabels(zones.data.seconds.length))} height={zones.data.seconds.length * ZONE_BAR_HEIGHT + 24} label={m.trends_zones()} />
    {:else if !zones.loading}<p class="muted">{m.empty_data()}</p>{/if}
  </section>

  <section class="card">
    <div class="head">
      <h2>{m.trends_best()}</h2>
      <div class="seg" role="group" aria-label={m.trends_best()}>
        <button type="button" aria-pressed={bestSport === "running"} onclick={() => (bestSport = "running")}>{m.sport_running()}</button>
        <button type="button" aria-pressed={bestSport === "cycling"} onclick={() => (bestSport = "cycling")}>{m.sport_cycling()}</button>
      </div>
    </div>
    <p class="muted small">{m.trends_best_hint()}</p>
    {#if bestSport === "running" && best.data?.efforts.length}
      <table><thead><tr><th>{m.metric_distance()}</th><th class="r">{m.metric_time()}</th><th class="r">{m.metric_pace()}</th><th class="r">{m.metric_date()}</th></tr></thead>
        <tbody>{#each best.data.efforts as e (e.distance_m)}<tr><td>{effortName(e.distance_m)}</td><td class="r">{duration(e.seconds)}</td><td class="r">{pace(e.distance_m / e.seconds)}</td><td class="r">{shortDate(e.date)}</td></tr>{/each}</tbody></table>
    {:else if bestSport === "cycling" && best.data?.power_curve.length}
      <table><thead><tr><th>{m.metric_duration()}</th><th class="r">{m.metric_avg_power()}</th><th class="r">{m.metric_date()}</th></tr></thead>
        <tbody>{#each best.data.power_curve as p (p.seconds)}<tr><td>{duration(p.seconds)}</td><td class="r">{num(p.watts)} W</td><td class="r">{shortDate(p.date)}</td></tr>{/each}</tbody></table>
    {:else if !best.loading}<p class="muted">{m.empty_data()}</p>{/if}
  </section>
</div>

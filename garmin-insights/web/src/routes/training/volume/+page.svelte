<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { volumeOption } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import PaddlingCard from "$lib/components/PaddlingCard.svelte";
  import { addDays, today } from "$lib/format.ts";
  import { sportQuery } from "$lib/sport-filter.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import { trainingFilter } from "$lib/training-filter.svelte.ts";

  // Beyond this range, weekly bars get too thin: the chart switches to months.
  const MONTHLY_FROM_DAYS = 400;
  let metric = $state<"hours" | "km">("hours");
  const to = today();
  const from = $derived(addDays(to, -(trainingFilter.days - 1)));
  const volume = new Resource(() => unwrap<{ period: string; sport: string; duration_s: number; distance_m: number }[]>(api.analytics.volume.$get({ query: { from, to, by: trainingFilter.days > MONTHLY_FROM_DAYS ? "month" : "week", ...sportQuery(trainingFilter.sport) } as never })));

  $effect(() => {
    void [from, trainingFilter.sport, sync.finishedCount];
    void volume.reload();
  });
</script>

<section class="card">
  <div class="head">
    <h2>{m.trends_volume()}</h2>
    <div class="seg" role="group" aria-label={m.trends_volume()}>
      <button type="button" aria-pressed={metric === "hours"} onclick={() => (metric = "hours")}>{m.unit_hours()}</button>
      <button type="button" aria-pressed={metric === "km"} onclick={() => (metric = "km")}>{m.unit_km()}</button>
    </div>
  </div>
  {#if volume.data?.length}<Chart option={volumeOption(volume.data, metric)} height={300} label={m.trends_volume()} />{:else if !volume.loading}<p class="muted">{m.empty_data()}</p>{/if}
</section>

<PaddlingCard {from} {to} filter={trainingFilter.sport} />

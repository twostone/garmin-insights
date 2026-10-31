<script lang="ts">
  import InfoTip from "$lib/components/InfoTip.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { weeklyBalanceOption, type WeekRow } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import { dateLabel, num } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import type { SportFilterValue } from "$lib/types.ts";

  // Weekly balance (ACWR, monotony, strain, intensity split, sport mix) for the Training load page.
  let { from, to, filter }: { from: string; to: string; filter: SportFilterValue } = $props();

  type Week = WeekRow & { load: number; monotony: number | null; strain: number | null; intensity_pct: { easy: number; moderate: number; hard: number } | null };
  const RECENT_WEEKS = 4;
  const MONOTONY_WARNING = 2; // same threshold as MONOTONY_WARNING in the backend

  const load = () => unwrap<Week[]>(api.analytics.weekly.$get({ query: { from, to, sport: filter.sport as never, custom_sport_id: filter.customSportId } }));
  const weeks = new Resource(load);

  $effect(() => {
    void [from, to, filter.sport, filter.customSportId, sync.finishedCount];
    void weeks.reload();
  });

  const recent = $derived((weeks.data ?? []).slice(-RECENT_WEEKS).reverse());
  const pct = (v: number | undefined) => (v === undefined ? "–" : `${num(v)} %`);
</script>

<section class="card">
  <h2>{m.weekly_title()}<InfoTip metric="acwr" /></h2>
  {#if weeks.data?.length}
    <Chart option={weeklyBalanceOption(weeks.data)} height={300} label={m.weekly_chart_label()} />
    <div class="table-scroll">
      <table>
        <caption class="muted small">{m.weekly_caption()}</caption>
        <thead>
          <tr>
            <th scope="col">{m.weekly_col_week()}</th>
            <th scope="col" class="r">{m.weekly_col_load()}</th>
            <th scope="col" class="r">{m.weekly_col_monotony()}<InfoTip metric="monotony" /></th>
            <th scope="col" class="r">{m.weekly_col_strain()}<InfoTip metric="strain" /></th>
            <th scope="col" class="r">{m.weekly_col_easy()}</th>
            <th scope="col" class="r">{m.weekly_col_hard()}</th>
          </tr>
        </thead>
        <tbody>
          {#each recent as w (w.week)}
            <tr>
              <th scope="row">{dateLabel(w.week, { day: "numeric", month: "short" })}</th>
              <td class="r">{num(w.load)}</td>
              <td class="r" title={w.monotony !== null && w.monotony > MONOTONY_WARNING ? m.weekly_monotony_high() : undefined}>{num(w.monotony, 1)}{w.monotony !== null && w.monotony > MONOTONY_WARNING ? " ⚠" : ""}</td>
              <td class="r">{num(w.strain)}</td>
              <td class="r">{pct(w.intensity_pct?.easy)}</td>
              <td class="r">{pct(w.intensity_pct?.hard)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if !weeks.loading}
    <p class="muted">{m.empty_data()}</p>
  {/if}
  <p class="muted small">{m.weekly_hint()}</p>
</section>

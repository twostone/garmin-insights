<script lang="ts">
  import InfoTip from "$lib/components/InfoTip.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { pmcOption } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import LoadHeatmap from "$lib/components/LoadHeatmap.svelte";
  import WeeklyBalanceCard from "$lib/components/WeeklyBalanceCard.svelte";
  import { addDays, formText, num, signed, today } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import { trainingFilter } from "$lib/training-filter.svelte.ts";

  const to = today();
  const from = $derived(addDays(to, -(trainingFilter.days - 1)));
  const pmc = new Resource(() => unwrap<{ date: string; ctl: number; atl: number; tsb: number; tss: number }[]>(api.analytics.pmc.$get({ query: { from, to } })));

  $effect(() => {
    void [from, sync.finishedCount];
    void pmc.reload();
  });
  const last = $derived(pmc.data?.at(-1));
</script>

<section class="card">
  <h2>{m.trends_pmc()}</h2>
  <div class="grid cols-3 stat">
    <div><div class="v">{num(last?.ctl, 0)}</div><div class="l">{m.chart_fitness()} (CTL)<InfoTip metric="ctl" /></div></div>
    <div><div class="v">{num(last?.atl, 0)}</div><div class="l">{m.chart_fatigue()} (ATL)<InfoTip metric="atl" /></div></div>
    <div><div class="v">{signed(last?.tsb, 0)}</div><div class="l">{m.chart_form()} (TSB)<InfoTip metric="tsb" /></div></div>
  </div>
  {#if last}<p class="muted small">{formText(last.tsb)}</p>{/if}
  {#if pmc.data?.length}<Chart option={pmcOption(pmc.data)} height={300} label={m.chart_pmc_label()} />{:else if !pmc.loading}<p class="muted">{m.empty_data()}</p>{/if}
  <p class="muted small">{m.trends_pmc_hint()}</p>
</section>

<LoadHeatmap {to} />
<WeeklyBalanceCard {from} {to} filter={trainingFilter.sport} />

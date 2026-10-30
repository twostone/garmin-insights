<script lang="ts">
  import { href } from "$lib/nav";
  import { api, unwrap } from "$lib/api.ts";
  import { m } from "$lib/paraglide/messages.js";
  import { pmcOption, volumeOption } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import ActivityRow from "$lib/components/ActivityRow.svelte";
  import { addDays, num, today } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import type { ActivityLite } from "$lib/types.ts";

  const to = today();
  const pmc = new Resource(() => unwrap<{ date: string; ctl: number; atl: number; tsb: number; tss: number }[]>(api.analytics.pmc.$get({ query: { from: addDays(to, -89), to } })));
  const recent = new Resource(() => unwrap<{ items: ActivityLite[] }>(api.activities.$get({ query: { limit: "5" } })));
  const volume = new Resource(() => unwrap<{ period: string; sport: string; duration_s: number; distance_m: number }[]>(api.analytics.volume.$get({ query: { from: addDays(to, -55), to, by: "week" } })));
  const trends = new Resource(() => unwrap<{ latest: Record<"restingHr" | "hrv" | "sleepHours", { avg7: number | null; deltaVsBaseline: number | null }> }>(api.analytics.trends.$get({ query: { from: addDays(to, -69), to } })));

  $effect(() => {
    void sync.finishedCount;
    for (const r of [pmc, recent, volume, trends]) void r.reload();
  });

  const last = $derived(pmc.data?.at(-1));
  const formText = $derived(
    !last ? "" : last.tsb > 15 ? m.form_fresh() : last.tsb > 5 ? m.form_transition() : last.tsb >= -10 ? m.form_neutral() : last.tsb >= -30 ? m.form_optimal() : m.form_overreach(),
  );
  const sign = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : ""}${num(v, 1)}`);
</script>

<h1>{m.nav_dashboard()}</h1>

{#if sync.needsKey}
  <section class="card stack">
    <h2>{m.onboarding_title()}</h2>
    <ol>
      <li>{m.onboarding_step1()}</li>
      <li>{m.onboarding_step2()}</li>
      <li>{m.onboarding_step3()}</li>
    </ol>
    <a class="btn primary" href={href("/settings")}>{m.onboarding_cta()}</a>
  </section>
{/if}

<section class="card">
  <div class="grid cols-3 stat">
    <div><div class="v">{num(last?.ctl, 0)}</div><div class="l">{m.chart_fitness()} (CTL)</div></div>
    <div><div class="v">{num(last?.atl, 0)}</div><div class="l">{m.chart_fatigue()} (ATL)</div></div>
    <div><div class="v">{sign(last?.tsb)}</div><div class="l">{m.chart_form()} (TSB)</div></div>
  </div>
  {#if formText}<p class="muted small">{formText}</p>{/if}
  {#if pmc.data?.length}
    <Chart option={pmcOption(pmc.data)} label={m.chart_pmc_label()} />
  {:else if !pmc.loading}
    <p class="muted">{m.empty_data()}</p>
  {/if}
</section>

<div class="two-col">
  <section class="card">
    <h2>{m.dashboard_weekly_volume()}</h2>
    {#if volume.data?.length}
      <Chart option={volumeOption(volume.data, "hours")} height={220} label={m.dashboard_weekly_volume()} />
    {:else if !volume.loading}<p class="muted">{m.empty_data()}</p>{/if}
  </section>

  <section class="card">
    <h2>{m.dashboard_health()}</h2>
    {#if trends.data}
      <div class="grid cols-3 stat">
        <div><div class="v">{num(trends.data.latest.restingHr.avg7, 0)}</div><div class="l">{m.metric_resting_hr()} <span class="small">({sign(trends.data.latest.restingHr.deltaVsBaseline)})</span></div></div>
        <div><div class="v">{num(trends.data.latest.hrv.avg7, 0)}</div><div class="l">{m.metric_hrv()} <span class="small">({sign(trends.data.latest.hrv.deltaVsBaseline)})</span></div></div>
        <div><div class="v">{num(trends.data.latest.sleepHours.avg7, 1)}</div><div class="l">{m.metric_sleep_hours()}</div></div>
      </div>
      <p class="muted small">{m.dashboard_health_hint()}</p>
    {/if}
  </section>
</div>

<section class="card">
  <div class="row between"><h2>{m.dashboard_recent()}</h2><a href={href("/activities")}>{m.show_all()}</a></div>
  {#each recent.data?.items ?? [] as activity (activity.id)}
    <ActivityRow {activity} />
  {:else}
    {#if !recent.loading}<p class="muted">{m.empty_data()}</p>{/if}
  {/each}
</section>


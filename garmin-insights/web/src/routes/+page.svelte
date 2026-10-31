<script lang="ts">
  import InfoTip from "$lib/components/InfoTip.svelte";
  import { href } from "$lib/nav";
  import { api, unwrap } from "$lib/api.ts";
  import { m } from "$lib/paraglide/messages.js";
  import { pmcSparkOption, sportCssColor, sportName } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import ActivityRow from "$lib/components/ActivityRow.svelte";
  import ReadinessCard from "$lib/components/ReadinessCard.svelte";
  import { addDays, dateLabel, formText, mondayOf, num, signed, today } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import type { ActivityLite } from "$lib/types.ts";

  const SPARK_DAYS = 42;
  const COMPARE_WEEKS = 4;
  const to = today();
  const thisWeek = mondayOf(to);

  const pmc = new Resource(() => unwrap<{ date: string; ctl: number; atl: number; tsb: number; tss: number }[]>(api.analytics.pmc.$get({ query: { from: addDays(to, -(SPARK_DAYS - 1)), to } })));
  const recent = new Resource(() => unwrap<{ items: ActivityLite[] }>(api.activities.$get({ query: { limit: "5" } })));
  const volume = new Resource(() => unwrap<{ period: string; sport: string; duration_s: number }[]>(api.analytics.volume.$get({ query: { from: addDays(thisWeek, -COMPARE_WEEKS * 7), to, by: "week" } })));

  $effect(() => {
    void sync.finishedCount;
    for (const r of [pmc, recent, volume]) void r.reload();
  });

  const last = $derived(pmc.data?.at(-1));

  // This week's hours per sport against the average of the weeks before (the marker on each bar).
  const week = $derived.by(() => {
    const rows = volume.data ?? [];
    const sports = [...new Set(rows.map((r) => r.sport))];
    const hours = (sport: string, current: boolean) => rows.filter((r) => r.sport === sport && (r.period === thisWeek) === current).reduce((a, r) => a + r.duration_s, 0) / 3600;
    const bars = sports
      .map((sport) => ({ sport, now: hours(sport, true), avg: hours(sport, false) / COMPARE_WEEKS }))
      .sort((a, b) => b.now - a.now || b.avg - a.avg);
    const max = Math.max(0, ...bars.flatMap((b) => [b.now, b.avg]));
    const total = (pick: (b: (typeof bars)[number]) => number) => bars.reduce((a, b) => a + pick(b), 0);
    return { bars, max, now: total((b) => b.now), avg: total((b) => b.avg) };
  });
  const share = (h: number) => (week.max > 0 ? `${(h / week.max) * 100}%` : "0%");
</script>

<p class="eyebrow">{dateLabel(to, { weekday: "long", day: "numeric", month: "long" })}</p>
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

<ReadinessCard />

<div class="two-col">
  <section class="card">
    <div class="head"><h2>{m.today_form()}</h2><a href={href("/training")}>{m.today_form_link()}</a></div>
    <div class="grid cols-3 stat">
      <div><div class="v">{num(last?.ctl, 0)}</div><div class="l">{m.chart_fitness()} (CTL)<InfoTip metric="ctl" /></div></div>
      <div><div class="v">{num(last?.atl, 0)}</div><div class="l">{m.chart_fatigue()} (ATL)<InfoTip metric="atl" /></div></div>
      <div><div class="v">{signed(last?.tsb, 0)}</div><div class="l">{m.chart_form()} (TSB)<InfoTip metric="tsb" /></div></div>
    </div>
    {#if pmc.data?.length}
      <Chart option={pmcSparkOption(pmc.data)} height={64} label={m.chart_pmc_spark_label()} />
    {:else if !pmc.loading}
      <p class="muted">{m.empty_data()}</p>
    {/if}
    {#if last}<p class="muted small">{formText(last.tsb)}</p>{/if}
  </section>

  <section class="card">
    <div class="head"><h2>{m.today_week()}</h2><a href={href("/training/volume")}>{m.today_week_link()}</a></div>
    {#if week.bars.length}
      <ul class="bars">
        {#each week.bars as b (b.sport)}
          <li>
            <span class="sport">{sportName(b.sport)}</span>
            <span class="track"><span class="fill" style:width={share(b.now)} style:background={sportCssColor(b.sport)}></span><span class="avg" style:left={share(b.avg)}></span></span>
            <span class="h num">{num(b.now, 1)} h</span>
          </li>
        {/each}
      </ul>
      <p class="muted small">{m.today_week_summary({ week: num(week.now, 1), avg: num(week.avg, 1) })}</p>
    {:else if !volume.loading}
      <p class="muted">{m.empty_data()}</p>
    {/if}
  </section>
</div>

<section class="card">
  <div class="head"><h2>{m.dashboard_recent()}</h2><a href={href("/activities")}>{m.show_all()}</a></div>
  {#each recent.data?.items ?? [] as activity (activity.id)}
    <ActivityRow {activity} />
  {:else}
    {#if !recent.loading}<p class="muted">{m.empty_data()}</p>{/if}
  {/each}
</section>

<style>
  .bars { list-style: none; margin: 0 0 0.5rem; padding: 0; display: grid; gap: 0.6rem; }
  .bars li { display: grid; grid-template-columns: minmax(0, 7rem) minmax(0, 1fr) 3.5rem; gap: 0.75rem; align-items: center; }
  .sport { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { position: relative; height: 10px; border-radius: 5px; background: var(--raised); }
  .fill { position: absolute; inset: 0 auto 0 0; border-radius: 5px; }
  /* Average of the weeks before: a thin mark across the bar. */
  .avg { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--text); border-radius: 1px; }
  .h { text-align: right; font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; }
</style>

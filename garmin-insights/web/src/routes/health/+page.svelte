<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { healthOption } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import { addDays, dateLabel, num, today } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";

  const RANGES = [30, 90, 180, 365] as const;
  let days = $state<number>(90);
  const to = today();
  const from = $derived(addDays(to, -(days - 1)));

  type Metric = { avg7: number | null; baseline28: number | null; deltaVsBaseline: number | null };
  type Trends = {
    points: { date: string; restingHr: number | null; restingHr7: number | null; hrv: number | null; hrv7: number | null; sleepHours: number | null; sleep7: number | null; atl: number | null }[];
    latest: { restingHr: Metric; hrv: Metric; sleepHours: Metric };
    correlations: { restingHrVsAtl: number | null; hrvVsAtl: number | null; sleepVsAtl: number | null };
  };
  const trends = new Resource(() => unwrap<Trends>(api.analytics.trends.$get({ query: { from, to } })));
  const sleep = new Resource(() => unwrap<{ date: string; sleep_s: number | null; deep_s: number | null; rem_s: number | null; score: number | null }[]>(api.health.sleep.$get({ query: { from: addDays(to, -13), to } })));
  const dailies = new Resource(() => unwrap<{ date: string; steps: number | null; body_battery_high: number | null; body_battery_low: number | null; stress_avg: number | null }[]>(api.health.daily.$get({ query: { from: addDays(to, -13), to } })));

  $effect(() => {
    void [from, sync.finishedCount];
    void trends.reload();
    void sleep.reload();
    void dailies.reload();
  });

  const sign = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : ""}${num(v, 1)}`);
  const hours = (s: number | null) => (s ? `${num(s / 3600, 1)} h` : "–");
  const corr = (v: number | null) => (v === null ? m.corr_unknown() : Math.abs(v) < 0.3 ? m.corr_none() : v > 0 ? m.corr_positive({ r: num(v, 2) }) : m.corr_negative({ r: num(v, 2) }));
  const cards = $derived(
    trends.data
      ? [
          { key: "restingHr" as const, title: m.metric_resting_hr(), unit: "bpm", digits: 0, metric: trends.data.latest.restingHr, correlation: trends.data.correlations.restingHrVsAtl },
          { key: "hrv" as const, title: m.metric_hrv(), unit: "ms", digits: 0, metric: trends.data.latest.hrv, correlation: trends.data.correlations.hrvVsAtl },
          { key: "sleep" as const, title: m.metric_sleep_hours(), unit: "h", digits: 1, metric: trends.data.latest.sleepHours, correlation: trends.data.correlations.sleepVsAtl },
        ]
      : [],
  );
</script>

<h1>{m.nav_health()}</h1>

<div class="chips" role="group" aria-label={m.range_label()} style="margin-bottom:1rem">
  {#each RANGES as d (d)}
    <button type="button" class="chip" aria-pressed={days === d} onclick={() => (days = d)}>{m.range_days({ days: d })}</button>
  {/each}
</div>

{#each cards as c (c.key)}
  <section class="card">
    <div class="row between">
      <h2>{c.title}</h2>
      <div class="num"><strong>{num(c.metric.avg7, c.digits)} {c.unit}</strong> <span class="muted small">{m.health_vs_baseline({ delta: sign(c.metric.deltaVsBaseline) })}</span></div>
    </div>
    {#if trends.data}<Chart option={healthOption(trends.data.points, c.key, c.title)} height={220} label={c.title} />{/if}
    <p class="muted small">{m.health_load_relation({ text: corr(c.correlation) })}</p>
  </section>
{/each}
{#if trends.loading && !trends.data}<p class="muted">{m.loading()}</p>{/if}

<div class="two-col">
  <section class="card">
    <h2>{m.health_sleep_recent()}</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>{m.metric_date()}</th><th class="r">{m.sleep_total()}</th><th class="r">{m.sleep_deep()}</th><th class="r">{m.sleep_rem()}</th><th class="r">{m.sleep_score()}</th></tr></thead>
      <tbody>{#each [...(sleep.data ?? [])].reverse() as s (s.date)}
        <tr><td>{dateLabel(s.date, { weekday: "short", day: "numeric", month: "short" })}</td><td class="r">{hours(s.sleep_s)}</td><td class="r">{hours(s.deep_s)}</td><td class="r">{hours(s.rem_s)}</td><td class="r">{num(s.score)}</td></tr>
      {:else}<tr><td colspan="5" class="muted">{m.empty_data()}</td></tr>{/each}</tbody>
    </table></div>
  </section>
  <section class="card">
    <h2>{m.health_daily_recent()}</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>{m.metric_date()}</th><th class="r">{m.daily_steps()}</th><th class="r">{m.daily_body_battery()}</th><th class="r">{m.daily_stress()}</th></tr></thead>
      <tbody>{#each [...(dailies.data ?? [])].reverse() as d (d.date)}
        <tr><td>{dateLabel(d.date, { weekday: "short", day: "numeric", month: "short" })}</td><td class="r">{num(d.steps)}</td><td class="r">{d.body_battery_low ?? "–"}–{d.body_battery_high ?? "–"}</td><td class="r">{num(d.stress_avg)}</td></tr>
      {:else}<tr><td colspan="4" class="muted">{m.empty_data()}</td></tr>{/each}</tbody>
    </table></div>
  </section>
</div>

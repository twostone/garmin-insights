<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import ActivityRow from "$lib/components/ActivityRow.svelte";
  import SportFilter from "$lib/components/SportFilter.svelte";
  import { addDays, dateLabel, duration, km, today } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import { sportQuery } from "$lib/sport-filter.ts";
  import type { ActivityLite, SportFilterValue } from "$lib/types.ts";

  const PAGE = 30;

  let sportFilter = $state<SportFilterValue>({});
  let from = $state("");
  let to = $state("");
  let view = $state<"list" | "calendar">("list");
  let items = $state<ActivityLite[]>([]);
  let total = $state(0);
  let month = $state(today().slice(0, 7));

  const query = (offset: number) => ({
    limit: String(PAGE), offset: String(offset),
    ...sportQuery(sportFilter), ...(from ? { from } : {}), ...(to ? { to } : {}),
  });
  const list = new Resource(async () => {
    const r = await unwrap<{ items: ActivityLite[]; total: number }>(api.activities.$get({ query: query(0) as never }));
    items = r.items;
    total = r.total;
    return r;
  });
  async function more() {
    const r = await unwrap<{ items: ActivityLite[]; total: number }>(api.activities.$get({ query: query(items.length) as never }));
    items = [...items, ...r.items];
  }

  // Calendar: per-day totals of one month; a click filters the list to that day.
  const monthRange = $derived.by(() => {
    const first = `${month}-01`;
    const next = new Date(Date.parse(`${first}T00:00:00Z`));
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { first, last: addDays(next.toISOString().slice(0, 10), -1) };
  });
  const calendar = new Resource(() => unwrap<{ date: string; count: number; duration_s: number; distance_m: number }[]>(api.activities.calendar.$get({ query: { from: monthRange.first, to: monthRange.last } })));
  $effect(() => {
    void monthRange;
    void calendar.reload();
  });
  const byDate = $derived(new Map((calendar.data ?? []).map((d) => [d.date, d])));
  const leadingBlanks = $derived((new Date(`${monthRange.first}T00:00:00Z`).getUTCDay() + 6) % 7);
  const days = $derived(Array.from({ length: Number(monthRange.last.slice(8)) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`));
  const shiftMonth = (delta: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    month = d.toISOString().slice(0, 7);
  };
  const weekdays = $derived(Array.from({ length: 7 }, (_, i) => dateLabel(addDays("2026-10-05", i), { weekday: "short" })));

  function filter() {
    void list.reload();
  }
  function pickDay(date: string) {
    from = to = date;
    view = "list";
    filter();
  }
  const dateRangeLabel = $derived(from || to ? `${from ? dateLabel(from) : "…"} – ${to ? dateLabel(to) : "…"}` : m.filter_any_date());
  $effect(() => {
    void sync.finishedCount;
    void list.reload();
  });
</script>

<h1>{m.nav_activities()}</h1>

<div class="filter-bar pair">
  <SportFilter bind:value={sportFilter} onchange={filter} />
  <div class="seg" role="group" aria-label={m.view_label()}>
    <button type="button" aria-pressed={view === "list"} onclick={() => (view = "list")}>{m.view_list()}</button>
    <button type="button" aria-pressed={view === "calendar"} onclick={() => (view = "calendar")}>{m.view_calendar()}</button>
  </div>
</div>
<!-- The date range is used less often: folded away, the summary shows what is set. -->
<details class="card date-filter" open={!!(from || to)}>
  <summary>{m.range_label()}: <span class="muted">{dateRangeLabel}</span></summary>
  <div class="grid cols-2">
    <div><label for="from">{m.filter_from()}</label><input id="from" type="date" bind:value={from} onchange={filter} /></div>
    <div><label for="to">{m.filter_to()}</label><input id="to" type="date" bind:value={to} onchange={filter} /></div>
  </div>
</details>

{#if view === "list"}
  <section class="card">
    {#each items as activity (activity.id)}
      <ActivityRow {activity} />
    {:else}
      <p class="muted">{list.loading ? m.loading() : m.empty_activities()}</p>
    {/each}
    {#if items.length < total}
      <button type="button" onclick={more}>{m.load_more({ shown: items.length, total })}</button>
    {/if}
  </section>
{:else}
  <section class="card">
    <div class="row between">
      <button type="button" onclick={() => shiftMonth(-1)} aria-label={m.calendar_prev()}>‹</button>
      <strong>{dateLabel(monthRange.first, { month: "long", year: "numeric" })}</strong>
      <button type="button" onclick={() => shiftMonth(1)} aria-label={m.calendar_next()}>›</button>
    </div>
    <div class="cal" style="margin-top:0.75rem">
      {#each weekdays as w (w)}<div class="h">{w}</div>{/each}
      {#each Array(leadingBlanks) as _, i (i)}<div></div>{/each}
      {#each days as date (date)}
        {@const d = byDate.get(date)}
        <button type="button" class="d" class:has={!!d} disabled={!d} onclick={() => pickDay(date)}>
          <span>{Number(date.slice(8))}</span>
          {#if d}<span class="small num" style="display:block">{d.distance_m > 1000 ? km(d.distance_m, 0) : duration(d.duration_s)}</span>{/if}
        </button>
      {/each}
    </div>
  </section>
{/if}

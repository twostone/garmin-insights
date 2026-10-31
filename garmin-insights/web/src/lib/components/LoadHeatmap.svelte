<script lang="ts">
  import { api, unwrap } from "$lib/api.ts";
  import { addDays, dateLabel, num } from "$lib/format.ts";
  import { m } from "$lib/paraglide/messages.js";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";

  // Calendar heatmap of the daily load (TSS) of the last 12 weeks up to `to`. A plain grid instead of a chart: each day is a
  // real element with a text label, so it works with keyboard and screen readers; colour intensity is only a visual extra.
  const { to }: { to: string } = $props();

  const WEEKS = 12;
  const DAYS_PER_WEEK = 7;
  const LEVELS = 4;
  type Day = { date: string; count: number; tss: number };

  /** Monday of the week containing `date`. */
  const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
  const firstDay = $derived(addDays(mondayOf(to), -(WEEKS - 1) * DAYS_PER_WEEK));

  const calendar = new Resource(() => unwrap<(Day & { duration_s: number; distance_m: number })[]>(api.activities.calendar.$get({ query: { from: firstDay, to } })));
  $effect(() => {
    void sync.finishedCount;
    void firstDay;
    void calendar.reload();
  });

  const byDate = $derived(new Map((calendar.data ?? []).map((d) => [d.date, d])));
  const maxTss = $derived(Math.max(0, ...(calendar.data ?? []).map((d) => d.tss)));
  // Columns are weeks, rows Monday..Sunday; days after `to` are left empty.
  const weeks = $derived(
    Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: DAYS_PER_WEEK }, (_, d) => {
        const date = addDays(firstDay, w * DAYS_PER_WEEK + d);
        return date > to ? null : { date, ...(byDate.get(date) ?? { count: 0, tss: 0 }) };
      }),
    ),
  );

  const level = (tss: number) => (tss <= 0 || maxTss <= 0 ? 0 : Math.min(LEVELS, Math.ceil((tss / maxTss) * LEVELS)));
  const title = (d: Day) => (d.count ? m.heatmap_day({ date: dateLabel(d.date), tss: num(d.tss), count: d.count }) : m.heatmap_rest({ date: dateLabel(d.date) }));
</script>

<section class="card">
  <h2>{m.heatmap_title()}</h2>
  {#if calendar.data}
    <div class="heat" role="list">
      {#each weeks as week}
        <div class="col" role="presentation">
          {#each week as day}
            {#if day}
              <div class="cell l{level(day.tss)}" role="listitem" title={title(day)} aria-label={title(day)}></div>
            {:else}
              <div class="cell empty" aria-hidden="true"></div>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
    <p class="legend muted small">{m.heatmap_legend_less()} {#each Array(LEVELS + 1) as _, l}<span class="cell l{l}" aria-hidden="true"></span>{/each} {m.heatmap_legend_more()}</p>
  {:else if !calendar.loading}
    <p class="muted">{m.empty_data()}</p>
  {/if}
</section>

<style>
  .heat { display: grid; grid-template-columns: repeat(12, minmax(0, 28px)); gap: 4px; }
  .col { display: grid; grid-template-rows: repeat(7, 1fr); gap: 4px; }
  .cell { aspect-ratio: 1; min-height: 14px; border-radius: 3px; background: var(--border); }
  .l1 { background: color-mix(in srgb, var(--accent) 30%, var(--border)); }
  .l2 { background: color-mix(in srgb, var(--accent) 55%, var(--border)); }
  .l3 { background: color-mix(in srgb, var(--accent) 80%, var(--border)); }
  .l4 { background: var(--accent); }
  .empty { background: transparent; }
  .legend { display: flex; align-items: center; gap: 4px; margin-top: 0.75rem; }
  .legend .cell { width: 14px; aspect-ratio: 1; }
</style>

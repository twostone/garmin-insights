<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { paddlingOption, type PaddlingWeek } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import type { SportFilterValue } from "$lib/types.ts";

  // Paddling trends per own sport for the Training volume page: weekly distance (bars), average speed and efficiency (lines).
  // Without paddling activities in the range the card stays hidden.
  let { from, to, filter }: { from: string; to: string; filter: SportFilterValue } = $props();

  const weeks = new Resource(() => unwrap<PaddlingWeek[]>(api.analytics.paddling.$get({ query: { from, to, ...(filter.customSportId !== undefined ? { custom_sport_id: String(filter.customSportId) } : {}) } })));

  $effect(() => {
    void [from, to, filter.customSportId, sync.finishedCount];
    void weeks.reload();
  });
</script>

{#if weeks.data?.length}
  <section class="card">
    <h2>{m.paddling_title()}</h2>
    <Chart option={paddlingOption(weeks.data)} height={280} label={m.paddling_title()} />
    <p class="muted small">{m.paddling_efficiency_hint()}</p>
  </section>
{/if}

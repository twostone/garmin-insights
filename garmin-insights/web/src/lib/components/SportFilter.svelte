<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { api, unwrap } from "$lib/api.ts";
  import { sportName } from "$lib/charts.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import type { CustomSportList, SportFilterValue } from "$lib/types.ts";

  // Shared sport filter of a page: Garmin-derived sports plus the user's own. At most one is active; none means "all".
  let { value = $bindable({}), onchange }: { value?: SportFilterValue; onchange?: () => void } = $props();

  const SPORTS = ["running", "cycling", "swimming", "strength", "walking", "hiking", "paddling", "rowing", "other"] as const;
  const custom = new Resource(() => unwrap<CustomSportList>(api["custom-sports"].$get()));
  $effect(() => void custom.reload());

  function pick(next: SportFilterValue) {
    value = next;
    onchange?.();
  }
</script>

<div class="chips" role="group" aria-label={m.filter_sport()}>
  <button type="button" class="chip" aria-pressed={value.sport === undefined && value.customSportId === undefined} onclick={() => pick({})}>{m.filter_all()}</button>
  {#each SPORTS as s (s)}
    <button type="button" class="chip" aria-pressed={value.sport === s} onclick={() => pick({ sport: s })}>{sportName(s)}</button>
  {/each}
  {#each custom.data?.items ?? [] as c (c.id)}
    <button type="button" class="chip" aria-pressed={value.customSportId === c.id} onclick={() => pick({ customSportId: c.id })}>{c.name}</button>
  {/each}
</div>

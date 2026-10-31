<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { sportName } from "$lib/charts.ts";
  import { customSports } from "$lib/custom-sports.svelte.ts";
  import { KNOWN_SPORTS } from "$lib/format.ts";
  import type { SportFilterValue } from "$lib/types.ts";

  // Shared sport filter of a page: the user's own sports, then the Garmin-derived sports they actually have. At most one
  // is active; none means "all". A native <select>: compact, and the system picker on phones.
  let { value = $bindable({}), onchange }: { value?: SportFilterValue; onchange?: () => void } = $props();

  const present = $derived(KNOWN_SPORTS.filter((s) => customSports.data?.garmin_types.some((t) => t.sport === s) || value.sport === s));
  const selected = $derived(value.customSportId !== undefined ? `c:${value.customSportId}` : value.sport ? `s:${value.sport}` : "");

  function pick(option: string) {
    const [kind, id] = [option.slice(0, 1), option.slice(2)];
    value = kind === "c" ? { customSportId: Number(id) } : kind === "s" ? { sport: id } : {};
    onchange?.();
  }
</script>

<select class="sport-filter" aria-label={m.filter_sport()} value={selected} onchange={(e) => pick(e.currentTarget.value)}>
  <option value="">{m.filter_all_sports()}</option>
  {#if customSports.data?.items.length}
    <optgroup label={m.filter_group_custom()}>
      {#each customSports.data.items as c (c.id)}<option value={`c:${c.id}`}>{c.name}</option>{/each}
    </optgroup>
  {/if}
  <optgroup label={m.filter_group_garmin()}>
    {#each present as s (s)}<option value={`s:${s}`}>{sportName(s)}</option>{/each}
  </optgroup>
</select>

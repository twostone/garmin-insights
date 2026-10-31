<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  // The one control for a page's time range: a segmented row of preset ranges in days.
  let { value = $bindable(), options }: { value: number; options: { days: number; label: string }[] } = $props();
</script>

<div class="seg" role="group" aria-label={m.range_label()}>
  {#each options as o (o.days)}
    <button type="button" aria-pressed={value === o.days} onclick={() => (value = o.days)}>{o.label}</button>
  {/each}
</div>

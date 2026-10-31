<script lang="ts">
  import type { SportFilterValue } from "$lib/types.ts";

  // Shared sport filter of a page (Garmin-derived sports plus the user's own). Placeholder: the chips follow with the
  // custom-sports work; until then the filter stays "all".
  let { value = $bindable({}) }: { value?: SportFilterValue } = $props();
</script>

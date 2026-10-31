<script lang="ts">
  import { href } from "$lib/nav";
  import { m } from "$lib/paraglide/messages.js";
  import RangePicker from "$lib/components/RangePicker.svelte";
  import SportFilter from "$lib/components/SportFilter.svelte";
  import SubNav from "$lib/components/SubNav.svelte";
  import { TRAINING_RANGES, trainingFilter } from "$lib/training-filter.svelte.ts";

  let { children } = $props();

  const sections = [
    { route: "/training", href: href("/training"), label: m.training_load() },
    { route: "/training/volume", href: href("/training/volume"), label: m.training_volume() },
    { route: "/training/performance", href: href("/training/performance"), label: m.training_performance() },
    { route: "/training/strength", href: href("/training/strength"), label: m.training_strength() },
  ];
  const shortLabel = (d: number) => (d === 90 ? m.range_short_3m() : d === 180 ? m.range_short_6m() : d === 365 ? m.range_short_1y() : m.range_short_5y());
  const ranges = TRAINING_RANGES.map((days) => ({ days, label: shortLabel(days) }));
</script>

<h1>{m.nav_training()}</h1>
<SubNav items={sections} label={m.training_sections()} />
<div class="filter-bar">
  <RangePicker bind:value={trainingFilter.days} options={ranges} />
  <SportFilter bind:value={trainingFilter.sport} />
</div>

{@render children()}

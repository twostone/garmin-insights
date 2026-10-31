<script lang="ts">
  import { page } from "$app/state";

  // Sub-pages of one section as pills. `route` is the SvelteKit route id (matched exactly), `href` the link from $lib/nav.
  let { items, label }: { items: { route: string; href: string; label: string }[]; label: string } = $props();
</script>

<nav class="subnav" aria-label={label}>
  {#each items as item (item.route)}
    <a href={item.href} aria-current={page.route.id === item.route ? "page" : undefined}>{item.label}</a>
  {/each}
</nav>

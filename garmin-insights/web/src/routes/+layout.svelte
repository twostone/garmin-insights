<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  let { children } = $props();
</script>

<main>
  <h1>{m.app_name()}</h1>
  {@render children()}
</main>

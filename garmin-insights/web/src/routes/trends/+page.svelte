<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { href } from "$lib/nav";

  // "Trends" became "Training": old bookmarks and installed shortcuts land on the new page. Only after SvelteKit's own
  // navigation has finished: a hash change while the app is still starting is lost and leaves an empty page.
  afterNavigate(() => location.replace(href("/training")));
</script>

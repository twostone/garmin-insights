<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { session } from "$lib/session.svelte.ts";

  const TOOLS = ["list_activities", "get_activity", "get_activity_samples", "get_strength_sets", "compare_activities", "get_training_load", "get_zone_distribution", "get_volume", "get_best_efforts", "get_health_trends", "get_athlete_settings", "trigger_sync"];

  const url = $derived(session.context.mcpUrl);
  const command = $derived(url ? `claude mcp add --transport http garmin ${url}` : "");
  let copied = $state<string | null>(null);

  // The Companion app's webview may refuse the async clipboard API; selecting the text is the fallback.
  async function copy(id: string, text: string, field?: HTMLInputElement) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      field?.select();
      return;
    }
    copied = id;
    setTimeout(() => (copied = copied === id ? null : copied), 2000);
  }
  let urlField: HTMLInputElement | undefined = $state();
</script>

<section class="card stack">
  <h2>{m.settings_mcp()}</h2>
  {#if url}
    <p class="muted small">{m.mcp_help()}</p>
    <div class="field"><label for="mcp-url">{m.mcp_url()}</label>
      <div class="row"><input id="mcp-url" type="text" readonly value={url} bind:this={urlField} onfocus={(e) => e.currentTarget.select()} style="flex: 1; min-width: 12rem" />
        <button type="button" onclick={() => copy("url", url, urlField)}>{copied === "url" ? m.mcp_copied() : m.mcp_copy()}</button></div></div>
    <p class="small">{m.mcp_generic()}</p>
    <p class="small">{m.mcp_claude_ai()}</p>
    <p class="small">{m.mcp_claude_code()}</p>
    <div class="row"><code class="small" style="flex: 1; min-width: 12rem; overflow-wrap: anywhere">{command}</code>
      <button type="button" onclick={() => copy("cmd", command)}>{copied === "cmd" ? m.mcp_copied() : m.mcp_copy()}</button></div>
    <p class="muted small">{m.mcp_tools({ tools: TOOLS.join(", ") })}</p>
  {:else}
    <p class="muted">{m.mcp_unavailable()}</p>
  {/if}
</section>

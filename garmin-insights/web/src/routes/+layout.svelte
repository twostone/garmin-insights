<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { m } from "$lib/paraglide/messages.js";
  import { session } from "$lib/session.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import { registerServiceWorker } from "$lib/pwa.ts";
  import { phaseName } from "$lib/charts.ts";

  let { children } = $props();

  const tabs = [
    { id: "/", label: () => m.nav_dashboard() },
    { id: "/activities", label: () => m.nav_activities() },
    { id: "/trends", label: () => m.nav_trends() },
    { id: "/health", label: () => m.nav_health() },
    { id: "/settings", label: () => m.nav_settings() },
  ] as const;
  const active = (id: string) => (id === "/" ? page.route.id === "/" : (page.route.id ?? "").startsWith(id));

  onMount(async () => {
    await session.init();
    if (session.external) registerServiceWorker(); // installable PWA only on the external origin, never under ingress
  });

  $effect(() => {
    if (session.status === "authenticated") void sync.start();
  });

  const key = $derived(sync.progress?.key);
  const pending = $derived(sync.progress?.fit.pending ?? 0);
  const total = $derived((sync.progress?.fit.done ?? 0) + pending);
  const loginError = $derived(
    session.error === "network" ? m.login_error_network() : session.error === "denied" ? m.login_error_denied() : session.error ? m.login_error_generic() : null,
  );
</script>

<svelte:head><title>{m.app_name()}</title></svelte:head>

{#if session.status === "loading"}
  <div class="page"><p class="muted">{m.loading()}</p></div>
{:else if session.status === "anonymous"}
  <div class="page stack">
    <h1>{m.app_name()}</h1>
    <div class="card stack">
      <p>{m.login_intro()}</p>
      {#if loginError}<p class="danger" role="alert">{loginError}</p>{/if}
      <button type="button" class="primary" onclick={() => session.login()}>{m.login_button()}</button>
    </div>
  </div>
{:else}
  <nav class="tabs" aria-label={m.app_name()}>
    {#each tabs as tab (tab.id)}
      <a href={resolve(tab.id)} aria-current={active(tab.id) ? "page" : undefined}>{tab.label()}</a>
    {/each}
  </nav>

  <div class="page">
    {#if key && key.status === "invalid"}
      <div class="banner danger" role="alert">{m.banner_key_invalid()} <a href={resolve("/settings")}>{m.nav_settings()}</a></div>
    {:else if key && key.status === "expired"}
      <div class="banner danger" role="alert">{m.banner_key_expired()} <a href={resolve("/settings")}>{m.nav_settings()}</a></div>
    {:else if key && key.daysLeft !== null && key.daysLeft <= 7}
      <div class="banner warn" role="status">{m.banner_key_expiring({ days: key.daysLeft })} <a href={resolve("/settings")}>{m.nav_settings()}</a></div>
    {/if}

    {#if sync.progress?.running || pending > 0}
      <div class="banner" role="status" aria-live="polite">
        <div class="row between">
          <strong>{sync.progress?.running ? m.banner_syncing() : m.banner_sync_paused()}</strong>
          {#if sync.progress?.phase}<span class="muted small">{m.sync_phase_label({ phase: phaseName(sync.progress.phase) })}</span>{/if}
        </div>
        {#if total > 0}
          <progress max={total} value={total - pending} aria-label={m.banner_fit_progress()}></progress>
          <div class="muted small">{m.banner_fit_counts({ done: total - pending, total })}</div>
        {/if}
      </div>
    {/if}

    {@render children()}
  </div>
{/if}

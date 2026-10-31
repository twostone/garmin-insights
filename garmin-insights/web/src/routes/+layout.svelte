<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { href } from "$lib/nav";
  import { m } from "$lib/paraglide/messages.js";
  import { session } from "$lib/session.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import { customSports } from "$lib/custom-sports.svelte.ts";
  import { registerServiceWorker } from "$lib/pwa.ts";
  import { phaseName } from "$lib/charts.ts";

  let { children } = $props();

  // Each tab has a small line icon (SVG path data, 24 × 24, drawn with the current text colour).
  const tabs = [
    { id: "/", label: () => m.nav_dashboard(), icon: "M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" },
    { id: "/activities", label: () => m.nav_activities(), icon: "M4 6h16M4 12h16M4 18h10" },
    { id: "/training", label: () => m.nav_training(), icon: "M3 17l5-6 4 3 4-7 5 6" },
    { id: "/health", label: () => m.nav_health(), icon: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" },
    { id: "/settings", label: () => m.nav_settings(), icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" },
  ] as const;
  const active = (id: string) => (id === "/" ? page.route.id === "/" : (page.route.id ?? "").startsWith(id));

  onMount(async () => {
    await session.init();
    if (session.external) registerServiceWorker(); // installable PWA only on the external origin, never under ingress
  });

  $effect(() => {
    if (session.status === "authenticated") void sync.start();
  });
  // Own sports are needed on every page (names, colours, filter); a sync can bring new Garmin types to offer.
  $effect(() => {
    void sync.finishedCount;
    if (session.status === "authenticated") void customSports.reload();
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
      <a href={href(tab.id)} aria-current={active(tab.id) ? "page" : undefined}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={tab.icon} /></svg>
        <span>{tab.label()}</span>
      </a>
    {/each}
  </nav>

  <div class="page">
    {#if key && key.status === "invalid"}
      <div class="banner danger" role="alert">{m.banner_key_invalid()} <a href={href("/settings")}>{m.nav_settings()}</a></div>
    {:else if key && key.status === "expired"}
      <div class="banner danger" role="alert">{m.banner_key_expired()} <a href={href("/settings")}>{m.nav_settings()}</a></div>
    {:else if key && key.daysLeft !== null && key.daysLeft <= 7}
      <div class="banner warn" role="status">{m.banner_key_expiring({ days: key.daysLeft })} <a href={href("/settings")}>{m.nav_settings()}</a></div>
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

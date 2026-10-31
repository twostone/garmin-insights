<script lang="ts">
  import { api, unwrap } from "$lib/api.ts";
  import { num, today } from "$lib/format.ts";
  import { m } from "$lib/paraglide/messages.js";
  import { Resource } from "$lib/resource.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";

  // Readiness of the day (HRV, resting HR, sleep, body battery, form) for the overview. The colour is never the only signal:
  // every status also has an icon and a word.
  type Status = "good" | "watch" | "poor" | "unknown";
  type Key = "hrv" | "resting_hr" | "sleep" | "body_battery" | "tsb";
  type Readiness = { date: string; status: Status; components: { key: Key; value: number | null; reference: number | null; status: Status }[] };

  const readiness = new Resource(() => unwrap<Readiness>(api.analytics.readiness.$get({ query: { date: today() } })));
  $effect(() => {
    void sync.finishedCount;
    void readiness.reload();
  });

  const ICON: Record<Status, string> = { good: "●", watch: "▲", poor: "■", unknown: "○" };
  const headline = (s: Status) => ({ good: m.readiness_good(), watch: m.readiness_watch(), poor: m.readiness_poor(), unknown: m.readiness_unknown() })[s];
  const statusText = (s: Status) => ({ good: m.readiness_status_good(), watch: m.readiness_status_watch(), poor: m.readiness_status_poor(), unknown: m.readiness_status_unknown() })[s];
  const label = (k: Key) => ({ hrv: m.readiness_hrv(), resting_hr: m.readiness_resting_hr(), sleep: m.readiness_sleep(), body_battery: m.readiness_body_battery(), tsb: m.readiness_tsb() })[k];
  const signed = (v: number) => `${v > 0 ? "+" : ""}${num(v, 1)}`;

  function reason(c: Readiness["components"][number]): string {
    if (c.value === null) return m.readiness_reason_none();
    const reference = c.reference;
    switch (c.key) {
      case "hrv": return m.readiness_reason_hrv({ value: num(c.value), reference: num(reference, 0) });
      case "resting_hr": return reference === null ? `${num(c.value)} bpm` : m.readiness_reason_resting_hr({ value: num(c.value), reference: num(reference, 1) });
      case "sleep": return reference === null ? m.readiness_reason_sleep_no_ref({ value: num(c.value, 1) }) : m.readiness_reason_sleep({ value: num(c.value, 1), reference: num(reference, 1) });
      case "body_battery": return m.readiness_reason_body_battery({ value: num(c.value) });
      case "tsb": return m.readiness_reason_tsb({ value: signed(c.value), reference: num(reference, 0) });
    }
  }
</script>

<section class="card stack">
  <h2>{m.readiness_title()}</h2>
  {#if readiness.data}
    <p class="overall {readiness.data.status}"><span aria-hidden="true">{ICON[readiness.data.status]}</span> <strong>{headline(readiness.data.status)}</strong></p>
    <ul class="components">
      {#each readiness.data.components as c (c.key)}
        <li>
          <span class="status {c.status}"><span aria-hidden="true">{ICON[c.status]}</span> {statusText(c.status)}</span>
          <span class="name">{label(c.key)}</span>
          <span class="muted small">{reason(c)}</span>
        </li>
      {/each}
    </ul>
    <p class="muted small">{m.readiness_hint()}</p>
  {:else if !readiness.loading}
    <p class="muted">{m.empty_data()}</p>
  {/if}
</section>

<style>
  .components { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .components li { display: grid; grid-template-columns: 7.5rem 1fr; column-gap: 0.75rem; align-items: baseline; min-height: 44px; align-content: center; }
  .components li .muted { grid-column: 2; }
  .name { font-weight: 600; grid-column: 2; grid-row: 1; }
  .status { grid-column: 1; grid-row: 1 / span 2; font-weight: 600; }
  .overall { font-size: 1.25rem; margin: 0; }
  .good { color: var(--good); }
  .watch { color: var(--warn); }
  .poor { color: var(--danger); }
  .unknown { color: var(--muted); }
</style>

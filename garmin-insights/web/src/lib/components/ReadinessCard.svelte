<script lang="ts">
  import InfoTip from "$lib/components/InfoTip.svelte";
  import { api, unwrap } from "$lib/api.ts";
  import { num, signed, today } from "$lib/format.ts";
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

  // Ring: one segment per component, coloured by its status (no invented overall score).
  const RING_RADIUS = 52;
  const RING_STROKE = 12;
  const RING_GAP = 6;
  const circumference = 2 * Math.PI * RING_RADIUS;
  const components = $derived(readiness.data?.components ?? []);
  const segment = $derived(circumference / Math.max(1, components.length));
  const inRange = $derived(components.filter((c) => c.status === "good").length);

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

<section class="card">
  <h2>{m.readiness_title()}</h2>
  {#if readiness.data}
    <div class="hero">
      <svg viewBox="0 0 132 132" width="132" height="132" role="img" aria-label={m.readiness_ring_label({ good: inRange, total: components.length })}>
        {#each components as c, k (c.key)}
          <!-- Round caps add half the stroke at each end, so the dash is shortened by one stroke width. -->
          <circle cx="66" cy="66" r={RING_RADIUS} fill="none" class="seg-{c.status}" stroke-width={RING_STROKE} stroke-linecap="round"
            stroke-dasharray="{Math.max(1, segment - RING_GAP - RING_STROKE)} {circumference}" stroke-dashoffset={-k * segment} transform="rotate(-90 66 66)" />
        {/each}
        <text x="66" y="64" text-anchor="middle" class="ring-value">{inRange}/{components.length}</text>
        <text x="66" y="84" text-anchor="middle" class="ring-label">{m.readiness_ring_in_range()}</text>
      </svg>
      <div>
        <p class="overall {readiness.data.status}"><span aria-hidden="true">{ICON[readiness.data.status]}</span> {headline(readiness.data.status)}</p>
        <p class="muted small">{m.readiness_hint()}</p>
      </div>
    </div>
    <ul class="components">
      {#each components as c (c.key)}
        <li>
          <span class="name">{label(c.key)}<InfoTip metric={c.key} /></span>
          <span class="status {c.status}"><span aria-hidden="true">{ICON[c.status]}</span> {statusText(c.status)}</span>
          <span class="muted small reason">{reason(c)}</span>
        </li>
      {/each}
    </ul>
  {:else if !readiness.loading}
    <p class="muted">{m.empty_data()}</p>
  {/if}
</section>

<style>
  .hero { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 1rem; align-items: center; margin-bottom: 1rem; }
  .overall { font-family: var(--font-display); font-size: 1.8rem; font-weight: 700; text-transform: uppercase; line-height: 1.05; margin: 0 0 0.4rem; }
  .ring-value { font-family: var(--font-display); font-size: 30px; font-weight: 700; fill: var(--text); }
  .ring-label { font-family: var(--font-display); font-size: 13px; letter-spacing: 1px; text-transform: uppercase; fill: var(--muted); }
  .seg-good { stroke: var(--good); }
  .seg-watch { stroke: var(--warn); }
  .seg-poor { stroke: var(--danger); }
  .seg-unknown { stroke: var(--raised); }
  .components { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  @media (min-width: 640px) { .components { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .components li { background: var(--raised); border-radius: 12px; padding: 0.55rem 0.75rem; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 0.75rem; align-content: center; min-height: 44px; }
  .name { font-weight: 600; }
  .status { font-weight: 600; font-size: 0.9rem; }
  .reason { grid-column: 1 / -1; }
  .good { color: var(--good); }
  .watch { color: var(--warn); }
  .poor { color: var(--danger); }
  .unknown { color: var(--muted); }
</style>

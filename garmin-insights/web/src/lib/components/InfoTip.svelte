<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { METRIC_INFO, type Metric } from "$lib/metric-info.ts";

  // A small "i" next to a metric that opens its explanation. Native popover: opens on tap, closes on Esc or a tap
  // elsewhere, no script. From 640 px it sits next to the button (CSS anchor positioning where supported), on phones and
  // in older browsers it is centred on the screen.
  let { metric }: { metric: Metric } = $props();
  const id = $props.id();
  const info = $derived(METRIC_INFO[metric]);
</script>

<button type="button" class="info" popovertarget="tip-{id}" aria-label={m.info_open({ term: info.title() })} style:anchor-name="--tip-{id}">
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 7v4.5M8 4.6v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
</button>
<span popover id="tip-{id}" class="tip" role="dialog" aria-labelledby="tip-{id}-title" style:position-anchor="--tip-{id}">
  <strong id="tip-{id}-title" class="title">{info.title()}</strong>
  <span class="text">{info.text()}</span>
  <button type="button" class="close" popovertarget="tip-{id}" popovertargetaction="hide">{m.info_close()}</button>
</span>

<style>
  /* Visually small, but the ::before extends the hit area to 44 × 44 px. */
  .info {
    position: relative; display: inline-grid; place-items: center; vertical-align: -0.15em;
    width: 22px; height: 22px; min-height: 0; padding: 0; margin-left: 0.3rem;
    border: 0; border-radius: 50%; background: none; color: var(--muted);
  }
  .info::before { content: ""; position: absolute; inset: -11px; }
  .info:hover { color: var(--accent); }
  /* The popover lives in the DOM next to labels and headings: reset what it would inherit from them. */
  .tip {
    width: min(22rem, calc(100vw - 32px)); padding: 1rem; border: 0; border-radius: var(--radius-sm);
    background: var(--raised); color: var(--text); box-shadow: 0 12px 40px rgb(0 0 0 / 0.35);
    font: 400 0.95rem/1.45 var(--font-body); text-transform: none; letter-spacing: normal; text-align: left; white-space: normal;
  }
  .tip:popover-open { display: grid; gap: 0.5rem; }
  .tip::backdrop { background: rgb(0 0 0 / 0.25); }
  .title { font-family: var(--font-display); font-size: 1.15rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
  .close { justify-self: end; background: var(--surface); }
  @media (min-width: 640px) {
    @supports (anchor-name: --a) {
      .tip { inset: auto; margin: 0.4rem 0; position-area: bottom span-right; position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline; }
      .tip::backdrop { background: none; }
    }
  }
</style>

<script lang="ts">
  import { href } from "$lib/nav";
  import { m } from "$lib/paraglide/messages.js";
  import { sportName } from "$lib/charts.ts";
  import { anySportColor, dateLabel, duration, km, num, onColorBackground } from "$lib/format.ts";

  type Activity = { id: number; date: string; name: string | null; sport: string; custom_sport?: string | null; distance_m: number | null; duration_s: number | null; tss: number | null };
  let { activity }: { activity: Activity } = $props();
  const label = $derived(activity.custom_sport ?? sportName(activity.sport));
</script>

<a class="act" href={href("/activities/[id]", { id: String(activity.id) })}>
  <!-- The initial is decoration: the sport's name follows in the meta line. -->
  <span class="badge" style:background={onColorBackground(anySportColor(activity.sport, activity.custom_sport))} aria-hidden="true">{label.charAt(0)}</span>
  <span class="main">
    <span class="name" style="display:block">{activity.name || label}</span>
    <span class="meta">{label} · {dateLabel(activity.date)}{#if activity.sport === "paddling" && !activity.custom_sport} · <em>{m.cs_unassigned()}</em>{/if}</span>
  </span>
  <span class="side">
    <span class="big">{activity.distance_m ? km(activity.distance_m) : duration(activity.duration_s)}</span>
    <span class="meta">{activity.distance_m ? duration(activity.duration_s) + " · " : ""}{m.load_tss({ value: num(activity.tss, 0) })}</span>
  </span>
</a>

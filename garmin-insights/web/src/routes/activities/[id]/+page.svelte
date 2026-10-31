<script lang="ts">
  import InfoTip from "$lib/components/InfoTip.svelte";
  import { page } from "$app/state";
  import { href } from "$lib/nav";
  import { m } from "$lib/paraglide/messages.js";
  import { api, ApiError, unwrap } from "$lib/api.ts";
  import { seriesOption, sportName, withLegAreas, zoneOption } from "$lib/charts.ts";
  import Chart from "$lib/components/Chart.svelte";
  import MapView from "$lib/components/MapView.svelte";
  import { customSports } from "$lib/custom-sports.svelte.ts";
  import { dateLabel, duration, garminTypeName, kmh, km, meters, num, onColorBackground, pace, pacePer500m, anySportColor, sportColor, timeLabel } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import type { ActivityFull, Lap, Leg, Paddling, SetRow, Zone } from "$lib/types.ts";

  const id = $derived(page.params.id ?? "");
  const detail = new Resource(() => unwrap<{ activity: ActivityFull; summary: Record<string, unknown>; legs: Leg[] }>(api.activities[":id"].$get({ param: { id } })));
  const samples = new Resource(() => unwrap<{ total: number; samples: import("$lib/types.ts").Sample[] }>(api.activities[":id"].samples.$get({ param: { id }, query: { max_points: "1500" } })));
  const laps = new Resource(() => unwrap<Lap[]>(api.activities[":id"].laps.$get({ param: { id } })));
  const strength = new Resource(() => unwrap<{ sets: SetRow[]; byExercise: { exercise: string; sets: number; reps: number; volume_kg: number; max_weight_kg: number | null; best_e1rm_kg: number | null }[]; totalVolumeKg: number }>(api.activities[":id"].strength.$get({ param: { id } })));
  const analysis = new Resource(() => unwrap<{ zones: { hr: Zone; power: Zone; pace: Zone }; decoupling_pct: number | null; best_efforts: { distance: number; seconds: number; startT: number }[]; mean_max_power: { seconds: number; watts: number }[]; paddling?: Paddling }>(api.activities[":id"].analysis.$get({ param: { id } })));

  let assignError = $state<string | null>(null);

  // The route param changes when navigating between activities: reload everything.
  $effect(() => {
    void id;
    for (const r of [detail, samples, laps, strength, analysis]) void r.reload();
  });

  const a = $derived(detail.data?.activity);
  // Multisport: the legs of a parent, shaded in the time series.
  const legs = $derived(detail.data?.legs ?? []);
  const legAreas = $derived(legs.map((l) => ({ ...l, label: sportName(l.sport) })));
  const route = $derived((samples.data?.samples ?? []).filter((s) => s.lat !== null && s.lon !== null).map((s) => [s.lon!, s.lat!] as [number, number]));
  const isRun = $derived(a?.sport === "running" || a?.sport === "walking" || a?.sport === "hiking");
  const zoneLabels = (n: number) => Array.from({ length: n }, (_, i) => m.zone_n({ n: i + 1 }));
  const methodName = (method: string) => (method === "power" ? m.tss_power() : method === "run_pace" ? m.tss_run_pace() : method === "hr_estimated" ? m.tss_hr_estimated() : m.tss_hr());
  const exerciseName = (e: string | null) => (e ? e.replaceAll("_", " ") : "–");
  const effortName = (d: number) => (d === 1609 ? m.effort_mile() : d >= 1000 ? `${num(d / 1000, d % 1000 ? 3 : 0).replace(/[.,]?0+$/, "")} km` : `${d} m`);

  // Offered: sports without base types or with this activity's Garmin type, plus the one already assigned.
  const fitting = $derived((customSports.data?.items ?? []).filter((c) => !c.type_keys.length || (a && c.type_keys.includes(a.type_key)) || c.id === a?.custom_sport_id));
  // Hint "not assigned" only when an own sport names this Garmin type (sports without base types fit anything).
  const typeMatch = $derived(!!a && fitting.some((c) => c.type_keys.includes(a.type_key)));
  async function assign(value: string) {
    assignError = null;
    try {
      await unwrap(api.activities[":id"].$patch({ param: { id }, json: { custom_sport_id: value === "" ? null : Number(value) } }));
    } catch (err) {
      assignError = err instanceof ApiError && err.code === "type_mismatch" ? m.cs_type_mismatch() : m.cs_error();
    }
    await Promise.all([detail.reload(), customSports.reload()]);
  }

  async function downloadFit() {
    const res = await api.activities[":id"].fit.$get({ param: { id } });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `activity-${id}.fit`;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<p><a href={href("/activities")}>← {m.nav_activities()}</a></p>

{#if detail.error}
  <p class="danger" role="alert">{m.error_not_found()}</p>
{:else if a}
  <!-- Head in the sport's colour, darkened so the white text stays readable in both themes. -->
  <header class="detail-head" style:background={onColorBackground(anySportColor(a.sport, a.custom_sport))}>
    <p>{a.custom_sport ?? sportName(a.sport)}{#if !a.custom_sport && typeMatch} · <em>{m.cs_unassigned()}</em>{/if} · {dateLabel(a.date, { dateStyle: "full" } as Intl.DateTimeFormatOptions)} · {timeLabel(a.start_utc)}</p>
    <h1>{a.name || a.custom_sport || sportName(a.sport)}</h1>
  </header>

  <!-- Multisport: a leg links back to its parent -->
  {#if a.parent_id !== null}
    <p><a href={href("/activities/[id]", { id: String(a.parent_id) })}>↑ {m.detail_parent_link()}</a></p>
  {/if}

  <section class="card">
    <div class="grid cols-4 stat">
      {#if a.distance_m}<div><div class="v">{km(a.distance_m, 2)}</div><div class="l">{m.metric_distance()}</div></div>{/if}
      <div><div class="v">{duration(a.duration_s)}</div><div class="l">{m.metric_duration()}</div></div>
      {#if isRun && a.avg_speed}<div><div class="v">{pace(a.avg_speed)}</div><div class="l">{m.metric_pace()}</div></div>
      {:else if a.avg_speed && a.sport === "cycling"}<div><div class="v">{kmh(a.avg_speed)}</div><div class="l">{m.metric_speed()}</div></div>{/if}
      {#if a.avg_hr}<div><div class="v">{num(a.avg_hr)}</div><div class="l">{m.metric_avg_hr()}</div></div>{/if}
      {#if a.max_hr_clean ?? a.max_hr}<div><div class="v">{num(a.max_hr_clean ?? a.max_hr)}</div><div class="l">{m.metric_max_hr()}</div></div>{/if}
      {#if a.avg_power}<div><div class="v">{num(a.avg_power)} W</div><div class="l">{m.metric_avg_power()}</div></div>{/if}
      {#if a.norm_power}<div><div class="v">{num(a.norm_power)} W</div><div class="l">{m.metric_np()}<InfoTip metric="np" /></div></div>{/if}
      {#if a.elevation_gain_m}<div><div class="v">{meters(a.elevation_gain_m)}</div><div class="l">{m.metric_ascent()}</div></div>{/if}
      {#if a.calories}<div><div class="v">{num(a.calories)}</div><div class="l">{m.metric_calories()}</div></div>{/if}
      {#if a.vo2max}<div><div class="v">{num(a.vo2max, 0)}</div><div class="l">{m.metric_vo2max()}<InfoTip metric="vo2max" /></div></div>{/if}
      {#if a.te_aerobic}<div><div class="v">{num(a.te_aerobic, 1)}</div><div class="l">{m.metric_te()}<InfoTip metric="te" /></div></div>{/if}
      <div><div class="v">{num(a.tss, 0)}</div><div class="l">{m.metric_tss()}{#if a.tss_method} <span class="small"> ({methodName(a.tss_method)})</span>{/if}<InfoTip metric="tss" /></div></div>
      <div><div class="v">{num(a.trimp, 0)}</div><div class="l">{m.metric_trimp()}<InfoTip metric="trimp" /></div></div>
      {#if analysis.data?.decoupling_pct !== null && analysis.data?.decoupling_pct !== undefined}
        <div><div class="v">{num(analysis.data.decoupling_pct, 1)} %</div><div class="l">{m.metric_decoupling()}<InfoTip metric="decoupling" /></div></div>
      {/if}
    </div>
  </section>

  <!-- Only when there is a choice: an own sport fits this Garmin type, or one is assigned. -->
  {#if fitting.length}
    <div class="field">
      <label for="custom-sport">{m.cs_field()}</label>
      <select id="custom-sport" value={a.custom_sport_id === null ? "" : String(a.custom_sport_id)} onchange={(e) => assign(e.currentTarget.value)}>
        <option value="">{m.cs_garmin_option({ type: garminTypeName(a.type_key) })}</option>
        {#each fitting as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
      </select>
      {#if assignError}<p class="danger small" role="alert">{assignError}</p>{/if}
    </div>
  {/if}


  <!-- Multisport: the legs of a parent -->
  {#if legs.length}
    <section class="card">
      <h2>{m.detail_legs()}</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>#</th><th>{m.detail_leg_sport()}</th><th class="r">{m.detail_leg_start()}</th><th class="r">{m.metric_duration()}</th><th class="r">{m.metric_avg_hr()}</th><th class="r">{m.metric_tss()}</th></tr></thead>
        <tbody>{#each legs as l, i (l.id)}
          <tr>
            <td>{i + 1}</td>
            <td><span class="dot" style:background={sportColor(l.sport)} style="display:inline-block;width:.5rem;height:.9rem;border-radius:3px;margin-right:.4rem"></span><a href={href("/activities/[id]", { id: String(l.id) })} style="display:inline-block;min-height:var(--tap);line-height:var(--tap)">{sportName(l.sport)}</a> <span class="muted small">{l.garmin_type.replaceAll("_", " ")}</span></td>
            <td class="r">{duration(l.start_offset_s)}</td><td class="r">{duration(l.duration_s)}</td><td class="r">{num(l.avg_hr)}</td><td class="r">{num(l.tss, 0)}</td>
          </tr>
        {/each}</tbody>
      </table></div>
      <p class="muted small">{m.detail_legs_hint()}</p>
    </section>
  {/if}

  {#if a.fit_status === "pending"}
    <p class="banner" role="status">{m.detail_fit_pending()}</p>
  {:else if a.fit_status === "none" || a.fit_status === "failed"}
    <p class="muted small">{m.detail_fit_missing()}</p>
  {/if}
  {#if a.hr_artifact_s}
    <p class="muted small">{m.detail_hr_cleaned({ clean: num(a.max_hr_clean ?? a.max_hr), raw: num(a.max_hr), seconds: num(a.hr_artifact_s) })}</p>
  {/if}

  {#if route.length > 1}
    <section class="card"><h2>{m.detail_map()}</h2><MapView points={route} label={m.detail_map()} /></section>
  {/if}

  {#if samples.data?.samples.length}
    <section class="card"><h2>{m.detail_timeseries()}</h2><Chart option={withLegAreas(seriesOption(samples.data.samples, a.sport), samples.data.samples, legAreas)} height={300} label={m.detail_timeseries()} /></section>
  {/if}

  {#if analysis.data}
    {#each [["hr", m.zones_hr()], ["power", m.zones_power()], ["pace", m.zones_pace()]] as const as [kind, title] (kind)}
      {@const z = analysis.data.zones[kind]}
      {#if z}
        <section class="card">
          <h2>{title}</h2>
          <Chart option={zoneOption(z.seconds, zoneLabels(z.seconds.length))} height={z.seconds.length * 34 + 24} label={title} />
          {#if z.source === "garmin_summary"}<p class="muted small">{m.zones_from_garmin()}</p>{/if}
        </section>
      {/if}
    {/each}

    {#if analysis.data.paddling}
      {@const p = analysis.data.paddling}
      <section class="card">
        <h2>{m.paddling_title()}</h2>
        <div class="grid cols-4 stat">
          <div><div class="v">{kmh(p.avg_speed_kmh / 3.6)}</div><div class="l">{m.paddling_speed()}</div></div>
          <div><div class="v">{pacePer500m(p.pace_s_per_500m)}</div><div class="l">{m.paddling_pace500()}</div></div>
          {#if p.max_speed_1min_kmh !== null}<div><div class="v">{kmh(p.max_speed_1min_kmh / 3.6)}</div><div class="l">{m.paddling_best_1min()}</div></div>{/if}
          {#if p.max_speed_5min_kmh !== null}<div><div class="v">{kmh(p.max_speed_5min_kmh / 3.6)}</div><div class="l">{m.paddling_best_5min()}</div></div>{/if}
          {#if p.avg_stroke_rate !== null}<div><div class="v">{num(p.avg_stroke_rate, 0)} {m.paddling_unit_spm()}</div><div class="l">{m.paddling_stroke_rate()}</div></div>{/if}
          {#if p.distance_per_stroke_m !== null}<div><div class="v">{num(p.distance_per_stroke_m, 1)} {m.paddling_unit_m()}</div><div class="l">{m.paddling_per_stroke()}</div></div>{/if}
          {#if p.efficiency !== null}<div><div class="v">{num(p.efficiency, 3)}</div><div class="l">{m.paddling_efficiency()}</div></div>{/if}
        </div>
        {#if p.efficiency !== null}<p class="muted small">{m.paddling_efficiency_hint()}</p>{/if}
      </section>
    {/if}

    {#if analysis.data.best_efforts.length}
      <section class="card">
        <h2>{m.detail_best_efforts()}</h2>
        <table><thead><tr><th>{m.metric_distance()}</th><th class="r">{m.metric_time()}</th><th class="r">{m.metric_pace()}</th></tr></thead>
          <tbody>{#each analysis.data.best_efforts as e (e.distance)}
            <tr><td>{effortName(e.distance)}</td><td class="r">{duration(e.seconds)}</td><td class="r">{pace(e.distance / e.seconds)}</td></tr>
          {/each}</tbody></table>
      </section>
    {/if}
    {#if analysis.data.mean_max_power.length}
      <section class="card">
        <h2>{m.detail_mean_max()}</h2>
        <div class="table-scroll"><table><thead><tr><th>{m.metric_duration()}</th><th class="r">{m.metric_avg_power()}</th></tr></thead>
          <tbody>{#each analysis.data.mean_max_power as p (p.seconds)}<tr><td>{duration(p.seconds)}</td><td class="r">{num(p.watts)} W</td></tr>{/each}</tbody></table></div>
      </section>
    {/if}
  {/if}

  {#if laps.data && laps.data.length > 1}
    <section class="card">
      <h2>{m.detail_laps()}</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>#</th><th class="r">{m.metric_distance()}</th><th class="r">{m.metric_time()}</th>{#if isRun}<th class="r">{m.metric_pace()}</th>{/if}<th class="r">{m.metric_avg_hr()}</th>{#if laps.data.some((l) => l.avg_power)}<th class="r">{m.metric_avg_power()}</th>{/if}</tr></thead>
        <tbody>{#each laps.data as l (l.idx)}
          <tr><td>{l.idx + 1}</td><td class="r">{km(l.distance_m, 2)}</td><td class="r">{duration(l.duration_s)}</td>{#if isRun}<td class="r">{pace(l.avg_speed)}</td>{/if}<td class="r">{num(l.avg_hr)}</td>{#if laps.data.some((x) => x.avg_power)}<td class="r">{num(l.avg_power)}</td>{/if}</tr>
        {/each}</tbody>
      </table></div>
    </section>
  {/if}

  {#if strength.data && strength.data.sets.length}
    <section class="card">
      <h2>{m.detail_strength()}</h2>
      <p class="muted">{m.strength_total({ volume: num(strength.data.totalVolumeKg) })}</p>
      <div class="table-scroll"><table>
        <thead><tr><th>{m.strength_exercise()}</th><th class="r">{m.strength_sets()}</th><th class="r">{m.strength_reps()}</th><th class="r">{m.strength_volume()}</th><th class="r">{m.strength_e1rm()}<InfoTip metric="e1rm" /></th></tr></thead>
        <tbody>{#each strength.data.byExercise as e (e.exercise)}
          <tr><td>{exerciseName(e.exercise)}</td><td class="r">{e.sets}</td><td class="r">{e.reps}</td><td class="r">{num(e.volume_kg)} kg</td><td class="r">{e.best_e1rm_kg ? `${num(e.best_e1rm_kg, 1)} kg` : "–"}</td></tr>
        {/each}</tbody>
      </table></div>
      <h3 style="margin-top:1rem">{m.strength_all_sets()}</h3>
      <div class="table-scroll"><table>
        <thead><tr><th>#</th><th>{m.strength_exercise()}</th><th class="r">{m.strength_reps()}</th><th class="r">{m.strength_weight()}</th><th class="r">{m.metric_time()}</th></tr></thead>
        <tbody>{#each strength.data.sets as s (s.idx)}
          <tr class:muted={s.set_type === "rest"}><td>{s.idx + 1}</td><td>{s.set_type === "rest" ? m.strength_rest() : exerciseName(s.exercise)}</td><td class="r">{s.reps ?? "–"}</td><td class="r">{s.weight_kg ? `${num(s.weight_kg, 1)} kg` : "–"}</td><td class="r">{duration(s.duration_s)}</td></tr>
        {/each}</tbody>
      </table></div>
    </section>
  {/if}

  <!-- A leg filled from its parent's file has none of its own; the parent offers the whole file. -->
  {#if a.fit_status === "done" && a.parent_id === null}
    <p><button type="button" onclick={downloadFit}>{m.detail_download_fit()}</button></p>
  {/if}
{:else}
  <p class="muted">{m.loading()}</p>
{/if}

<style>
  .detail-head { border-radius: var(--radius); padding: 1.1rem 1rem; margin-bottom: 0.9rem; color: #fff; }
  .detail-head p { margin: 0 0 0.2rem; opacity: 0.88; font-size: 0.9rem; }
  .detail-head h1 { margin: 0; }
</style>

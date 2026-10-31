<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale, setLocale } from "$lib/paraglide/runtime.js";
  import { api, ApiError, unwrap } from "$lib/api.ts";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import CustomSportDialog from "$lib/components/CustomSportDialog.svelte";
  import McpSetup from "$lib/components/McpSetup.svelte";
  import { customSportColor, customSports } from "$lib/custom-sports.svelte.ts";
  import { dateLabel, duration, garminTypeName, num, parseDuration } from "$lib/format.ts";
  import { Resource } from "$lib/resource.svelte.ts";
  import { session } from "$lib/session.svelte.ts";
  import { sync } from "$lib/sync.svelte.ts";
  import type { CustomSportItem } from "$lib/types.ts";

  type Athlete = { valid_from: string; hr_max: number | null; hr_rest: number | null; lthr: number | null; ftp: number | null; threshold_pace_s_per_km: number | null; sex: "m" | "f" | null; zones: Record<string, number[]> | null; source: "garmin" | "manual" };
  type Settings = { language: "de" | "en" | null; athlete: { current: Athlete | null; history: Athlete[]; effectiveZones: Record<"hr" | "pace" | "power", number[] | null> } };
  const settings = new Resource(() => unwrap<Settings>(api.settings.$get()));
  $effect(() => void settings.reload());

  // --- Garmin key ---
  let apiKey = $state("");
  let expiresOn = $state("");
  let keyMessage = $state<{ kind: "ok" | "error"; text: string } | null>(null);
  let savingKey = $state(false);
  async function saveKey(e: SubmitEvent) {
    e.preventDefault();
    savingKey = true;
    keyMessage = null;
    try {
      await unwrap(api.garmin.key.$put({ json: { key: apiKey, expires_on: expiresOn || null } }));
      apiKey = "";
      keyMessage = { kind: "ok", text: m.key_saved() };
      await sync.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      keyMessage = { kind: "error", text: code === "key_rejected" ? m.key_rejected() : code === "garmin_unavailable" ? m.key_garmin_unavailable() : m.key_invalid_input() };
    } finally {
      savingKey = false;
    }
  }
  let removeKeyOpen = $state(false);
  async function removeKey() {
    await api.garmin.key.$delete();
    await sync.refresh();
  }

  // --- Athlete thresholds ---
  let form = $state({ valid_from: "", hr_max: "", hr_rest: "", lthr: "", ftp: "", pace: "", sex: "" });
  let athleteMessage = $state<string | null>(null);
  $effect(() => {
    const c = settings.data?.athlete.current;
    form = { valid_from: "", hr_max: c?.hr_max?.toString() ?? "", hr_rest: c?.hr_rest?.toString() ?? "", lthr: c?.lthr?.toString() ?? "", ftp: c?.ftp?.toString() ?? "", pace: c?.threshold_pace_s_per_km ? duration(c.threshold_pace_s_per_km) : "", sex: c?.sex ?? "" };
  });
  const int = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10));
  async function saveAthlete(e: SubmitEvent) {
    e.preventDefault();
    athleteMessage = null;
    const pace = form.pace.trim() ? parseDuration(form.pace) : null;
    if (form.pace.trim() && pace === null) return void (athleteMessage = m.athlete_pace_invalid());
    try {
      await unwrap(api.settings.athlete.$put({ json: {
        ...(form.valid_from ? { valid_from: form.valid_from } : {}),
        hr_max: int(form.hr_max), hr_rest: int(form.hr_rest), lthr: int(form.lthr), ftp: int(form.ftp),
        threshold_pace_s_per_km: pace, sex: (form.sex || null) as "m" | "f" | null,
      } }));
      athleteMessage = m.athlete_saved();
      await settings.reload();
    } catch {
      athleteMessage = m.athlete_invalid();
    }
  }

  // --- Custom sports ---
  let editing = $state<CustomSportItem | null>(null);
  let sportDialogOpen = $state(false);
  const editSport = (sport: CustomSportItem | null) => ((editing = sport), (sportDialogOpen = true));
  const typesLabel = (keys: string[]) => (keys.length ? keys.map(garminTypeName).join(", ") : m.cs_types_any());

  // --- Language ---
  async function changeLanguage(value: string) {
    const language = value === "" ? null : (value as "de" | "en");
    await unwrap(api.settings.language.$put({ json: { language } }));
    // Paraglide keeps the choice in localStorage and reloads the page into the new language.
    if (language) setLocale(language);
    else {
      try {
        localStorage.removeItem("PARAGLIDE_LOCALE");
      } catch {
        // storage blocked: the browser language applies on the next load anyway
      }
      location.reload();
    }
  }

  // --- Delete all data ---
  let deleteOpen = $state(false);
  let deleted = $state(false);
  async function deleteAll() {
    await api.data.$delete({ json: { confirm: "delete-all-data" } });
    deleted = true;
    await sync.refresh();
  }

  const key = $derived(sync.progress?.key);
  const kindName = (k: string) => ({ activities: m.kind_activities(), fit: m.kind_fit(), dailies: m.kind_dailies(), sleep: m.kind_sleep(), hrv: m.kind_hrv(), zones: m.kind_zones() })[k] ?? k;
  const statusText = $derived(!key?.configured ? m.key_status_none() : key.status === "ok" ? m.key_status_ok() : key.status === "expired" ? m.key_status_expired() : m.key_status_invalid());
</script>

<h1>{m.nav_settings()}</h1>

<section class="card stack">
  <h2>{m.settings_key()}</h2>
  <p>{m.key_status_label()}: <strong class:good={key?.status === "ok"} class:danger={key?.configured && key.status !== "ok"}>{statusText}</strong>
    {#if key?.expiresOn}<span class="muted"> · {m.key_expires({ date: dateLabel(key.expiresOn) })}</span>{/if}</p>
  <p class="muted small">{m.key_help()}</p>
  <p class="small"><a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noopener noreferrer">{m.key_link()}</a></p>
  <form class="stack" onsubmit={saveKey}>
    <div class="field"><label for="key">{m.key_input()}</label><input id="key" type="password" autocomplete="off" spellcheck="false" bind:value={apiKey} required /></div>
    <div class="field"><label for="exp">{m.key_expires_input()}</label><input id="exp" type="date" bind:value={expiresOn} /></div>
    <div class="row"><button class="primary" type="submit" disabled={savingKey || !apiKey}>{savingKey ? m.key_checking() : m.key_save()}</button>
      {#if key?.configured}<button type="button" class="danger-btn" onclick={() => (removeKeyOpen = true)}>{m.key_remove()}</button>{/if}</div>
    {#if keyMessage}<p class:good={keyMessage.kind === "ok"} class:danger={keyMessage.kind === "error"} role="status">{keyMessage.text}</p>{/if}
  </form>
</section>

<section class="card stack">
  <div class="row between"><h2>{m.settings_sync()}</h2>
    <button type="button" disabled={sync.progress?.running || key?.status !== "ok"} onclick={() => sync.trigger()}>{sync.progress?.running ? m.sync_running() : m.sync_now()}</button></div>
  <div class="table-scroll"><table>
    <thead><tr><th>{m.sync_kind()}</th><th>{m.sync_reached()}</th><th class="r">{m.sync_items()}</th><th>{m.sync_state()}</th></tr></thead>
    <tbody>
      {#each (sync.progress?.kinds ?? []).filter((k) => k.kind !== "fit") as k (k.kind)}
        <tr><td>{kindName(k.kind)}</td><td>{k.cursor ? dateLabel(k.cursor, { month: "short", year: "numeric" }) : "–"}</td><td class="r">{num(k.items)}</td>
          <td class:danger={!!k.lastError}>{k.lastError ? m.sync_error() : k.backfillDone ? m.sync_complete() : m.sync_backfilling()}</td></tr>
      {/each}
      <tr><td>{kindName("fit")}</td><td>–</td><td class="r">{num(sync.progress?.fit.done)}</td><td>{sync.progress?.fit.pending ? m.sync_fit_pending({ n: sync.progress.fit.pending }) : m.sync_complete()}</td></tr>
    </tbody>
  </table></div>
  <p class="muted small">{m.sync_hint()}</p>
</section>

<section class="card stack">
  <h2>{m.settings_athlete()}</h2>
  <p class="muted small">{m.athlete_help()}</p>
  <form class="stack" onsubmit={saveAthlete}>
    <div class="grid cols-2">
      <div class="field"><label for="hrmax">{m.athlete_hr_max()}</label><input id="hrmax" type="number" inputmode="numeric" bind:value={form.hr_max} /></div>
      <div class="field"><label for="hrrest">{m.athlete_hr_rest()}</label><input id="hrrest" type="number" inputmode="numeric" bind:value={form.hr_rest} /></div>
      <div class="field"><label for="lthr">{m.athlete_lthr()}</label><input id="lthr" type="number" inputmode="numeric" bind:value={form.lthr} /></div>
      <div class="field"><label for="ftp">{m.athlete_ftp()}</label><input id="ftp" type="number" inputmode="numeric" bind:value={form.ftp} /></div>
      <div class="field"><label for="pace">{m.athlete_pace()}</label><input id="pace" type="text" inputmode="numeric" placeholder="5:00" bind:value={form.pace} /></div>
      <div class="field"><label for="sex">{m.athlete_sex()}</label>
        <select id="sex" bind:value={form.sex}><option value="">{m.athlete_sex_unset()}</option><option value="m">{m.athlete_sex_m()}</option><option value="f">{m.athlete_sex_f()}</option></select></div>
    </div>
    <div class="field"><label for="validfrom">{m.athlete_valid_from()}</label><input id="validfrom" type="date" bind:value={form.valid_from} /></div>
    <div class="row"><button class="primary" type="submit">{m.athlete_save()}</button></div>
    {#if athleteMessage}<p role="status">{athleteMessage}</p>{/if}
  </form>
  {#if settings.data?.athlete.history.length}
    <h3>{m.athlete_history()}</h3>
    <div class="table-scroll"><table>
      <thead><tr><th>{m.athlete_valid_from()}</th><th class="r">{m.athlete_hr_max()}</th><th class="r">{m.athlete_lthr()}</th><th class="r">{m.athlete_ftp()}</th><th>{m.athlete_source()}</th></tr></thead>
      <tbody>{#each [...settings.data.athlete.history].reverse() as h (h.valid_from)}
        <tr><td>{dateLabel(h.valid_from)}</td><td class="r">{h.hr_max ?? "–"}</td><td class="r">{h.lthr ?? "–"}</td><td class="r">{h.ftp ?? "–"}</td><td>{h.source === "garmin" ? m.source_garmin() : m.source_manual()}</td></tr>
      {/each}</tbody>
    </table></div>
  {/if}
</section>

<section class="card stack">
  <h2>{m.cs_title()}</h2>
  <p class="muted small">{m.cs_help()}</p>
  {#if customSports.data?.items.length}
    <ul class="cs-list">
      {#each customSports.data.items as sport (sport.id)}
        <li><button type="button" class="cs-row" onclick={() => editSport(sport)}>
          <span class="dot" style:background={customSportColor(sport.name)}></span>
          <span class="main"><span class="name">{sport.name}</span><span class="meta">{typesLabel(sport.type_keys)}</span></span>
          <span class="muted small">{m.cs_count({ n: sport.activity_count })}</span>
        </button></li>
      {/each}
    </ul>
  {:else if !customSports.loading}<p class="muted">{m.cs_empty()}</p>{/if}
  <div class="row"><button type="button" class="primary" onclick={() => editSport(null)}>+ {m.cs_new()}</button></div>
</section>

<McpSetup />

<section class="card stack">
  <h2>{m.settings_language()}</h2>
  <div class="field"><label for="lang">{m.settings_language()}</label>
    <select id="lang" value={settings.data?.language ?? ""} onchange={(e) => changeLanguage(e.currentTarget.value)}>
      <option value="">{m.language_auto({ current: getLocale() })}</option><option value="de">Deutsch</option><option value="en">English</option>
    </select></div>
</section>

<section class="card stack">
  <h2>{m.settings_data()}</h2>
  <p class="muted">{m.data_help()}</p>
  <div class="row">
    <button type="button" class="danger-btn" onclick={() => (deleteOpen = true)}>{m.data_delete()}</button>
    {#if session.external}<button type="button" onclick={() => session.logout()}>{m.logout()}</button>{/if}
  </div>
  {#if deleted}<p class="good" role="status">{m.data_deleted()}</p>{/if}
  <p class="muted small">{m.about_text()}</p>
</section>

<ConfirmDialog bind:open={removeKeyOpen} title={m.key_remove_title()} body={m.key_remove_body()} confirmLabel={m.key_remove()} onconfirm={removeKey} />
<ConfirmDialog bind:open={deleteOpen} title={m.data_delete_title()} body={m.data_delete_body()} confirmLabel={m.data_delete_confirm()} onconfirm={deleteAll} />
<CustomSportDialog bind:open={sportDialogOpen} sport={editing} />

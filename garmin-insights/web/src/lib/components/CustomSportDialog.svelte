<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { api, ApiError, unwrap } from "$lib/api.ts";
  import { sportName } from "$lib/charts.ts";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import { customSports } from "$lib/custom-sports.svelte.ts";
  import { garminTypeName, KNOWN_SPORTS } from "$lib/format.ts";
  import type { CustomSportItem } from "$lib/types.ts";

  // Creates (sport = null) or edits one own sport: name and base types in one save, delete behind a second step.
  // A bottom sheet on phones, a centred dialog from 640 px (app.css, `dialog.sheet`).
  let { open = $bindable(false), sport }: { open: boolean; sport: CustomSportItem | null } = $props();
  let dialog: HTMLDialogElement;
  let name = $state("");
  let types = $state<string[]>([]);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let deleteOpen = $state(false);

  $effect(() => {
    if (open && !dialog.open) {
      name = sport?.name ?? "";
      types = [...(sport?.type_keys ?? [])];
      message = null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  // Choices: the types of the user's activities plus those the sport already has (their activities may be gone),
  // grouped by the Garmin-derived sport so a long list stays scannable.
  const groups = $derived.by(() => {
    const known = customSports.data?.garmin_types ?? [];
    const all = [...known, ...(sport?.type_keys ?? []).filter((k) => !known.some((t) => t.type_key === k)).map((type_key) => ({ type_key, sport: "other" }))];
    return KNOWN_SPORTS.map((s) => ({ sport: s, keys: all.filter((t) => (KNOWN_SPORTS.includes(t.sport) ? t.sport : "other") === s).map((t) => t.type_key).sort((a, b) => garminTypeName(a).localeCompare(garminTypeName(b))) }))
      .filter((g) => g.keys.length);
  });

  const toggle = (key: string) => (types = types.includes(key) ? types.filter((k) => k !== key) : [...types, key]);

  async function write(run: () => Promise<unknown>) {
    busy = true;
    message = null;
    try {
      await run();
      await customSports.reload();
      open = false;
    } catch (err) {
      message = err instanceof ApiError && err.code === "name_taken" ? m.cs_name_taken() : m.cs_error();
    } finally {
      busy = false;
    }
  }
  function save(e: SubmitEvent) {
    e.preventDefault();
    const json = { name, type_keys: types };
    void write(() => unwrap(sport ? api["custom-sports"][":id"].$patch({ param: { id: String(sport.id) }, json }) : api["custom-sports"].$post({ json })));
  }
  // 204 has no body, so no unwrap().
  const remove = async () => {
    if (!sport) return;
    await write(async () => {
      const res = await api["custom-sports"][":id"].$delete({ param: { id: String(sport.id) } });
      if (!res.ok) throw new ApiError(res.status, "error");
    });
  };
</script>

<dialog class="sheet" bind:this={dialog} onclose={() => (open = false)} aria-labelledby="cs-dialog-title">
  <form class="sheet-form" onsubmit={save}>
    <header class="row between sheet-head">
      <h2 id="cs-dialog-title">{sport ? m.cs_edit_title() : m.cs_new()}</h2>
      <button type="button" aria-label={m.close()} onclick={() => (open = false)}>✕</button>
    </header>
    <div class="sheet-body stack">
      <div class="field"><label for="cs-name">{m.cs_name()}</label><input id="cs-name" type="text" maxlength="100" required bind:value={name} /></div>
      <fieldset class="check-list">
        <legend>{m.cs_types()}</legend>
        <p class="muted small">{m.cs_types_help()}</p>
        {#each groups as g (g.sport)}
          <h3>{sportName(g.sport)}</h3>
          {#each g.keys as key (key)}
            <label class="check-row"><input type="checkbox" checked={types.includes(key)} onchange={() => toggle(key)} />{garminTypeName(key)}</label>
          {/each}
        {/each}
      </fieldset>
      {#if message}<p class="danger" role="alert">{message}</p>{/if}
    </div>
    <footer class="row between sheet-foot">
      {#if sport}<button type="button" class="danger-btn" disabled={busy} onclick={() => (deleteOpen = true)}>{m.cs_delete()}</button>{:else}<span></span>{/if}
      <button class="primary" type="submit" disabled={busy || !name.trim()}>{sport ? m.cs_save() : m.cs_add()}</button>
    </footer>
  </form>
</dialog>

<ConfirmDialog bind:open={deleteOpen} title={m.cs_delete_title()} body={m.cs_delete_body({ name: sport?.name ?? "" })} confirmLabel={m.cs_delete()} onconfirm={remove} />

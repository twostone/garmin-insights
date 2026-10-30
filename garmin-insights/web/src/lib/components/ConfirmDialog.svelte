<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  // Native <dialog>, no confirm(): the Companion app handles window.confirm unreliably. Two steps for destructive actions.
  let { open = $bindable(false), title, body, confirmLabel, onconfirm }: { open: boolean; title: string; body: string; confirmLabel: string; onconfirm: () => void | Promise<void> } = $props();
  let dialog: HTMLDialogElement;
  let busy = $state(false);

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  async function confirm() {
    busy = true;
    try {
      await onconfirm();
    } finally {
      busy = false;
      open = false;
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
  <h2>{title}</h2>
  <p>{body}</p>
  <div class="row between">
    <button type="button" onclick={() => (open = false)}>{m.cancel()}</button>
    <button type="button" class="danger-btn" disabled={busy} onclick={confirm}>{confirmLabel}</button>
  </div>
</dialog>

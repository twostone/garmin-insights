// A tiny async data holder for components: runs `load` on `reload()` (components call it from an $effect, which also covers
// the first load), exposes loading/error/data as state. Late answers of an outdated call are dropped (filters changing quickly).
export class Resource<T> {
  data: T | null = $state(null);
  error: Error | null = $state(null);
  loading = $state(true);
  private run = 0;
  constructor(private load: () => Promise<T>) {}
  async reload(load = this.load): Promise<void> {
    this.load = load;
    const run = ++this.run;
    this.loading = true;
    try {
      const data = await load();
      if (run === this.run) (this.data = data, (this.error = null));
    } catch (e) {
      if (run === this.run) this.error = e instanceof Error ? e : new Error(String(e));
    } finally {
      if (run === this.run) this.loading = false;
    }
  }
}

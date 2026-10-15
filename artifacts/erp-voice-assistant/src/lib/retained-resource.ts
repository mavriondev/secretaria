/** One local, non-audio resource per mounted voice screen. Pending loads are
 * shared, inference is drained before reset/disposal, and stale loads self-close. */
export class RetainedResource<T> {
  private value: T | null = null;
  private pending: Promise<T> | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private barrier: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly load: (signal: AbortSignal) => Promise<T>,
    private readonly reset: (value: T) => void,
    private readonly close: (value: T) => Promise<void>,
    private readonly idleMs = 300_000,
  ) {}
  warm(): Promise<T> {
    if (this.value) return Promise.resolve(this.value);
    if (this.pending) return this.pending;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const pending = this.load(controller.signal).then(async value => {
      if (generation !== this.generation || controller.signal.aborted) {
        await this.close(value);
        throw new DOMException('Preparação encerrada', 'AbortError');
      }
      this.value = value;
      return value;
    }).finally(() => {
      if (this.pending === pending) { this.pending = null; this.controller = null; }
    });
    this.pending = pending;
    return pending;
  }
  async acquire(signal?: AbortSignal): Promise<T> {
    clearTimeout(this.timer);
    const generation = this.generation;
    await this.barrier;
    signal?.throwIfAborted();
    if (generation !== this.generation) throw new DOMException('Sessão encerrada', 'AbortError');
    const value = await this.warm();
    signal?.throwIfAborted();
    if (generation !== this.generation) throw new DOMException('Sessão encerrada', 'AbortError');
    this.reset(value);
    return value;
  }
  park(after: Promise<unknown> = Promise.resolve()): void {
    const value = this.value;
    const generation = this.generation;
    this.barrier = Promise.allSettled([this.barrier, after]).then(() => {
      // Retain compiled weights, never the last conversation's PCM/recurrent state.
      if (value && this.value === value && generation === this.generation) this.reset(value);
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.dispose().catch(() => {}); }, this.idleMs);
  }
  async dispose(after: Promise<unknown> = Promise.resolve()): Promise<void> {
    ++this.generation;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = null; this.pending = null;
    const value = this.value; this.value = null;
    const barrier = Promise.allSettled([this.barrier, after]);
    this.barrier = barrier;
    await barrier;
    if (value) await this.close(value);
  }
}

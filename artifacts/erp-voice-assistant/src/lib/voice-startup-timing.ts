const phases = [
  'audio_resume', 'availability', 'config', 'permission', 'worklet',
  'classifier_import', 'model_fetch', 'runtime_model_init', 'classifier',
  'ws_open', 'start_ready', 'total', 'upstream', 'wasm_download',
] as const;
export type StartupPhase = typeof phases[number];
let sequence = 0;

/** Durations only. No audio, transcript, URL, identity or provider payload. */
export class VoiceStartupTiming {
  readonly values: Partial<Record<StartupPhase, number>> = {};
  private readonly prefix = `voice-startup-${++sequence}`;
  private readonly started = performance.now();
  constructor() { performance.mark(`${this.prefix}:total:start`); }
  record(phase: StartupPhase, ms: number) {
    if (Number.isFinite(ms) && ms >= 0) {
      this.values[phase] = Math.min(120_000, Math.round(ms * 10) / 10);
      try { performance.measure(`voice:${phase}`, { start: Math.max(0, performance.now() - ms), duration: ms }); }
      catch { /* Optional diagnostics must never prevent a conversation. */ }
    }
  }
  async measure<T>(phase: StartupPhase, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const key = `${this.prefix}:${phase}`;
    performance.mark(`${key}:start`);
    try { return await operation(); }
    finally {
      performance.mark(`${key}:end`);
      this.record(phase, performance.now() - start);
      performance.clearMarks(`${key}:start`); performance.clearMarks(`${key}:end`);
    }
  }
  finish() {
    performance.clearMarks(`${this.prefix}:total:start`);
    this.record('total', performance.now() - this.started);
    const wasm = performance.getEntriesByType('resource').find(entry => entry.startTime >= this.started && /\.wasm(?:$|\?)/.test(entry.name));
    if (wasm) this.record('wasm_download', wasm.duration);
    // Keep a bounded diagnostic history for this tab, not an ever-growing timeline.
    for (const phase of phases) {
      const entries = performance.getEntriesByName(`voice:${phase}`, 'measure');
      if (entries.length > 20) performance.clearMeasures(`voice:${phase}`);
    }
    return { ...this.values };
  }
}

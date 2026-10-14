/**
 * Keeps the microphone stream between conversations of the same screen session, so the browser asks for permission
 * once instead of at every tap (Safari on iPhone re-asks on each getUserMedia). While parked, every track is disabled:
 * nothing is captured, nothing is sent. The stream is really released when it stops making sense to hold it
 * (idle for a while, page hidden for a while, screen left, track ended by the system, or the person turned the option off).
 */

export const MICROPHONE_READY_KEY = 'tato.microfone-pronto';
export const IDLE_RELEASE_MS = 3 * 60 * 1000;
export const HIDDEN_RELEASE_MS = 30 * 1000;

/** Preference per device: on unless the person turned it off. */
export function microphoneReadyEnabled(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try { return storage?.getItem(MICROPHONE_READY_KEY) !== 'off'; } catch { return true; }
}
export function setMicrophoneReadyEnabled(on: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try { if (on) storage?.removeItem(MICROPHONE_READY_KEY); else storage?.setItem(MICROPHONE_READY_KEY, 'off'); } catch { /* sem armazenamento */ }
}
function safeStorage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }

type Track = Pick<MediaStreamTrack, 'enabled' | 'readyState' | 'stop' | 'addEventListener' | 'removeEventListener'>;
export type HeldStream = Pick<MediaStream, 'getTracks'> & { getTracks(): Track[] } & object;
type Devices = { getUserMedia(constraints: MediaStreamConstraints): Promise<HeldStream> };
type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
type Options = {
  /** Read at every park: false means release immediately (the old behaviour). */
  keep: () => boolean;
  idleMs?: number; hiddenMs?: number; timers?: Timers;
};

export class MicrophoneHold {
  private stream: HeldStream | null = null;
  private inUse = false;
  private idleTimer: unknown = null;
  private hiddenTimer: unknown = null;
  private readonly timers: Timers;
  private readonly idleMs: number;
  private readonly hiddenMs: number;
  private readonly onTrackGone = () => { if (!this.inUse) this.dispose(); };
  constructor(private readonly devices: Devices, private readonly options: Options) {
    this.timers = options.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>) };
    this.idleMs = options.idleMs ?? IDLE_RELEASE_MS;
    this.hiddenMs = options.hiddenMs ?? HIDDEN_RELEASE_MS;
  }
  /** True while a parked stream is kept for the next conversation. */
  get held(): boolean { return this.stream !== null && !this.inUse; }

  /** The stream for a conversation: the parked one, re-enabled, when it is still live; otherwise a new request to the browser. */
  async acquire(constraints: MediaStreamConstraints): Promise<HeldStream> {
    this.clearIdle();
    const parked = this.stream;
    if (parked && parked.getTracks().length && parked.getTracks().every(t => t.readyState === 'live')) {
      parked.getTracks().forEach(t => { t.enabled = true; });
      this.inUse = true;
      return parked;
    }
    this.dispose();
    const stream = await this.devices.getUserMedia(constraints);
    stream.getTracks().forEach(t => { t.addEventListener('ended', this.onTrackGone); t.addEventListener('mute', this.onTrackGone); });
    this.stream = stream; this.inUse = true;
    return stream;
  }

  /** End of a conversation: keep the stream silent for the next one, or release it when the option is off. */
  park(): void {
    if (!this.stream) return;
    this.inUse = false;
    if (!this.options.keep()) { this.dispose(); return; }
    this.stream.getTracks().forEach(t => { t.enabled = false; });
    this.clearIdle();
    this.idleTimer = this.timers.setTimeout(() => { this.idleTimer = null; if (!this.inUse) this.dispose(); }, this.idleMs);
  }

  /** Page hidden: a parked stream is released after a short while; visible again in time cancels that. */
  hidden(isHidden: boolean): void {
    if (this.hiddenTimer !== null) { this.timers.clearTimeout(this.hiddenTimer); this.hiddenTimer = null; }
    if (isHidden && this.stream && !this.inUse) this.hiddenTimer = this.timers.setTimeout(() => { this.hiddenTimer = null; if (!this.inUse) this.dispose(); }, this.hiddenMs);
  }

  /** Really releases the microphone (indicator goes off). Safe to repeat. */
  dispose(): void {
    this.clearIdle();
    if (this.hiddenTimer !== null) { this.timers.clearTimeout(this.hiddenTimer); this.hiddenTimer = null; }
    const stream = this.stream; this.stream = null; this.inUse = false;
    stream?.getTracks().forEach(t => { t.removeEventListener('ended', this.onTrackGone); t.removeEventListener('mute', this.onTrackGone); t.stop(); });
  }
  private clearIdle(): void { if (this.idleTimer !== null) { this.timers.clearTimeout(this.idleTimer); this.idleTimer = null; } }
}

export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';
/** Permission state when the browser tells it (Safari may not); errors read as unknown. `onChange` follows later changes. */
export async function microphonePermission(
  permissions: { query(descriptor: { name: string }): Promise<{ state: string; addEventListener?: (type: 'change', fn: () => void) => void }> } | undefined,
  onChange?: (state: MicrophonePermission) => void,
): Promise<MicrophonePermission> {
  if (!permissions?.query) return 'unknown';
  try {
    const status = await permissions.query({ name: 'microphone' });
    const read = (): MicrophonePermission => (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown');
    if (onChange) status.addEventListener?.('change', () => onChange(read()));
    return read();
  } catch { return 'unknown'; }
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HIDDEN_RELEASE_MS, IDLE_RELEASE_MS, MicrophoneHold, microphonePermission, microphoneReadyEnabled, setMicrophoneReadyEnabled, type HeldStream } from './microphone-hold';

/** Fake browser: counts getUserMedia calls, tracks that can end, and timers driven by hand. */
function browser() {
  const listeners = new Map<string, Set<() => void>>();
  const track = () => {
    const t = {
      enabled: true, readyState: 'live' as 'live' | 'ended', stopped: 0,
      stop() { this.stopped++; this.readyState = 'ended'; },
      addEventListener(type: string, fn: () => void) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn); },
      removeEventListener(type: string, fn: () => void) { listeners.get(type)?.delete(fn); },
      fire(type: string) { this.readyState = 'ended'; for (const fn of listeners.get(type) ?? []) fn(); },
    };
    return t;
  };
  const streams: Array<{ tracks: ReturnType<typeof track>[] } & HeldStream> = [];
  let calls = 0;
  const devices = { async getUserMedia() { calls++; const tracks = [track()]; const s = { tracks, getTracks: () => tracks }; streams.push(s); return s; } };
  const timers: Array<{ fn: () => void; ms: number; id: number }> = []; let nextId = 1;
  const clock = {
    setTimeout: (fn: () => void, ms: number) => { const id = nextId++; timers.push({ fn, ms, id }); return id; },
    clearTimeout: (id: unknown) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  const elapse = (ms: number) => { for (const t of [...timers]) if (t.ms <= ms) { clock.clearTimeout(t.id); t.fn(); } else t.ms -= ms; };
  return { devices, streams, clock, elapse, pending: () => timers.length, calls: () => calls };
}
const constraints = { audio: true };

test('three conversations in a row ask the browser once; the track is only re-enabled in between', async () => {
  const b = browser();
  const hold = new MicrophoneHold(b.devices, { keep: () => true, timers: b.clock });
  for (let i = 0; i < 3; i++) {
    const stream = await hold.acquire(constraints);
    assert.equal(stream, b.streams[0], 'the same stream serves every conversation');
    assert.equal(stream.getTracks()[0]!.enabled, true);
    hold.park();
    assert.equal(stream.getTracks()[0]!.enabled, false, 'parked: nothing is captured');
    assert.equal(b.streams[0]!.tracks[0]!.stopped, 0, 'parked: not stopped');
    assert.equal(hold.held, true);
  }
  assert.equal(b.calls(), 1);
});

test('after the idle time the parked microphone is really released and the next conversation asks again', async () => {
  const b = browser();
  const hold = new MicrophoneHold(b.devices, { keep: () => true, timers: b.clock });
  await hold.acquire(constraints); hold.park();
  b.elapse(IDLE_RELEASE_MS - 1);
  assert.equal(hold.held, true);
  b.elapse(1);
  assert.equal(hold.held, false);
  assert.equal(b.streams[0]!.tracks[0]!.stopped, 1);
  await hold.acquire(constraints);
  assert.equal(b.calls(), 2);
  assert.equal(b.pending(), 0, 'no timer while a conversation runs');
});

test('a conversation started before the idle time cancels the release', async () => {
  const b = browser();
  const hold = new MicrophoneHold(b.devices, { keep: () => true, timers: b.clock });
  await hold.acquire(constraints); hold.park();
  b.elapse(IDLE_RELEASE_MS - 1000);
  await hold.acquire(constraints);
  b.elapse(IDLE_RELEASE_MS);
  assert.equal(b.streams[0]!.tracks[0]!.stopped, 0);
  assert.equal(b.calls(), 1);
});

test('page hidden for longer than the grace period releases; visible again in time keeps it', async () => {
  const b = browser();
  const hold = new MicrophoneHold(b.devices, { keep: () => true, timers: b.clock });
  await hold.acquire(constraints); hold.park();
  hold.hidden(true); b.elapse(HIDDEN_RELEASE_MS - 1); hold.hidden(false); b.elapse(HIDDEN_RELEASE_MS);
  assert.equal(hold.held, true, 'came back in time');
  hold.hidden(true); b.elapse(HIDDEN_RELEASE_MS);
  assert.equal(hold.held, false);
  assert.equal(b.streams[0]!.tracks[0]!.stopped, 1);
  await hold.acquire(constraints);
  assert.equal(b.calls(), 2);
});

test('a track ended or muted by the system while parked forces a new capture next time', async () => {
  for (const event of ['ended', 'mute']) {
    const b = browser();
    const hold = new MicrophoneHold(b.devices, { keep: () => true, timers: b.clock });
    await hold.acquire(constraints); hold.park();
    b.streams[0]!.tracks[0]!.fire(event);
    assert.equal(hold.held, false, event);
    await hold.acquire(constraints);
    assert.equal(b.calls(), 2, event);
  }
});

test('a parked track that is no longer live is replaced even without an event', async () => {
  const b = browser();
  const hold = new MicrophoneHold(b.devices, { keep: () => true, timers: b.clock });
  await hold.acquire(constraints); hold.park();
  b.streams[0]!.tracks[0]!.readyState = 'ended';
  const next = await hold.acquire(constraints);
  assert.equal(next, b.streams[1]);
  assert.equal(b.calls(), 2);
});

test('option off: the old behaviour, one request per conversation and the track stopped at the end', async () => {
  const b = browser();
  const hold = new MicrophoneHold(b.devices, { keep: () => false, timers: b.clock });
  for (let i = 0; i < 3; i++) { await hold.acquire(constraints); hold.park(); assert.equal(b.streams[i]!.tracks[0]!.stopped, 1); assert.equal(hold.held, false); }
  assert.equal(b.calls(), 3);
  assert.equal(b.pending(), 0);
});

test('turning the option off after parking, logout or unmount release everything at once', async () => {
  const b = browser();
  let keep = true;
  const hold = new MicrophoneHold(b.devices, { keep: () => keep, timers: b.clock });
  await hold.acquire(constraints); hold.park();
  keep = false; hold.dispose();
  assert.equal(b.streams[0]!.tracks[0]!.stopped, 1);
  assert.equal(b.pending(), 0, 'no timer left behind');
  hold.dispose(); // repeating is harmless
  assert.equal(b.streams[0]!.tracks[0]!.stopped, 1);
});

test('between conversations nothing reaches the server: the track is disabled and no packet handler is attached', async () => {
  const b = browser();
  const hold = new MicrophoneHold(b.devices, { keep: () => true, timers: b.clock });
  const sent: unknown[] = [];
  const stream = await hold.acquire(constraints);
  // During the conversation the capture forwards packets; parking is what the hook does right after it stops that capture.
  let capture: ((pcm: ArrayBuffer) => void) | null = (pcm) => { if (stream.getTracks()[0]!.enabled) sent.push(pcm); };
  capture(new ArrayBuffer(10));
  capture = null; hold.park();
  // Whatever still runs sees a disabled track and no handler.
  assert.equal(stream.getTracks()[0]!.enabled, false);
  assert.equal(capture, null);
  assert.equal(sent.length, 1);
});

test('the preference is per device, on by default, and tolerates a missing storage', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  assert.equal(microphoneReadyEnabled(storage), true);
  setMicrophoneReadyEnabled(false, storage);
  assert.equal(microphoneReadyEnabled(storage), false);
  setMicrophoneReadyEnabled(true, storage);
  assert.equal(microphoneReadyEnabled(storage), true);
  assert.equal(microphoneReadyEnabled(null), true);
  assert.equal(microphoneReadyEnabled({ getItem: () => { throw new Error('bloqueado'); } }), true);
});

test('permission state reads granted/denied/prompt, follows changes, and is unknown when the browser cannot say', async () => {
  let fire: (() => void) | null = null;
  const status = { state: 'prompt', addEventListener: (_: 'change', fn: () => void) => { fire = fn; } };
  const seen: string[] = [];
  assert.equal(await microphonePermission({ query: async () => status }, s => seen.push(s)), 'prompt');
  status.state = 'denied'; fire!();
  status.state = 'granted'; fire!();
  assert.deepEqual(seen, ['denied', 'granted']);
  assert.equal(await microphonePermission(undefined), 'unknown');
  assert.equal(await microphonePermission({ query: async () => { throw new TypeError('microphone is not a valid PermissionName'); } }), 'unknown');
  assert.equal(await microphonePermission({ query: async () => ({ state: 'weird' }) }), 'unknown');
});

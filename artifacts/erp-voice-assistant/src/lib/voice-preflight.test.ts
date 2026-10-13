import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beforeVoiceCapture, VOICE_CHECK_FAILED, VOICE_WARNING } from './voice-preflight';

test('failing status warns before microphone capture or voice connection can begin', async () => {
  let microphoneCalls = 0;
  await assert.rejects(beforeVoiceCapture(
    async () => ({ reachable: false, expiresAt: new Date(Date.now() + 30000).toISOString() }),
    async () => { microphoneCalls++; return 'capture-and-socket'; },
  ), { message: VOICE_WARNING });
  assert.equal(microphoneCalls, 0);
});

test('unavailable or stale checks never capture and never propagate provider messages', async () => {
  let microphoneCalls = 0;
  const begin = async () => { microphoneCalls++; };
  for (const load of [
    async () => { throw new Error('private-provider-message'); },
    async () => ({ reachable: true, expiresAt: new Date(0).toISOString() }),
    async () => ({ reachable: true, expiresAt: 'invalid' }),
  ]) {
    await assert.rejects(beforeVoiceCapture(load, begin), { message: VOICE_CHECK_FAILED });
  }
  assert.equal(microphoneCalls, 0);
});

test('capture waits for the read-only check and starts once after a fresh positive result', async () => {
  let microphoneCalls = 0;
  let resolve!: (value: { reachable: boolean; expiresAt: string }) => void;
  const checking = new Promise<{ reachable: boolean; expiresAt: string }>(r => { resolve = r; });
  const result = beforeVoiceCapture(() => checking, async () => { microphoneCalls++; return 'capture'; });
  await new Promise(r => setImmediate(r));
  assert.equal(microphoneCalls, 0);
  resolve({ reachable: true, expiresAt: new Date(Date.now() + 30000).toISOString() });
  assert.equal(await result, 'capture');
  assert.equal(microphoneCalls, 1);
});

test('a key with speech and Scribe but no voices-read can proceed only after explicit confirmation', async () => {
  let readCalls = 0, microphoneCalls = 0;
  const restrictedKey = async () => {
    readCalls++;
    return { reachable: false, expiresAt: new Date(Date.now() + 30000).toISOString() };
  };
  const begin = async () => { microphoneCalls++; return 'real-conversation'; };
  await assert.rejects(beforeVoiceCapture(restrictedKey, begin), { message: VOICE_WARNING });
  assert.equal(microphoneCalls, 0);
  assert.equal(await beforeVoiceCapture(restrictedKey, begin, true), 'real-conversation');
  assert.equal(microphoneCalls, 1);
  assert.equal(readCalls, 1, 'explicit attempt does not repeatedly probe the denied read endpoint');
});

test('explicit confirmation also permits attempting voice after a transient read failure', async () => {
  let microphoneCalls = 0;
  const offline = async () => { throw new Error('read endpoint timeout'); };
  const begin = async () => { microphoneCalls++; return 'real-conversation'; };
  await assert.rejects(beforeVoiceCapture(offline, begin), { message: VOICE_CHECK_FAILED });
  assert.equal(microphoneCalls, 0);
  await beforeVoiceCapture(offline, begin, true);
  assert.equal(microphoneCalls, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceStartupTiming } from './voice-startup-timing';

test('startup diagnostics accept bounded finite durations only', () => {
  const trace = new VoiceStartupTiming();
  trace.record('config', NaN);
  trace.record('upstream', -1);
  trace.record('ws_open', 999999);
  assert.equal(trace.values.config, undefined);
  assert.equal(trace.values.upstream, undefined);
  assert.equal(trace.values.ws_open, 120000);
});
test('failed starts leave neither unbounded measures nor marks', async () => {
  const before = performance.getEntriesByType('mark').length;
  for (let i = 0; i < 50; i++) {
    const trace = new VoiceStartupTiming();
    await assert.rejects(trace.measure('classifier', async () => { throw new Error('local preparation failed'); }));
  }
  assert.ok(performance.getEntriesByName('voice:classifier', 'measure').length <= 20);
  assert.equal(performance.getEntriesByType('mark').length, before);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RetainedResource } from './retained-resource';

function fixture(idleMs = 20) {
  const counts = { load: 0, reset: 0, close: 0 };
  const value = {};
  const resource = new RetainedResource(async () => { ++counts.load; return value; }, () => { ++counts.reset; }, async () => { ++counts.close; }, idleMs);
  return { resource, counts, value };
}
test('idle warm-up and consecutive conversations share one classifier, reset each time', async () => {
  const { resource, counts, value } = fixture();
  assert.equal(await resource.warm(), value);
  assert.equal(await resource.acquire(), value);
  resource.park();
  assert.equal(await resource.acquire(), value);
  assert.deepEqual(counts, { load: 1, reset: 3, close: 0 });
  await resource.dispose();
  assert.equal(counts.close, 1);
});
test('parallel warm/acquire share one pending creation', async () => {
  const { resource, counts } = fixture();
  await Promise.all([resource.warm(), resource.warm(), resource.acquire()]);
  assert.equal(counts.load, 1);
  await resource.dispose();
});
test('reset and disposal wait for the previous inference', async () => {
  const { resource, counts } = fixture(1000);
  await resource.acquire();
  let finish!: () => void;
  resource.park(new Promise<void>(resolve => { finish = resolve; }));
  const next = resource.acquire();
  await Promise.resolve();
  assert.equal(counts.reset, 1);
  finish(); await next;
  assert.equal(counts.reset, 3);
  let drained!: () => void;
  const disposal = resource.dispose(new Promise<void>(resolve => { drained = resolve; }));
  await Promise.resolve();
  assert.equal(counts.close, 0);
  drained(); await disposal;
  assert.equal(counts.close, 1);
});
test('long idle disposes; a later conversation creates again', async () => {
  const { resource, counts } = fixture(5);
  await resource.acquire(); resource.park();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(counts.close, 1);
  await resource.acquire();
  assert.equal(counts.load, 2);
  await resource.dispose();
});
test('unmount/logout aborts a pending load and closes even a loader ignoring abort', async () => {
  let finish!: (value: object) => void;
  let closed = 0;
  let signal!: AbortSignal;
  const resource = new RetainedResource(s => { signal = s; return new Promise(resolve => { finish = resolve; }); }, () => {}, async () => { ++closed; });
  const pending = resource.warm();
  await resource.dispose();
  assert.equal(signal.aborted, true);
  finish({});
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(closed, 1);
});
test('failed initialization can be retried', async () => {
  let attempts = 0;
  const resource = new RetainedResource(async () => { if (++attempts === 1) throw new Error('failed'); return {}; }, () => {}, async () => {});
  await assert.rejects(resource.acquire(), /failed/);
  await resource.acquire();
  assert.equal(attempts, 2);
  await resource.dispose();
});
test('a cancelled conversation cannot reset the shared model after loading', async () => {
  const { resource, counts } = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resource.acquire(controller.signal), { name: 'AbortError' });
  assert.equal(counts.reset, 0);
  await resource.dispose();
});

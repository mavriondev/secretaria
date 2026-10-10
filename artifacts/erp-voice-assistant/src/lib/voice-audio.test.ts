import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { VoiceVad } from './voice-vad';
import { Pcm16Decoder, PcmSpeaker } from './pcm-speaker';
import { PcmInputPackets, type InputPacket } from './pcm-input-packets';

const frame = () => new ArrayBuffer(4800);
test('compatibility capture uses the same rate, packet size and PCM levels', () => {
  for (const rate of [24000, 44100, 48000]) {
    const packets: InputPacket[] = [];
    const capture = new PcmInputPackets(rate, packet => packets.push(packet));
    for (let i = 0; i < rate; i += 2048) capture.push(new Float32Array(Math.min(2048, rate - i)).fill(0.25));
    assert.equal(packets.length, 10);
    assert.equal(packets[0]!.pcm.byteLength, 4800);
    assert.equal(packets[0]!.rms, 0.25);
    assert.equal(new Int16Array(packets[0]!.pcm)[0], 8192);
  }
});
test('compatibility capture discards partial input on cleanup', () => {
  const packets: InputPacket[] = [];
  const capture = new PcmInputPackets(24000, packet => packets.push(packet));
  capture.push(new Float32Array(1200).fill(-1));
  capture.reset();
  capture.push(new Float32Array(2400).fill(1));
  assert.equal(packets.length, 1);
  assert.equal(new Int16Array(packets[0]!.pcm)[0], 32767);
});
test('VAD ignores silence/taps, preserves pre-roll and commits on a natural pause', () => {
  const vad = new VoiceVad();
  for (let i = 0; i < 20; i++) assert.equal(vad.push(frame(), 0.003).start, false);
  assert.equal(vad.push(frame(), 0.1, false, 0.99).start, false);
  assert.equal(vad.push(frame(), 0).start, false);
  assert.equal(vad.push(frame(), 0.1, false, 0.99).start, false);
  const start = vad.push(frame(), 0.1, false, 0.99);
  assert.equal(start.start, true); assert.equal(start.frames.length, 6);
  for (let i = 0; i < 8; i++) assert.equal(vad.push(frame(), 0).end, false);
  assert.equal(vad.push(frame(), 0).end, true);
  assert.equal(vad.push(frame(), 0).frames.length, 0);
});

test('loud non-speech never starts a turn or interrupts playback', () => {
  const vad = new VoiceVad();
  for (let i = 0; i < 100; i++) assert.equal(vad.push(frame(), 0.5, true, 0.1).start, false);
  for (let i = 0; i < 100; i++) assert.equal(vad.push(frame(), 0.5, false, 0.1).start, false);
  assert.equal(vad.push(frame(), 0.1, false, 0.99).start, false);
  assert.equal(vad.push(frame(), 0.1, false, 0.99).start, true);
});
test('VAD cancels long speech and waits for silence before accepting a new turn', () => {
  const vad = new VoiceVad(10);
  vad.push(frame(), 0.1, false, 0.99); vad.push(frame(), 0.1, false, 0.99);
  let cancelled = false;
  for (let i = 0; i < 20; i++) cancelled ||= vad.push(frame(), 0.1, false, 0.99).cancel;
  assert.equal(cancelled, true);
  assert.equal(vad.push(frame(), 0.1).start, false);
  for (let i = 0; i < 9; i++) vad.push(frame(), 0);
  vad.push(frame(), 0.1, false, 0.99);
  assert.equal(vad.push(frame(), 0.1, false, 0.99).start, true);
});
test('PCM decoding handles odd network chunks and resets between interrupted turns', () => {
  const decoder = new Pcm16Decoder();
  assert.equal(decoder.decode(new Uint8Array([0])).length, 0);
  assert.deepEqual([...decoder.decode(new Uint8Array([128, 255, 127]))], [-1, 32767 / 32768]);
  decoder.decode(new Uint8Array([255])); decoder.reset();
  assert.deepEqual([...decoder.decode(new Uint8Array([0, 0]))], [0]);
});
test('speaker streams immediately and a resumed voice stops all queued sound', () => {
  const nodes: { stopped: boolean; started: boolean; onended: (() => void) | null }[] = [];
  const context = {
    currentTime: 0, destination: {},
    createBuffer: (_channels: number, count: number, rate: number) => ({ duration: count / rate, copyToChannel() {} }),
    createBufferSource: () => {
      const node = { buffer: null, stopped: false, started: false, onended: null,
        connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } };
      nodes.push(node); return node;
    },
  } as unknown as AudioContext;
  const speaker = new PcmSpeaker(context, () => {});
  speaker.enqueue(new Uint8Array(4800));
  assert.equal(nodes[0]!.started, true);
  speaker.enqueue(new Uint8Array(4800));
  assert.equal(speaker.playing, true);
  const vad = new VoiceVad();
  assert.equal(vad.push(frame(), 0.1, speaker.playing, 0.99).start, false);
  assert.equal(vad.push(frame(), 0.1, speaker.playing, 0.99).start, false);
  const resumed = vad.push(frame(), 0.1, speaker.playing, 0.99);
  assert.equal(resumed.start, true);
  if (resumed.start) speaker.stop();
  assert.equal(nodes.every(node => node.stopped), true);
  assert.equal(speaker.playing, false);
  assert.equal(nodes.every(node => node.onended === null), true);
});
test('microphone worklet emits mono PCM at 24kHz for 48kHz and 44.1kHz devices', () => {
  for (const rate of [48000, 44100]) {
    const packets: { pcm: ArrayBuffer; rms: number }[] = [];
    let Processor: new () => { process(inputs: Float32Array[][]): void };
    const sandbox = {
      sampleRate: rate,
      AudioWorkletProcessor: class { port = { postMessage: (packet: { pcm: ArrayBuffer; rms: number }) => packets.push(packet) }; },
      registerProcessor: (_name: string, type: typeof Processor) => { Processor = type; },
    };
    vm.runInNewContext(readFileSync(new URL('./microphone-worklet.js', import.meta.url), 'utf8'), sandbox);
    const processor = new Processor!();
    const input = new Float32Array(rate).fill(0.25);
    processor.process([[input]]);
    assert.equal(packets.length, 10);
    assert.equal(packets[0]!.pcm.byteLength, 4800);
    assert.equal(packets[0]!.rms, 0.25);
  }
});

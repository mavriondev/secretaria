import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AMBIENTE, AVISO_FRAMES, PAUSA_FRAMES, VoiceVad, type AmbienteNivel } from './voice-vad';

/** A 100 ms frame whose samples all have the given amplitude (so RMS equals it); the detector only looks at the RMS. */
const frame = (amplitude = 0) => { const pcm = new Int16Array(2400).fill(Math.round(amplitude * 32767)); return pcm.buffer; };
const silent = (pcm: ArrayBuffer) => new Int16Array(pcm).every(v => v === 0);
const dB = (ratio: number) => 10 ** (ratio / 20);
const OWN = 0.1;

/** The person says two frames and the turn opens (pre-roll included). */
function speak(vad: VoiceVad, amplitude = OWN) {
  vad.push(frame(amplitude), amplitude, false, 0.99);
  const r = vad.push(frame(amplitude), amplitude, false, 0.99);
  assert.equal(r.start, true, 'own voice must start the turn');
  return r;
}
/** Another voice at `rel` dB below the person's own level (0.9 speech probability: the classifier cannot tell voices apart). */
const other = (vad: VoiceVad, rel: number) => { const a = OWN * dB(rel); return vad.push(frame(a), a, false, 0.9); };

test('send modes: automatic ends after 0.9 s, long pause after 2.5 s, manual never ends by silence', () => {
  for (const envio of ['automatico', 'pausa_longa'] as const) {
    const vad = new VoiceVad(300, { envio });
    speak(vad);
    const pausa = PAUSA_FRAMES[envio]!;
    for (let i = 0; i < pausa - 1; i++) assert.equal(vad.push(frame(), 0).end, false, `${envio}: not yet at frame ${i + 1}`);
    assert.equal(vad.push(frame(), 0).end, true, `${envio}: ends at frame ${pausa}`);
  }
  const manual = new VoiceVad(300, { envio: 'eu_envio' });
  speak(manual);
  for (let i = 0; i < 120; i++) { const r = manual.push(frame(), 0); assert.equal(r.end, false); assert.equal(r.cancel, false); }
  assert.equal(manual.open, true);
  assert.equal(manual.commit(), true, 'the tap sends');
  assert.equal(manual.open, false);
  assert.equal(manual.commit(), false, 'nothing open after sending');
  speak(manual);
  assert.equal(manual.drop(), true, 'the tap discards');
  assert.equal(manual.open, false);
});

test('long-pause and manual modes warn at 25 s and send at the 30 s limit; automatic still discards', () => {
  for (const envio of ['pausa_longa', 'eu_envio'] as const) {
    const vad = new VoiceVad(300, { envio });
    speak(vad);
    let warned = 0, ended: ReturnType<VoiceVad['push']> | undefined;
    for (let i = 0; i < 400 && !ended; i++) {
      const r = vad.push(frame(OWN), OWN, false, 0.9);
      if (r.warn) { warned++; assert.ok(vad.turnFrames >= AVISO_FRAMES, 'warning at 25 s'); }
      if (r.end) ended = r;
      assert.equal(r.cancel, false, `${envio} never discards`);
    }
    assert.equal(warned, 1, `${envio}: exactly one warning`);
    assert.ok(ended?.limit, `${envio}: ends with limit=true`);
    assert.equal(ended!.frames.length, 1, 'the last frame is still sent before the commit');
  }
  const auto = new VoiceVad(300);
  speak(auto);
  let cancelled = false, warned = false;
  for (let i = 0; i < 400 && !cancelled; i++) { const r = auto.push(frame(OWN), OWN, false, 0.9); if (r.warn) warned = true; if (r.cancel) cancelled = true; }
  assert.equal(cancelled, true); assert.equal(warned, false, 'automatic mode is unchanged');
});

test('preferences change between questions without a new detector', () => {
  const vad = new VoiceVad(300);
  speak(vad);
  for (let i = 0; i < 8; i++) vad.push(frame(), 0);
  assert.equal(vad.push(frame(), 0).end, true);
  vad.configure({ envio: 'pausa_longa' });
  speak(vad);
  for (let i = 0; i < 24; i++) assert.equal(vad.push(frame(), 0).end, false);
  assert.equal(vad.push(frame(), 0).end, true);
  assert.deepEqual(vad.settings, { envio: 'pausa_longa', ambiente: 'normal' });
});

/**
 * Part B table: a second voice at -6, -12 and -18 dB of the person's own level, in each surroundings level.
 * Checked both as a background during the person's turn (does it extend the turn? is it transcribed?) and alone,
 * after the person already spoke once in this conversation (does it start a turn?).
 */
test('surroundings levels: table of -6/-12/-18 dB voices', () => {
  const rows: string[] = [];
  const expectations: Record<AmbienteNivel, Record<number, { starts: boolean; muted: boolean }>> = {
    normal: { [-6]: { starts: true, muted: false }, [-12]: { starts: true, muted: false }, [-18]: { starts: true, muted: false } },
    ruidoso: { [-6]: { starts: true, muted: false }, [-12]: { starts: false, muted: true }, [-18]: { starts: false, muted: true } },
    muito_ruidoso: { [-6]: { starts: false, muted: true }, [-12]: { starts: false, muted: true }, [-18]: { starts: false, muted: true } },
  };
  for (const ambiente of Object.keys(AMBIENTE) as AmbienteNivel[]) {
    for (const rel of [-6, -12, -18]) {
      // During the turn: the person spoke, then the other voice goes on for 2 s.
      const vad = new VoiceVad(300, { envio: 'automatico', ambiente });
      speak(vad);
      let ended = false, mutedFrames = 0, extended = false;
      for (let i = 0; i < 20 && !ended; i++) {
        const r = other(vad, rel);
        if (r.level.speech) extended = true;
        if (r.frames[0] && silent(r.frames[0])) mutedFrames++;
        if (r.end) ended = true;
      }
      // Alone, after the conversation already heard the person once (reference level known).
      const alone = new VoiceVad(300, { envio: 'automatico', ambiente });
      speak(alone); for (let i = 0; i < 9; i++) alone.push(frame(), 0);
      let starts = false;
      for (let i = 0; i < 10; i++) if (other(alone, rel).start) starts = true;
      const want = expectations[ambiente][rel]!;
      rows.push(`${ambiente.padEnd(14)} ${String(rel).padStart(4)} dB  inicia sozinha: ${starts ? 'sim' : 'não'}  prolonga: ${extended ? 'sim' : 'não'}  encerra em 0,9 s: ${ended ? 'sim' : 'não'}  quadros silenciados: ${mutedFrames}`);
      assert.equal(starts, want.starts, `${ambiente} ${rel} dB starts`);
      assert.equal(extended, want.starts, `${ambiente} ${rel} dB extends the turn`);
      assert.equal(mutedFrames > 0, want.muted, `${ambiente} ${rel} dB muted`);
      if (want.muted) assert.equal(ended, true, `${ambiente} ${rel} dB: the person's pause still ends the turn`);
    }
  }
  console.log('\n' + rows.join('\n') + '\n');
});

test('own quiet syllables are kept: short dips are not muted and a moderate whisper still starts', () => {
  const vad = new VoiceVad(300, { envio: 'automatico', ambiente: 'ruidoso' });
  speak(vad);
  // A two-frame dip to -10 dB in the middle of a sentence is kept as audio.
  const dip = OWN * dB(-10);
  assert.equal(silent(vad.push(frame(dip), dip, false, 0.9).frames[0]!), false);
  assert.equal(silent(vad.push(frame(dip), dip, false, 0.9).frames[0]!), false);
  assert.equal(silent(vad.push(frame(dip), dip, false, 0.9).frames[0]!), true, 'the third consecutive quiet frame is silenced');
  assert.equal(silent(vad.push(frame(OWN), OWN, false, 0.9).frames[0]!), false, 'back to normal at once');
  // Pre-roll frames are never muted: the start result carries them untouched.
  const fresh = new VoiceVad(300, { ambiente: 'muito_ruidoso' });
  const start = speak(fresh);
  assert.ok(start.frames.every(f => !silent(f)));
  // After one question, a moderate whisper (-8 dB of the own level) still starts the next one in "ruidoso".
  const whisper = new VoiceVad(300, { ambiente: 'ruidoso' });
  speak(whisper); for (let i = 0; i < 9; i++) whisper.push(frame(), 0);
  const w = OWN * dB(-8);
  whisper.push(frame(w), w, false, 0.99);
  assert.equal(whisper.push(frame(w), w, false, 0.99).start, true);
});

test('level reported for the indicator and higher onset thresholds in noisy levels', () => {
  const r = new VoiceVad(300, { ambiente: 'muito_ruidoso' }).push(frame(0.02), 0.02, false, 0.99);
  assert.equal(r.level.rms, 0.02); assert.equal(r.level.threshold, AMBIENTE.muito_ruidoso.onset); assert.equal(r.level.speech, false);
  const n = new VoiceVad(300).push(frame(0.02), 0.02, false, 0.99);
  assert.equal(n.level.speech, true);
});

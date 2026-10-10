import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSpeech, pcmWav, requireSpeechMatch } from "../lib/checked-speech";

test("normalization retains monetary punctuation, signs and negations", () => {
  for (const [a,b] of [["-10","10"], ["10,50","1050"], ["não pago","pago"], ["15","115"], ["2,56%","256%"]]) {
    assert.notEqual(normalizeSpeech(a!), normalizeSpeech(b!));
  }
});
test("a matching generated transcript cannot override independent recognition disagreement", async () => {
  await assert.rejects(requireSpeechMatch("quinze", "quinze", "cento e quinze", async () => false, new AbortController().signal));
});
test("empty, rejected, failed and cancelled checks never approve", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(requireSpeechMatch("texto", "", "texto", async () => true, signal));
  await assert.rejects(requireSpeechMatch("texto", "outro", "texto", async () => { throw new Error("unavailable"); }, signal));
  const controller = new AbortController();
  await assert.rejects(requireSpeechMatch("texto", "outro", "texto", async () => { controller.abort(); return true; }, controller.signal));
});
test("exact match and independently accepted formatting can pass", async () => {
  const signal = new AbortController().signal;
  await requireSpeechMatch("Bom dia", "bom dia", "bom dia", async () => { throw new Error("not needed"); }, signal);
  await requireSpeechMatch("quinze", "quinze", "15", async () => true, signal);
  const wav = pcmWav(Buffer.alloc(48000));
  assert.equal(wav.toString("ascii",0,4),"RIFF");
  assert.equal(wav.readUInt32LE(24),24000);
});

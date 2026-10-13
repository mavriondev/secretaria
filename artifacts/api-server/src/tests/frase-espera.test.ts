import assert from "node:assert/strict";
import { test } from "node:test";
import { phrasePool, thinkingPhrase, type PhraseKind } from "../lib/preferences";
import { cachedSpeech, clearPhraseCache, withThinkingSpeech } from "../lib/thinking-speech";

const settings = { preferredName: "", voiceGender: "female" as const, thinkingSpeech: true };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("no waiting phrase carries a number, a currency, news or a promise about the answer", () => {
  for (const kind of ["dados", "externo", "demora"] as PhraseKind[]) {
    assert.ok(phrasePool(kind).length >= 3);
    for (const p of phrasePool(kind)) {
      assert.doesNotMatch(p, /\d|R\$|%/, p);
      assert.doesNotMatch(p, /not[ií]cia|aumentou|caiu|subiu|lucro|vendas? de/i, p);
      assert.ok(p.length <= 60, "short enough to finish before the answer");
    }
  }
});

test("a phrase never repeats one of the last two used", () => {
  const seen: string[] = [];
  for (let i = 0; i < 200; i++) {
    const p = thinkingPhrase(settings, "dados");
    assert.ok(!seen.slice(-2).includes(p), `${p} repeated within two turns`);
    seen.push(p);
  }
  assert.ok(new Set(seen).size >= phrasePool("dados").length - 1, "the whole pool gets used");
});

test("a phrase that played to the end is kept and replayed without calling the provider again", async () => {
  clearPhraseCache();
  let calls = 0;
  const request = async () => { calls++; return new Response(new Uint8Array(1000)); };
  const first: number[] = []; const second: number[] = [];
  await cachedSpeech("Já te respondo.", new AbortController().signal, async c => { first.push(c.length); }, "marin", request as never);
  await cachedSpeech("Já te respondo.", new AbortController().signal, async c => { second.push(c.length); }, "marin", request as never);
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  // another voice is another recording
  await cachedSpeech("Já te respondo.", new AbortController().signal, async () => {}, "cedar", request as never);
  assert.equal(calls, 2);
});

test("an interrupted phrase is not kept", async () => {
  clearPhraseCache();
  let calls = 0;
  const controller = new AbortController();
  const request = async () => { calls++; return new Response(new Uint8Array(1000)); };
  await cachedSpeech("Deixa eu confirmar.", controller.signal, async () => { controller.abort(); }, "marin", request as never).catch(() => {});
  await cachedSpeech("Deixa eu confirmar.", new AbortController().signal, async () => {}, "marin", request as never);
  assert.equal(calls, 2);
});

test("a long wait gets a second, different line; a short one gets only the first", async () => {
  const spoken: string[] = [];
  const speak = async (text: string, signal: AbortSignal) => { spoken.push(text); await new Promise<void>(r => signal.addEventListener("abort", () => r(), { once: true })); };
  await withThinkingSpeech(settings, new AbortController().signal, async () => {}, () => sleep(260), speak as never, 20, "dados", 120);
  assert.equal(spoken.length, 2);
  assert.ok(phrasePool("dados").includes(spoken[0]!) && phrasePool("demora").includes(spoken[1]!));
  spoken.length = 0;
  await withThinkingSpeech(settings, new AbortController().signal, async () => {}, () => sleep(60), speak as never, 20, "externo", 120);
  assert.deepEqual(spoken.map(p => phrasePool("externo").includes(p)), [true]);
});

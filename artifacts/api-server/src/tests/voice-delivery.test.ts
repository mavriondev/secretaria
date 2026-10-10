import { test } from "node:test";
import assert from "node:assert/strict";
import { conciseSpeech, pacedSpeechSink } from "../lib/voice-delivery";

test("fast audio generation is paced without buffering a minute in the browser", async () => {
  let clock = 0, bytes = 0, maxAhead = 0;
  const sink = pacedSpeechSink(async chunk => {
    bytes += chunk.length;
    maxAhead = Math.max(maxAhead, bytes / 48 - clock);
  }, new AbortController().signal, () => clock, async ms => { clock += ms; });
  for (let i = 0; i < 500; i++) await sink(new Uint8Array(8192));
  assert.ok(maxAhead <= 10001);
  assert.equal(bytes, 4096000);
});
test("pacing cancellation never delivers stale audio", async () => {
  const controller = new AbortController();
  let sent = 0;
  const sink = pacedSpeechSink(async () => { sent++; }, controller.signal, () => 0, async () => { controller.abort(); });
  await assert.rejects(sink(new Uint8Array(600000)));
  assert.equal(sent, 0);
});
test("long research uses complete opening sentences and retains exact quantities", () => {
  const first = "O faturamento foi R$ 1.959.861,04 no período informado. ";
  const spoken = conciseSpeech(first + "Não há evidência suficiente para atribuir a mudança à política atual. ".repeat(50));
  assert.ok(spoken.startsWith(first.trim()));
  assert.ok(spoken.length <= 950);
  assert.match(spoken, /restante da resposta/);
  assert.equal(conciseSpeech(first),first.trim());
});

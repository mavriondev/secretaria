import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { streamSpeech } from "../lib/openai-direct";

test("speech is forwarded before generation ends, without a transcription call", async () => {
  let ended = false, closed = false, chunks = 0;
  const iterator = (async function* () {
    yield { choices: [{ delta: { audio: { data: Buffer.alloc(4800).toString("base64") } } }] };
    assert.equal(chunks,1);
    yield { choices: [{ delta: { audio: { data: Buffer.alloc(4800).toString("base64") } } }] };
    ended = true;
  })();
  const client = { chat: { completions: { create: async (body: { model: string; stream: boolean }) => {
    assert.equal(body.model, "gpt-audio-1.5");
    assert.equal(body.stream, true);
    return Object.assign(iterator, { controller: { abort: () => { closed = true; } } });
  } } } } as unknown as OpenAI;
  await streamSpeech("O saldo é cem reais.", new AbortController().signal, async () => {
    assert.equal(ended, false); chunks++;
  }, "marin", client);
  assert.equal(chunks,2); assert.equal(closed,true);
});

test("interrupting streamed speech suppresses subsequent chunks and closes provider stream", async () => {
  const controller = new AbortController();
  let count = 0, closed = false;
  const iterator = (async function* () {
    for(let i=0;i<3;i++) yield { choices: [{ delta: { audio: { data: Buffer.alloc(4800).toString("base64") } } }] };
  })();
  const client = { chat: { completions: { create: async () => Object.assign(iterator, {controller:{abort:()=>{closed=true;}}}) } } } as unknown as OpenAI;
  await assert.rejects(streamSpeech("Exemplo.", controller.signal, async () => { count++; controller.abort(); }, "marin", client));
  assert.equal(count,1); assert.equal(closed,true);
});

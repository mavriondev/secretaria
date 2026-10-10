import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { streamSpeech, speechModel, voiceIds } from "../lib/elevenlabs";
import { ElevenScribe } from "../lib/eleven-scribe";

test("Eleven voice streams PCM with selected gender and no OpenAI request", async () => {
  let chunks = 0;
  await streamSpeech("O total é cem reais.", new AbortController().signal, async () => { chunks++; }, "cedar", async (path, init) => {
    assert.match(path, /text-to-dialogue\/stream\?output_format=pcm_24000/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model_id, speechModel);
    assert.equal(body.language_code, "pt");
    assert.equal(body.inputs[0].voice_id, voiceIds.male);
    assert.equal(body.apply_text_normalization, "on");
    return new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(12000)); c.enqueue(new Uint8Array(2000)); c.close(); },
    }));
  });
  assert.equal(chunks, 3);
});
test("Eleven voice cancels its response body on interruption", async () => {
  const controller = new AbortController();
  let cancelled = false, chunks = 0;
  await assert.rejects(streamSpeech("Olá.", controller.signal, async () => {
    chunks++; controller.abort();
  }, "marin", async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(10000)); },
    cancel() { cancelled = true; },
  }))));
  assert.equal(chunks, 1); assert.equal(cancelled, true);
});

class FakeSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit("close"); }
  receive(data: object) { this.emit("message", Buffer.from(JSON.stringify(data))); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test("Scribe commits once, closes after recognition and ignores cancelled-session transcripts", async () => {
  const sockets: FakeSocket[] = [], events: Array<{type:string; transcript?:string}> = [];
  let closed = 0;
  const provider = new ElevenScribe(e => events.push(e), () => closed++, {
    token: async () => "synthetic-token",
    socket: url => {
      assert.equal(url.searchParams.get("model_id"), "scribe_v2_realtime");
      assert.equal(url.searchParams.get("commit_strategy"), "manual");
      assert.equal(url.searchParams.get("audio_format"), "pcm_24000");
      const socket = new FakeSocket(); sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  const send = (type: string) => provider.send(JSON.stringify({type, audio: "AAAA"}));
  await tick();
  sockets[0]!.receive({message_type:"session_started"});
  send("input_audio_buffer.clear"); send("input_audio_buffer.append"); send("input_audio_buffer.commit");
  assert.equal(sockets[0]!.sent.at(-1)?.commit, true);
  assert.equal(events.filter(e=>e.type==="input_audio_buffer.committed").length, 1);
  // Start another utterance before the prior transcript is delivered.
  send("input_audio_buffer.clear"); send("input_audio_buffer.append"); send("input_audio_buffer.commit");
  await tick();
  sockets[0]!.receive({message_type:"committed_transcript",text:"resposta cancelada"});
  sockets[1]!.receive({message_type:"session_started"});
  sockets[1]!.receive({message_type:"committed_transcript",text:"pergunta atual"});
  const completed = events.filter(e=>e.type==="conversation.item.input_audio_transcription.completed");
  assert.deepEqual(completed.map(e=>e.transcript),["pergunta atual"]);
  assert.equal(closed,0);
  assert.equal(sockets[1]!.readyState,3);
  provider.close();
});

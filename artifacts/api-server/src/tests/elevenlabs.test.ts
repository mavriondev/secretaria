import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { elevenRequest, ElevenLabsError, streamSpeech, speechModel, voiceIds } from "../lib/elevenlabs";
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
test("Direct key takes priority, preserves headers/body/signal and disables redirects", async () => {
  const signal = new AbortController().signal;
  const body = new FormData(); body.append("model_id", "scribe_v2");
  const headers = new Headers({ "x-test": "kept" });
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2)); c.close(); } }));
  assert.equal(await elevenRequest("/v1/speech-to-text", { method: "POST", headers, body, signal }, {
    env: { ELEVENLABS_API_KEY: "test-key", REPL_ID: "test-repl" },
    connector: () => { throw new Error("Must not use connector"); },
    direct: async (url, init) => {
      assert.equal(url, "https://api.elevenlabs.io/v1/speech-to-text");
      assert.equal(new Headers(init.headers).get("xi-api-key"), "test-key");
      assert.equal(new Headers(init.headers).get("x-test"), "kept");
      assert.equal(new Headers(init.headers).get("content-type"), null);
      assert.equal(init.body, body); assert.equal(init.signal, signal);
      assert.equal(init.redirect, "error");
      return response;
    },
  }), response);
  assert.equal(headers.has("xi-api-key"), false);
});
test("Without a direct key Replit obtains connector fetch freshly each time", async () => {
  let calls = 0;
  const deps = {
    env: { REPL_ID: "test-repl" },
    direct: async () => { throw new Error("Must not use direct"); },
    connector: () => { calls++; return async () => new Response("{}"); },
  };
  await elevenRequest("/v1/voices", {}, deps);
  await elevenRequest("/v1/voices", {}, deps);
  assert.equal(calls, 2);
});
test("Missing VPS key fails explicitly; unsafe paths never reach a transport", async () => {
  let calls = 0;
  const deps = { env: {}, direct: async () => { calls++; return new Response(); },
    connector: () => { calls++; return async () => new Response(); } };
  await assert.rejects(elevenRequest("/v1/voices", {}, deps), { code: "configuration" });
  deps.env = { ELEVENLABS_API_KEY: "test-key" } as typeof deps.env;
  await assert.rejects(elevenRequest("@evil.example/v1/voices", {}, deps), { code: "configuration" });
  await assert.rejects(elevenRequest("/v1/../../outside", {}, deps), { code: "configuration" });
  assert.equal(calls, 0);
});
test("HTTP and network failures are safe and never fall back to the connector", async () => {
  for (const [status, code] of [[401, "authorization"], [403, "permissions"], [402, "quota"], [429, "quota"], [500, "unavailable"]] as const) {
    let cancelled = false;
    await assert.rejects(elevenRequest("/v1/voices", {}, {
      env: { ELEVENLABS_API_KEY: "test-key" },
      connector: () => { throw new Error("Must not retry"); },
      direct: async () => new Response(new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode("sensitive-provider-body".repeat(1000))); },
        cancel() { cancelled = true; },
      }), { status }),
    }), (error: unknown) => error instanceof ElevenLabsError && error.code === code && error.status === status
      && !error.message.includes("sensitive-provider-body") && !error.message.includes("test-key"));
    assert.equal(cancelled, true);
  }
  await assert.rejects(elevenRequest("/v1/voices", {}, {
    env: { ELEVENLABS_API_KEY: "test-key" },
    connector: () => { throw new Error("Must not retry"); },
    direct: async () => { throw new Error("xi-api-key=test-key"); },
  }), (error: unknown) => error instanceof ElevenLabsError && !error.message.includes("test-key"));
});
test("Direct requests preserve upstream abort without exposing fetch errors", async () => {
  const controller = new AbortController();
  await assert.rejects(elevenRequest("/v1/single-use-token/realtime_scribe", { signal: controller.signal }, {
    env: { ELEVENLABS_API_KEY: "test-key" },
    connector: () => { throw new Error("Must not retry"); },
    direct: async (_url, init) => {
      assert.equal(init.signal, controller.signal);
      controller.abort();
      throw new Error("sensitive fetch error");
    },
  }), { name: "AbortError" });
});
test("Provider invalid_api_key on HTTP 400 and missing_permissions on 401 are classified safely", async () => {
  for (const [status, providerCode, code] of [[400, "invalid_api_key", "authorization"], [401, "missing_permissions", "permissions"]] as const) {
    await assert.rejects(elevenRequest("/v1/voices", {}, {
      env: { ELEVENLABS_API_KEY: "test-key" },
      connector: () => { throw new Error("Must not retry"); },
      direct: async () => new Response(JSON.stringify({ detail: { status: providerCode, message: "sensitive-key" } }), { status }),
    }), (error: unknown) => error instanceof ElevenLabsError && error.code === code && !error.message.includes("sensitive-key"));
  }
});
test("Scribe authorization failure exposes only a classified safe code", async () => {
  const events: Array<{ type: string; error?: { code?: string } }> = [];
  const provider = new ElevenScribe(e => events.push(e), () => {}, {
    token: async () => { throw new ElevenLabsError("configuration"); },
    socket: () => { throw new Error("Must not open a socket"); },
  });
  await tick();
  assert.deepEqual(events, [{ type: "error", error: { code: "elevenlabs_configuration" } }]);
  provider.close();
});
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

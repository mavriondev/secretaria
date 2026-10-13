import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { ElevenLabsError, scribeToken, transcriptionModel } from "./elevenlabs";

type Event = { type: string; item_id?: string; transcript?: string; delta?: string; error?: { code?: string } };
type Input = { type: string; audio?: string };

/** One upstream session per utterance: cancelled transcripts cannot leak to
 * the next turn, and silence during ERP/web work is not continuously streamed.
 * The initial connection is warmed on start; later audio waits in a bounded queue.
 */
export class ElevenScribe {
  private ws?: WebSocket;
  private controller = new AbortController();
  private revision = 0;
  private closed = false;
  private initialized = false;
  private used = false;
  private active = false;
  private committed = false;
  private item = "";
  private pending: object[] = [];
  private bytes = 0;
  private upstreamReady = false;
  constructor(
    private onEvent: (e: Event) => void, private onClose: () => void,
    private deps = {
      token: scribeToken,
      socket: (url: URL) => new WebSocket(url, { handshakeTimeout: 12000, maxPayload: 128 * 1024 }),
    },
  ) { void this.connect(); }
  get readyState() { return this.closed ? WebSocket.CLOSED : WebSocket.OPEN; }
  get bufferedAmount() { return this.ws?.bufferedAmount ?? 0; }
  discardSpeech() { /* Scribe never generates an assistant response. */ }
  private async connect() {
    const revision = ++this.revision;
    this.controller.abort(); this.controller = new AbortController();
    this.ws?.close(); this.ws = undefined; this.upstreamReady = false;
    try {
      const token = await this.deps.token(AbortSignal.any([this.controller.signal, AbortSignal.timeout(12000)]));
      if (this.closed || revision !== this.revision) return;
      const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
      url.search = new URLSearchParams({
        model_id: transcriptionModel, token, audio_format: "pcm_24000",
        language_code: "pt", commit_strategy: "manual", filter_background_audio: "true",
      }).toString();
      const ws = this.deps.socket(url);
      this.ws = ws;
      ws.on("message", raw => {
        if (this.closed || revision !== this.revision) return;
        try {
          const e = JSON.parse(raw.toString());
          if (e.message_type === "session_started") {
            this.upstreamReady = true;
            for (const input of this.pending.splice(0)) ws.send(JSON.stringify(input));
            if (!this.initialized) {
              this.initialized = true;
              this.onEvent({ type: "transcription_session.updated" });
            }
          } else if (e.message_type === "committed_transcript" && this.committed) {
            const item = this.item, text = String(e.text ?? "").trim();
            this.active = false; this.committed = false; this.used = true;
            this.revision++; ws.close(); this.upstreamReady = false;
            this.onEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: item, transcript: text });
          } else if (String(e.message_type).endsWith("error") || e.message_type === "error") {
            this.onEvent({ type: "error", error: { code: "elevenlabs_transcription_failed" } });
          }
        } catch { this.onEvent({ type: "error", error: { code: "elevenlabs_invalid_event" } }); }
      });
      ws.on("error", () => {
        if (!this.closed && revision === this.revision) this.onEvent({ type: "error", error: { code: "elevenlabs_connection_failed" } });
      });
      ws.on("close", () => {
        if (!this.closed && revision === this.revision) this.onClose();
      });
    } catch (error) {
      if (!this.closed && revision === this.revision) this.onEvent({ type: "error", error: {
        code: error instanceof ElevenLabsError ? `elevenlabs_${error.code}` : "elevenlabs_authorization_failed",
      } });
    }
  }
  send(raw: string) {
    if (this.closed) return;
    const e = JSON.parse(raw) as Input;
    if (e.type === "input_audio_buffer.clear") {
      const reconnect = this.used || this.active || this.committed;
      this.pending = []; this.bytes = 0; this.item = "";
      this.active = true; this.committed = false; this.used = true;
      if (reconnect) void this.connect();
    } else if (e.type === "input_audio_buffer.append" && this.active && !this.committed) {
      this.bytes += Buffer.byteLength(e.audio ?? "", "base64");
      if (this.bytes > 1_440_000) throw new Error("Pergunta muito longa.");
      this.write({ message_type: "input_audio_chunk", audio_base_64: e.audio, sample_rate: 24000, commit: false });
    } else if (e.type === "input_audio_buffer.commit" && this.active && !this.committed) {
      this.committed = true; this.item = randomUUID();
      this.onEvent({ type: "input_audio_buffer.committed", item_id: this.item });
      this.write({ message_type: "input_audio_chunk", audio_base_64: "", sample_rate: 24000, commit: true });
    }
  }
  private write(e: object) {
    if (this.upstreamReady && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(e));
    else this.pending.push(e);
  }
  close() {
    this.closed = true; this.revision++; this.controller.abort();
    this.pending = []; this.ws?.close();
  }
}

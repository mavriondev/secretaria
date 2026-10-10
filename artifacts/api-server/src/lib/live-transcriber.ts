import WebSocket from "ws";
import { aiConfig } from "./openai-direct";

type ProviderEvent = {
  type: string; item_id?: string; previous_item_id?: string; transcript?: string; delta?: string;
  error?: { code?: string; param?: string };
};

export const transcriptionSession = () => ({
  type: "session.update",
  session: {
    type: "transcription",
    audio: { input: {
      format: { type: "audio/pcm", rate: 24000 },
      transcription: { model: aiConfig.transcriptionModel },
      turn_detection: null,
    } },
  },
});

export function openTranscriber(onEvent: (event: ProviderEvent) => void, onClose: () => void) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY para iniciar a voz.");
  const ws = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    maxPayload: 1024 * 1024, handshakeTimeout: 15000,
  });
  ws.on("open", () => ws.send(JSON.stringify(transcriptionSession())));
  ws.on("message", data => {
    try { onEvent(JSON.parse(data.toString()) as ProviderEvent); }
    catch { onEvent({ type: "error", error: { code: "invalid_provider_event" } }); }
  });
  ws.on("error", () => onEvent({ type: "error", error: { code: "provider_connection_failed" } }));
  ws.on("close", onClose);
  return ws;
}

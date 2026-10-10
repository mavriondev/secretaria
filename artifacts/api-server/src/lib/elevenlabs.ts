import { ReplitConnectors } from "@replit/connectors-sdk";
import { pcmWav } from "./checked-speech";
import { conciseSpeech } from "./voice-delivery";

export const speechModel = "eleven_v4_turbo";
export const transcriptionModel = "scribe_v2_realtime";
// Existing voices verified through this account's read-only voice endpoint.
export const voiceIds = { male: "CwhRBWXzGAHq8TQ4Fs17", female: "EXAVITQu4vr4xnSDxMaL" };

/** Fresh authenticated fetch, with AbortSignal and streaming body support. */
export async function elevenRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const fetchWithAuth = new ReplitConnectors().createProxyFetch("elevenlabs");
  const response = await fetchWithAuth(`https://api.elevenlabs.io${path}`, init);
  if (!response.ok) {
    // Never surface response bodies, auth headers or single-use tokens in logs.
    await response.body?.cancel();
    throw new Error(`ElevenLabs respondeu HTTP ${response.status}. Verifique permissões, plano e saldo da conexão.`);
  }
  return response;
}

export async function scribeToken(signal: AbortSignal): Promise<string> {
  const response = await elevenRequest("/v1/single-use-token/realtime_scribe", { method: "POST", signal });
  const data = await response.json() as { token?: string };
  if (!data.token) throw new Error("ElevenLabs não autorizou a conexão de escuta.");
  return data.token;
}

export async function streamSpeech(
  text: string, signal: AbortSignal, onChunk: (chunk: Uint8Array) => Promise<void>,
  voice = "marin", request = elevenRequest,
): Promise<void> {
  if (!text.trim() || text.length > 2000) throw new Error("A fala deve conter entre um e dois mil caracteres.");
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
  const response = await request("/v1/text-to-dialogue/stream?output_format=pcm_24000", {
    method: "POST", signal: bounded, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: speechModel, language_code: "pt",
      inputs: [{ text, voice_id: voice === "cedar" || voice === "male" ? voiceIds.male : voiceIds.female }],
      apply_text_normalization: "on",
    }),
  });
  if (!response.body) throw new Error("ElevenLabs não retornou uma transmissão de áudio.");
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      bounded.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 4_000_000) throw new Error("A fala excedeu a duração permitida.");
      for (let i = 0; i < value.length; i += 8192) {
        bounded.throwIfAborted();
        await onChunk(value.subarray(i, i + 8192));
      }
    }
    if (!total || total % 2) throw new Error("ElevenLabs retornou áudio vazio ou incompleto.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function synthesizeSpeech(text: string, voice = "marin") {
  const chunks: Buffer[] = [];
  await streamSpeech(conciseSpeech(text), AbortSignal.timeout(45000), async c => { chunks.push(Buffer.from(c)); }, voice);
  return { audioBase64: pcmWav(Buffer.concat(chunks)).toString("base64"), mimeType: "audio/wav" };
}

/** Compatibility upload endpoint; live conversations use Scribe Realtime. */
export async function transcribeAudio(audioBase64: string, mimeType: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) throw new Error("Áudio inválido.");
  const bytes = Buffer.from(audioBase64, "base64");
  if (bytes.length < 50 || bytes.length > 10 * 1024 * 1024) throw new Error("Grave um áudio válido de até 10 MB.");
  const formats: Record<string, string> = { "audio/webm": "webm", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg" };
  if (!formats[mimeType]) throw new Error("Formato de áudio não suportado.");
  const form = new FormData();
  form.append("model_id", "scribe_v2"); form.append("language_code", "por");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([bytes], { type: mimeType }), `question.${formats[mimeType]}`);
  const response = await elevenRequest("/v1/speech-to-text", { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  const data = await response.json() as { text?: string };
  const text = data.text?.trim();
  if (!text || text.length > 2000) throw new Error("Não foi possível transcrever uma pergunta curta.");
  return text;
}

import { ReplitConnectors } from "@replit/connectors-sdk";
import { pcmWav } from "./checked-speech";
import { conciseSpeech } from "./voice-delivery";

export const speechModel = "eleven_v4_turbo";
export const transcriptionModel = "scribe_v2_realtime";
// Existing voices verified through this account's read-only voice endpoint.
export const voiceIds = { male: "CwhRBWXzGAHq8TQ4Fs17", female: "EXAVITQu4vr4xnSDxMaL" };

export type ElevenFailure = "configuration" | "authorization" | "permissions" | "quota" | "unavailable";
export class ElevenLabsError extends Error {
  constructor(public readonly code: ElevenFailure, public readonly status?: number) {
    const messages: Record<ElevenFailure, string> = {
      configuration: "Configure ELEVENLABS_API_KEY no servidor para ativar voz e transcrição fora do Replit.",
      authorization: "ElevenLabs não autorizou o acesso. Verifique a chave ou a conexão e a permissão Speech to Text para o Scribe.",
      permissions: "ElevenLabs negou o acesso. Verifique as permissões da chave e a lista de IPs autorizados.",
      quota: "ElevenLabs atingiu um limite. Verifique saldo, cota e conversas simultâneas.",
      unavailable: "Não foi possível acessar ElevenLabs. Verifique a conexão e tente novamente.",
    };
    super(messages[code]);
    this.name = "ElevenLabsError";
  }
}

type ElevenTransport = {
  env: NodeJS.ProcessEnv;
  direct: (url: string, init: RequestInit) => Promise<Response>;
  connector: () => (url: string, init: RequestInit) => Promise<Response>;
};

/** Read only bounded error metadata. No provider message is propagated or logged. */
async function providerFailure(response: Response): Promise<ElevenFailure> {
  let providerCode: unknown;
  const reader = response.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const deadline = setTimeout(() => { void reader.cancel().catch(() => {}); }, 1000);
    try {
      while (bytes <= 16384) {
        const { value, done } = await reader.read();
        if (done) {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          providerCode = data?.detail?.status;
          break;
        }
        bytes += value.length;
        if (bytes <= 16384) chunks.push(value);
      }
    } catch { /* malformed metadata never replaces the safe HTTP classification */ }
    finally { clearTimeout(deadline); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  if (providerCode === "invalid_api_key") return "authorization";
  if (providerCode === "missing_permissions") return "permissions";
  if (providerCode === "quota_exceeded") return "quota";
  return response.status === 401 ? "authorization" : response.status === 403 ? "permissions"
    : response.status === 402 || response.status === 429 ? "quota" : "unavailable";
}

/** Resolve credentials freshly. Never retry with a different account or buffer audio. */
export async function elevenRequest(path: string, init: RequestInit = {}, deps: ElevenTransport = {
  env: process.env,
  direct: (url, options) => fetch(url, options),
  connector: () => new ReplitConnectors().createProxyFetch("elevenlabs"),
}): Promise<Response> {
  const url = new URL(`https://api.elevenlabs.io${path}`);
  if (!path.startsWith("/v1/") || url.origin !== "https://api.elevenlabs.io" || !url.pathname.startsWith("/v1/")) {
    throw new ElevenLabsError("configuration");
  }
  init.signal?.throwIfAborted();
  const key = deps.env.ELEVENLABS_API_KEY?.trim();
  if (!key && ![deps.env.REPL_ID, deps.env.REPL_IDENTITY, deps.env.REPLIT_DEPLOYMENT_ID,
    deps.env.REPLIT_DEPLOYMENT_ENVIRONMENT, deps.env.WEB_REPL_RENEWAL].some(Boolean)) {
    throw new ElevenLabsError("configuration");
  }
  let response: Response;
  try {
    if (key) {
      const headers = new Headers(init.headers);
      headers.set("xi-api-key", key);
      // Do not forward a credential through provider redirects.
      response = await deps.direct(url.href, { ...init, headers, redirect: "error" });
    } else {
      response = await deps.connector()(url.href, init);
    }
  } catch {
    // Fetch/SDK errors can contain credentials or URLs; never forward their message/cause.
    init.signal?.throwIfAborted();
    throw new ElevenLabsError("unavailable");
  }
  if (!response.ok) {
    // Never surface response bodies, auth headers or single-use tokens in logs.
    const code = await providerFailure(response);
    throw new ElevenLabsError(code, response.status);
  }
  return response;
}

export async function scribeToken(signal: AbortSignal): Promise<string> {
  const response = await elevenRequest("/v1/single-use-token/realtime_scribe", { method: "POST", signal });
  let data: { token?: string };
  try { data = await response.json() as { token?: string }; } catch {
    signal.throwIfAborted();
    throw new ElevenLabsError("unavailable");
  }
  if (typeof data?.token !== "string" || !data.token.trim()) throw new ElevenLabsError("authorization");
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

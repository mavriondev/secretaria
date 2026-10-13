import type { AssistantSettings } from "@workspace/api-zod";
import { streamSpeech } from "./elevenlabs";
import { selectedVoice, thinkingPhrase, type PhraseKind } from "./preferences";

type Speak = typeof streamSpeech;
const PHRASE_MAX_MS = 3500;
/** If the answer is still not ready after this long, a second, different line says the wait is on purpose. */
const SECOND_PHRASE_AT_MS = 6000;
const cache = new Map<string, Uint8Array[]>();
export const clearPhraseCache = () => cache.clear();

/**
 * The acknowledgements are a handful of fixed phrases, so their audio is kept after the first time: the next manager waiting hears it with no
 * synthesis delay and no extra cost. Only a phrase that played to its end is kept; an interrupted one is discarded.
 */
export const cachedSpeech: Speak = async (text, signal, onChunk, voice = "marin", request) => {
  const key = `${voice}|${text}`;
  const hit = cache.get(key);
  if (hit) { for (const chunk of hit) { if (signal.aborted) return; await onChunk(chunk); } return; }
  const chunks: Uint8Array[] = [];
  await streamSpeech(text, signal, async chunk => { chunks.push(chunk); await onChunk(chunk); }, voice, request);
  if (!signal.aborted) cache.set(key, chunks);
};

/**
 * A bounded, non-financial acknowledgement, concurrent with the real query. Its failure must not lose a calculated answer.
 * It starts only if the answer is not ready after `delayMs`, stops the moment the answer (or the manager) arrives, and a second line follows only on a long wait.
 */
export async function withThinkingSpeech<T>(
  settings: AssistantSettings, signal: AbortSignal,
  onChunk: (chunk: Uint8Array, signal: AbortSignal) => Promise<void>, query: () => Promise<T>,
  speak: Speak = cachedSpeech,
  delayMs = 0,
  kind: PhraseKind = "dados",
  secondAtMs = SECOND_PHRASE_AT_MS,
): Promise<T> {
  if (!settings.thinkingSpeech) return query();
  const master = new AbortController();
  const abort = () => master.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) master.abort();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const say = (phraseKind: PhraseKind) => {
    if (master.signal.aborted) return;
    // each line has its own limit so a slow synthesis never keeps playing into the real answer
    const line = new AbortController();
    const stop = () => line.abort();
    master.signal.addEventListener("abort", stop, { once: true });
    const limit = setTimeout(stop, PHRASE_MAX_MS); timers.add(limit);
    void speak(thinkingPhrase(settings, phraseKind), line.signal, chunk => onChunk(chunk, line.signal), selectedVoice(settings)).catch(() => {});
  };
  const later = (fn: () => void, ms: number) => { if (ms <= 0) return fn(); timers.add(setTimeout(fn, ms)); };
  later(() => say(kind), delayMs);
  later(() => say("demora"), Math.max(secondAtMs, delayMs + 1));
  try {
    const result = await query();
    // Stop generation immediately when useful content is ready. onChunk checks the line's signal too, so late chunks cannot enter the next stream.
    master.abort();
    signal.throwIfAborted();
    return result;
  } finally {
    timers.forEach(clearTimeout);
    master.abort();
    signal.removeEventListener("abort", abort);
  }
}

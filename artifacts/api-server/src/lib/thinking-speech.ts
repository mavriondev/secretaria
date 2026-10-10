import type { AssistantSettings } from "@workspace/api-zod";
import { streamSpeech } from "./elevenlabs";
import { selectedVoice, thinkingPhrase } from "./preferences";

/** A bounded, non-financial acknowledgement, concurrent with the real query.
 * No filler audio is stored. Its failure must not lose a calculated answer.
 */
export async function withThinkingSpeech<T>(
  settings: AssistantSettings, signal: AbortSignal,
  onChunk: (chunk: Uint8Array, signal: AbortSignal) => Promise<void>, query: () => Promise<T>,
  speak = streamSpeech,
  delayMs = 0,
): Promise<T> {
  if (!settings.thinkingSpeech) return query();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  // Never hold up a completed query indefinitely for an acknowledgement.
  const timeout = setTimeout(abort, 3500);
  const speakNow = () => {
    if (!controller.signal.aborted) void speak(thinkingPhrase(settings), controller.signal, chunk => onChunk(chunk, controller.signal), selectedVoice(settings)).catch(() => {});
  };
  const delayed = delayMs > 0 ? setTimeout(speakNow, delayMs) : undefined;
  if (!delayed) speakNow();
  try {
    const result = await query();
    // Stop generation immediately when useful content is ready. onChunk checks
    // this signal too, so late acknowledgement chunks cannot enter the next stream.
    controller.abort();
    signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timeout);
    clearTimeout(delayed);
    controller.abort();
    signal.removeEventListener("abort", abort);
  }
}

import { limparMarkdownParaFala } from "./markdown";
import { setTimeout as delay } from "node:timers/promises";

/** PCM 24kHz mono int16. Keep only ten seconds ahead of real playback.
 * This prevents a fast generator from filling the browser's 60-second queue.
 * Cancellation also cancels pacing, rather than leaking delayed old speech.
 */
export function pacedSpeechSink(
  send: (chunk: Uint8Array) => Promise<void>,
  signal: AbortSignal,
  now = () => Date.now(),
  wait = (ms: number) => delay(ms, undefined, { signal }),
) {
  let started: number | undefined;
  let sentBytes = 0;
  return async (chunk: Uint8Array) => {
    signal.throwIfAborted();
    started ??= now();
    const waitMs = (sentBytes + chunk.length) / 48 - (now() - started) - 10_000;
    if (waitMs > 0) await wait(waitMs);
    signal.throwIfAborted();
    await send(chunk);
    sentBytes += chunk.length;
  };
}

/** Extract a short spoken opening; never rephrase quantities with another LLM. */
export function conciseSpeech(text: string): string {
  const clean = limparMarkdownParaFala(text);
  if (clean.length <= 950 && clean.split(/\s+/).length <= 125) return clean;
  const segments = new Intl.Segmenter("pt-BR", { granularity: "sentence" }).segment(clean);
  let opening = "";
  for (const { segment } of segments) {
    const next = opening + segment;
    if (next.length > 820 || next.trim().split(/\s+/).length > 105) break;
    opening = next;
  }
  // Do not cut a sentence in half: qualifiers and amounts must stay together.
  return opening.trim()
    ? opening.trim() + "\nO restante da resposta está no texto."
    : "A resposta é extensa e está completa no texto.";
}

import type { AssistantResponse } from "@workspace/api-zod";
import { conciseSpeech } from "./voice-delivery";

/** The spoken form is produced by the code next to the screen text (spoken facts, shortened lists).
 * Nothing here rephrases values; conciseSpeech only bounds long research answers at sentence limits. */
export function spokenAnswer(response: AssistantResponse): string {
  const spoken = response.parameters?._spoken;
  return conciseSpeech(typeof spoken === "string" && spoken.trim() ? spoken : response.answer);
}

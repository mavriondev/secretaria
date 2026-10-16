import type { AssistantResponse } from "@workspace/api-zod";
import { conciseSpeech } from "./voice-delivery";
import { esclarecimentoSchema } from "./esclarecimento";

/** Presentation only: fixed, short and incapable of reading option names or numbers. */
export function clarificationSpeech(response: Pick<AssistantResponse, "responseKind" | "ajustes" | "parameters">): string | null {
  if (response.responseKind !== "clarification") return null;
  const parsed = esclarecimentoSchema.safeParse((response.parameters?._state as { esclarecimento?: unknown } | undefined)?.esclarecimento);
  if (!parsed.success) return null;
  const state = parsed.data;
  const field = state.perguntas.at(-1)?.campo;
  const question = field === "entidade" ? "Qual opção você quer?" : field === "periodo" ? "Qual período você quer?" : "O que você quer consultar?";
  return `${question} ${state.rodadas >= 2 ? "Escolha na tela." : "Escolha na tela ou fale."}`;
}

/** The spoken form is produced by the code next to the screen text (spoken facts, shortened lists).
 * Nothing here rephrases values; conciseSpeech only bounds long research answers at sentence limits. */
export function spokenAnswer(response: AssistantResponse): string {
  const clarification = clarificationSpeech(response);
  if (clarification) return clarification;
  const spoken = response.parameters?._spoken;
  return conciseSpeech(typeof spoken === "string" && spoken.trim() ? spoken : response.answer);
}

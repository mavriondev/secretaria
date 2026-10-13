import { db, assistantSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { currentCompanyId } from "./tenant";
import type { AssistantSettings } from "@workspace/api-zod";

export const defaultSettings: AssistantSettings = { preferredName: "", voiceGender: "female", thinkingSpeech: true };
export async function getSettings(): Promise<AssistantSettings> {
  const [row] = await db.select().from(assistantSettingsTable).where(eq(assistantSettingsTable.id, currentCompanyId()));
  return row ? { preferredName: row.preferredName, voiceGender: row.voiceGender === "male" ? "male" : "female", thinkingSpeech: row.thinkingSpeech } : { ...defaultSettings };
}
export function normalizeName(name: string): string {
  const value = name.trim().replace(/\s+/g, " ");
  if (value.length > 60 || (value && !/^[\p{L}\p{M} .'’-]+$/u.test(value))) {
    throw Object.assign(new Error("Use um nome com até sessenta letras, espaços, pontos, apóstrofos ou hífens."), { statusCode: 400 });
  }
  return value;
}
export const selectedVoice = (settings: AssistantSettings) => settings.voiceGender === "male" ? "cedar" as const : "marin" as const;
/**
 * Short spoken acknowledgements for the seconds the manager would otherwise hear silence. They carry no fact, number, news or promise about the
 * answer: a phrase said before the data is known must never be able to be wrong.
 */
export type PhraseKind = "dados" | "externo" | "demora";
const phrases: Record<PhraseKind, readonly string[]> = {
  dados: [
    "Vou conferir pra você.", "Certo, vou verificar.", "Já vejo isso pra você.", "Deixa eu confirmar.", "Um instante, vou olhar isso.",
    "Só um momento, estou consultando.", "Pode deixar, já olho.", "Estou puxando isso agora.", "Vou dar uma olhada nos dados.", "Já te respondo.",
  ],
  externo: ["Vou pesquisar isso pra você.", "Deixa eu procurar isso.", "Um instante, vou buscar essa informação.", "Já vou atrás disso."],
  demora: ["Ainda estou consultando, só mais um instante.", "Está levando um pouquinho mais, já termino.", "Quase lá, só mais um instante."],
};
export const phrasePool = (kind: PhraseKind) => phrases[kind];
const recent: Record<PhraseKind, string[]> = { dados: [], externo: [], demora: [] };
/** A phrase from the pool for this kind of wait, never one of the last two used, so a manager asking several things in a row does not hear the same line. */
export const thinkingPhrase = (_settings: AssistantSettings, kind: PhraseKind = "dados") => {
  const pool = phrases[kind]; const used = recent[kind];
  const options = pool.filter(p => !used.includes(p));
  const choice = options[Math.floor(Math.random() * options.length)]!;
  used.push(choice); if (used.length > Math.min(2, pool.length - 1)) used.shift();
  return choice;
};

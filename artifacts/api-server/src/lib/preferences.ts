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
const acknowledgements = ["Vou conferir pra você.", "Certo, vou verificar.", "Já vejo isso pra você.", "Deixa eu confirmar."];
let lastAcknowledgement = -1;
export const thinkingPhrase = (_settings: AssistantSettings) => {
  lastAcknowledgement = (lastAcknowledgement + 1 + Math.floor(Math.random() * (acknowledgements.length - 1))) % acknowledgements.length;
  return acknowledgements[lastAcknowledgement]!;
};

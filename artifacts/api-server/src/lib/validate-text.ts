import type { Fact } from "./facts";

export type Validation =
  | { ok: true; display: string; spoken: string; usedIds: string[] }
  | { ok: false; reason: string };

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ALLOWED_CAPITALS = new Set(["erp", "poc", "r$", "brasil", "ptax", "banco", "central", "csv", "sql", "ok", ...MONTHS]);
const fold = (word: string) => word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Legitimate small numbers: counts present in the facts or literally in the user's question (for example "os 3 maiores"). */
export function allowedLooseNumbers(facts: Fact[], question: string): Set<string> {
  const allowed = new Set<string>();
  for (const match of question.matchAll(/\d+(?:[.,]\d+)*/g)) allowed.add(match[0]);
  for (const fact of facts) {
    if (fact.kind === "count" && typeof fact.value === "number" && Number.isInteger(fact.value)) allowed.add(String(fact.value));
    if (fact.kind === "name") for (const match of fact.display.matchAll(/\d+/g)) allowed.add(match[0]);
  }
  return allowed;
}

/** Every number, date, period and proper name of the final text must come from the facts of the turn. */
export function validateComposition(texto: string, facts: Fact[], question: string, extraFacts: Fact[] = []): Validation {
  const all = [...facts, ...extraFacts];
  const byId = new Map(all.map(f => [f.id, f]));
  const usedIds: string[] = [];
  const unknown = [...texto.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m => m[1]!.trim()).filter(id => !byId.has(id));
  if (unknown.length) return { ok: false, reason: `marcador desconhecido: ${unknown.join(", ")}` };
  if (/\{|\}/.test(texto.replace(/\{\{\s*[^{}]+?\s*\}\}/g, ""))) return { ok: false, reason: "marcador malformado" };
  const residual = texto.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, id: string) => { usedIds.push(id.trim()); return " \u0000 "; });

  const displays = new Set(all.map(f => f.display));
  const loose = allowedLooseNumbers(all, question);
  let unmatched = residual;
  for (const match of residual.matchAll(/\d+(?:[.,]\d+)*%?/g)) {
    const token = match[0];
    if (displays.has(token) || loose.has(token)) { unmatched = unmatched.replace(token, " "); continue; }
    return { ok: false, reason: `número não autorizado: ${token}` };
  }
  if (/%|\bpor cento\b|R\$|US\$/i.test(unmatched)) return { ok: false, reason: "percentual ou valor fora dos fatos" };
  if (/\b(mil|milh[aã]o|milh[oõ]es|bilh[aã]o|bilh[oõ]es|centavos?)\b/i.test(residual)) return { ok: false, reason: "valor por extenso fora dos fatos" };
  if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(residual)) return { ok: false, reason: "data fora dos fatos" };

  const knownWords = new Set<string>();
  for (const fact of all) for (const word of `${fact.display} ${fact.spoken}`.split(/[\s,;:()]+/)) if (word) knownWords.add(fold(word));
  const sentences = residual.split(/(?<=[.!?\n])\s+|\u0000/);
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    words.forEach((raw, index) => {
      const word = raw.replace(/^[^\p{L}\p{N}R$]+|[^\p{L}\p{N}$]+$/gu, "");
      if (!word || index === 0) return;
      if (!/^\p{Lu}/u.test(word)) return;
      const folded = fold(word);
      if (ALLOWED_CAPITALS.has(folded) || knownWords.has(folded)) return;
      throw Object.assign(new Error(`nome não presente nos fatos: ${word}`), { validation: true });
    });
  }
  const render = (form: "display" | "spoken") => texto.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, id: string) => byId.get(id.trim())![form]).replace(/[ \t]+/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();
  return { ok: true, display: render("display"), spoken: render("spoken"), usedIds: [...new Set(usedIds)] };
}
export function safeValidate(texto: string, facts: Fact[], question: string, extraFacts: Fact[] = []): Validation {
  try { return validateComposition(texto, facts, question, extraFacts); }
  catch (error) {
    if (error instanceof Error && "validation" in error) return { ok: false, reason: error.message };
    throw error;
  }
}

/**
 * "Me avisa quando o faturamento de hoje passar de 200 mil": a spoken or typed alert request, understood by fixed patterns
 * (never the model). The result pre-fills the alert dialog on screen; whatever is missing, the screen asks.
 */
import type { AlertCondition } from "@workspace/db";

export type PedidoDeAviso = { assunto: string | null; condicao: AlertCondition | null; limiar: number | null; tipoLimiar: "valor" | "percentual" };

const TRIGGER = /\b(me\s+)?(avis[ae]r?|avisem|alert[ae]r?|notifi(?:ca|que|car))(?:-me|\s+me)?\b[^.?!]{0,40}?\bquando\b|\b(quero|gostaria de|preciso)\s+(ser|de ser)\s+(avisad[oa]|alertad[oa]|notificad[oa])\b[^.?!]{0,20}?\bquando\b/i;
export const alertRequested = (text: string) => TRIGGER.test(text);

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** "200 mil", "1,5 milhão", "R$ 10.000,00", "20%", "vinte por cento" (digits only; words are left to the screen). */
export function numeroFalado(text: string): { valor: number; percentual: boolean } | null {
  const m = /(?:r\$\s*)?(-?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?)\s*(mil(?:h[õo]es|h[ãa]o)?|m\b|k\b|%|por\s+cento|reais|conto)?/i.exec(text);
  if (!m) return null;
  let raw = m[1]!;
  // Brazilian writing: dots group thousands, the comma is decimal; a lone dot followed by 1-2 digits is a decimal typed the other way.
  if (/^-?\d{1,3}([.\s]\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/[.\s]/g, "").replace(",", ".");
  else raw = raw.replace(",", ".");
  let valor = Number(raw);
  if (!Number.isFinite(valor)) return null;
  const unit = strip(m[2] ?? "");
  if (/^mil$/.test(unit) || unit === "k") valor *= 1_000;
  else if (/^milh/.test(unit) || unit === "m") valor *= 1_000_000;
  return { valor, percentual: unit === "%" || unit === "por cento" };
}

const CONDITIONS: Array<{ re: RegExp; condicao: AlertCondition }> = [
  { re: /\b(variar|oscilar|subir ou cair|cair ou subir|mudar mais de|variac[aã]o (de )?mais de)\b/i, condicao: "variacao" },
  { re: /\b(passar de|passar dos|ultrapassar|acima de|maior que|mais de|superar|chegar a|chegar em|bater|atingir)\b/i, condicao: "acima" },
  { re: /\b(abaixo de|menor que|menos de|cair para|cair abaixo|ficar abaixo|baixar de|descer de)\b/i, condicao: "abaixo" },
  { re: /\b(cair|despencar|baixar|diminuir)\b/i, condicao: "abaixo" },
  { re: /\b(mudar|mudanca|mude|alterar|trocar|aparecer|entrar|chegar|houver|tiver)\b/i, condicao: "mudou" },
];

export function interpretarPedidoDeAviso(text: string): PedidoDeAviso {
  const after = text.split(/\bquando\b/i).slice(1).join("quando").trim();
  let condicao: AlertCondition | null = null;
  let cut = after.length;
  for (const c of CONDITIONS) {
    const m = c.re.exec(strip(after));
    if (m && m.index < cut) { condicao = c.condicao; cut = m.index; }
  }
  // "cair mais de 20%" is a variation, not "below": a drop by an amount, not to a level.
  const stripped = strip(after);
  if (/\b(cai\w*|sub\w*|cresc\w*|aument\w*|diminu\w*|baix\w*)\b[^,.]{0,12}\bmais de\b/.test(stripped)) condicao = "variacao";
  const numero = numeroFalado(after.slice(cut));
  const assunto = after.slice(0, cut).replace(/^\s*(o|a|os|as|meu|minha|meus|minhas|esse|essa|isso|isto)\s+/i, "").replace(/[\s,;:]+$/, "").trim() || null;
  const limiar = condicao === "mudou" ? null : numero?.valor ?? null;
  const tipoLimiar: "valor" | "percentual" = condicao === "variacao" ? (numero?.percentual === false ? "valor" : "percentual") : "valor";
  return { assunto, condicao, limiar, tipoLimiar };
}

/** Picks the favourite whose title shares the most words with the subject; null when nothing matches or two tie. */
export function favoritoDoAssunto<T extends { id: number; title: string }>(assunto: string | null, favoritos: T[]): T | null {
  if (!assunto) return null;
  const words = strip(assunto).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !["dos", "das", "com", "para", "por", "que", "esse", "essa", "isso"].includes(w));
  if (!words.length) return null;
  const scored = favoritos.map(f => { const t = strip(f.title); return { f, score: words.filter(w => t.includes(w)).length }; }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) return null;
  return scored[0]!.f;
}

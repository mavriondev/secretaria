/**
 * View adapter only. Reuses the favourite-card pipeline on ALREADY authorized results.
 * No query, model, rounding beyond the existing metric adapter, or totals are created here.
 */
import { montarResultado, previasDoResultado } from "./favoritos";
import { type CardColumn, type CardRow } from "./apresentacao-grafica";
import type { FreeQueryResult } from "./free-query";
import type { DeclaredFormat } from "./free-facts";

export function montarRespostaTabular(result: FreeQueryResult, formatos: DeclaredFormat[]) {
  if (!result.rows.length || (result.rows.length < 4 && result.columns.length === 1)) return null;
  const cap = { ...result, rows: result.rows.slice(0, 200), truncated: result.truncated || result.rows.length > 200 };
  const r = montarResultado(cap, formatos, cap.rows.length > 10 || cap.columns.length > 2 ? "tabela" : null);
  const mixedReceivables = r.columns.some(c => c.name === "dias") && r.rows.some(row => /^Atraso: /.test(row.cliente ?? ""));
  if (mixedReceivables) {
    r.columns = r.columns.map(c => c.name === "cliente" ? { ...c, label: "Cliente / faixa de atraso" } : c);
    // The shortcut contains two breakdowns of the SAME total (buckets and top clients).
    // Never present these as one comparable bar ranking or sum them together.
    r.formas = r.formas.filter(f => f !== "ranking");
  }
  // Ranking's existing renderer aggregates equal labels. A result listing may contain
  // repeated names: keep it as a table instead of inventing newly summed numbers.
  const label = r.columns.find(c => ["texto", "codigo", "booleano"].includes(c.type));
  if (label && new Set(r.rows.map(row => row[label.name])).size !== r.rows.length) {
    r.formas = r.formas.filter(f => f !== "ranking");
    if (!r.formas.includes(r.forma)) { r.forma = "tabela"; r.dados = { form: "tabela", columns: r.columns, rows: r.rows.slice(0, 10), total: r.rows.length, truncated: r.rows.length > 10 }; }
  }
  return { ...r, previas: previasDoResultado(r) };
}

/** Identity assertions used by tests/report scripts: these columns/cells never leave their source. */
export type TabularSnapshot = { columns: CardColumn[]; rows: CardRow[] };

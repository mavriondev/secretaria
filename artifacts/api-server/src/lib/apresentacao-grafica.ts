/**
 * Decides, from the shape of a query result, how a card is drawn, and reduces the data to what a card can show.
 * Deterministic and free: no model is ever asked to choose or to draw. Shared by favourites and by answers in the conversation.
 */
import type { FavoriteForm } from "@workspace/db";
import type { ColumnType } from "./ficha";

export type { FavoriteForm };
export type CardColumn = { name: string; label: string; type: ColumnType };
export type CardRow = Record<string, string | null>;

export const FORM_LABEL: Record<FavoriteForm, string> = { numero: "Número", serie: "Linha no tempo", ranking: "Barras", tabela: "Tabela" };
export const MAX_SERIES_POINTS = 120;
export const MAX_RANKING_BARS = 15;
export const MAX_TABLE_ROWS = 10;

const isNumeric = (type: ColumnType) => ["dinheiro", "percentual", "inteiro", "numero"].includes(type);
const isDate = (type: ColumnType) => type === "data" || type === "data_hora";
const isLabel = (type: ColumnType) => type === "texto" || type === "codigo" || type === "booleano";
/** Identifier-looking integer columns (cliente_id) are labels, not measures. */
const isIdName = (name: string) => /(^|_)id$/i.test(name);

/** First measure column: a numeric column that is not an identifier. */
export const measureOf = (columns: CardColumn[]): CardColumn | undefined => columns.find(c => isNumeric(c.type) && !isIdName(c.name));
const dateOf = (columns: CardColumn[]): CardColumn | undefined => columns.find(c => isDate(c.type));
const labelOf = (columns: CardColumn[]): CardColumn | undefined => columns.find(c => isLabel(c.type) || (c.type === "inteiro" && isIdName(c.name)));

/** Every form the result can take, best first. The first one is the automatic choice. */
export function formasCompativeis(columns: CardColumn[], rows: CardRow[]): FavoriteForm[] {
  const forms: FavoriteForm[] = [];
  const measure = measureOf(columns);
  if (rows.length === 1 && columns.length === 1 && columns[0] && !isLabel(columns[0].type)) forms.push("numero");
  if (rows.length === 1 && columns.length === 1 && columns[0] && isLabel(columns[0].type)) forms.push("numero");
  // A line needs one point per date: a detail listing (several rows per day, descriptive columns) is a table.
  const date = dateOf(columns);
  const oneValuePerDate = date ? new Set(rows.map(r => r[date.name])).size === rows.length : false;
  if (measure && date && rows.length >= 2 && oneValuePerDate && !labelOf(columns)) forms.push("serie");
  if (measure && labelOf(columns) && !dateOf(columns) && rows.length >= 2 && rows.length <= MAX_RANKING_BARS) forms.push("ranking");
  if (measure && labelOf(columns) && !dateOf(columns) && rows.length > MAX_RANKING_BARS) forms.push("tabela", "ranking");
  if (!forms.includes("tabela")) forms.push("tabela");
  if (measure && date && rows.length >= 2 && oneValuePerDate && labelOf(columns)) forms.push("serie");
  return forms;
}
export const escolherForma = (columns: CardColumn[], rows: CardRow[]): FavoriteForm => formasCompativeis(columns, rows)[0]!;

export type SeriesPoint = { x: string; y: number | null };
export type Bar = { label: string; value: number | null; others?: boolean };
export type CardData =
  | { form: "numero"; column: CardColumn; raw: string | null; value: number | null }
  | { form: "serie"; x: CardColumn; y: CardColumn; points: SeriesPoint[]; summarized: boolean; total: number }
  | { form: "ranking"; categoria: CardColumn; medida: CardColumn; bars: Bar[]; grouped: number }
  | { form: "tabela"; columns: CardColumn[]; rows: CardRow[]; total: number; truncated: boolean };

/** Numbers come from Postgres as text; anything that is not a finite number is shown as "—" and never breaks a scale. */
export const toNumber = (raw: string | null | undefined): number | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : null;
};

/** Uniform sampling that always keeps the first, last, maximum and minimum points. */
export function reduzirSerie(points: SeriesPoint[], max = MAX_SERIES_POINTS): { points: SeriesPoint[]; summarized: boolean } {
  if (points.length <= max) return { points, summarized: false };
  const keep = new Set<number>([0, points.length - 1]);
  let maxI = -1, minI = -1;
  points.forEach((p, i) => {
    if (p.y === null) return;
    if (maxI < 0 || p.y > points[maxI]!.y!) maxI = i;
    if (minI < 0 || p.y < points[minI]!.y!) minI = i;
  });
  if (maxI >= 0) keep.add(maxI);
  if (minI >= 0) keep.add(minI);
  const step = (points.length - 1) / (max - 1);
  for (let k = 0; k < max; k++) keep.add(Math.round(k * step));
  const indexes = [...keep].sort((a, b) => a - b).slice(0, Math.max(max, keep.size));
  return { points: indexes.map(i => points[i]!), summarized: true };
}

/** Bars beyond the limit are summed into "Outros" so a ranking never grows past the card. */
export function reduzirRanking(bars: Bar[], max = MAX_RANKING_BARS): { bars: Bar[]; grouped: number } {
  if (bars.length <= max) return { bars, grouped: 0 };
  const shown = bars.slice(0, max - 1);
  const rest = bars.slice(max - 1);
  const sum = rest.reduce<number | null>((acc, b) => (b.value === null ? acc : (acc ?? 0) + b.value), null);
  return { bars: [...shown, { label: "Outros", value: sum, others: true }], grouped: rest.length };
}

/** What the card draws, already limited. Columns must already carry their types (ficha, declared formats or Postgres oid). */
export function dadosDoCartao(form: FavoriteForm, columns: CardColumn[], rows: CardRow[]): CardData {
  const measure = measureOf(columns) ?? columns.find(c => isNumeric(c.type));
  if (form === "numero") {
    const column = measure ?? columns[0]!;
    const raw = rows[0]?.[column.name] ?? null;
    return { form, column, raw, value: isNumeric(column.type) ? toNumber(raw) : null };
  }
  if (form === "serie" && measure) {
    const x = dateOf(columns) ?? columns[0]!;
    const ordered = [...rows].sort((a, b) => String(a[x.name] ?? "").localeCompare(String(b[x.name] ?? "")));
    const reduced = reduzirSerie(ordered.map(r => ({ x: String(r[x.name] ?? ""), y: toNumber(r[measure.name]) })));
    return { form, x, y: measure, points: reduced.points, summarized: reduced.summarized, total: rows.length };
  }
  if (form === "ranking" && measure) {
    const label = labelOf(columns) ?? columns.find(c => c.name !== measure.name) ?? measure;
    const reduced = reduzirRanking(rows.map(r => ({ label: String(r[label.name] ?? "—"), value: toNumber(r[measure.name]) })));
    return { form, categoria: label, medida: measure, bars: reduced.bars, grouped: reduced.grouped };
  }
  return { form: "tabela", columns, rows: rows.slice(0, MAX_TABLE_ROWS), total: rows.length, truncated: rows.length > MAX_TABLE_ROWS };
}

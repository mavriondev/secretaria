import { brl, numberBr, numberToWordsPt, spokenDate, spokenPercent, spokenReais, type Fact } from "./facts";
import { columnDefinition, currentFicha, type ColumnType, type Ficha } from "./ficha";
import type { FreeQueryResult } from "./free-query";
import { dateBr } from "./periods";

/** Formats a model may declare for computed columns (aliases such as total_vendido). Ficha columns keep the ficha's own type. */
export const DECLARABLE_FORMATS = ["dinheiro", "percentual", "inteiro", "numero", "data", "data_hora", "texto"] as const;
export type DeclaredFormat = { coluna: string; formato: (typeof DECLARABLE_FORMATS)[number]; rotulo?: string | null };
export const FACT_ROWS = 20;
const COMPOSER_ROWS = 5;
const TEXT_LIMIT = 300;

const humanize = (name: string) => { const text = name.replace(/_/g, " ").trim(); return text.charAt(0).toUpperCase() + text.slice(1); };
export const fromOid = (oid: number): ColumnType => oid === 16 ? "booleano" : [20, 21, 23].includes(oid) ? "inteiro" : [700, 701, 1700].includes(oid) ? "numero" : oid === 1082 ? "data" : [1114, 1184].includes(oid) ? "data_hora" : "texto";

const TZ = "America/Sao_Paulo";
function saoPauloParts(iso: string): { date: string; hour: number; minute: number } | null {
  // Postgres prints offsets as +00 or -03; JavaScript needs +00:00. Values with no offset are taken as UTC.
  const text = iso.trim().replace(" ", "T");
  const value = new Date(/[zZ]$/.test(text) ? text : /[+-]\d{2}(:?\d{2})?$/.test(text) ? text.replace(/([+-]\d{2})$/, "$1:00") : `${text}Z`);
  if (!Number.isFinite(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const get = (kind: string) => parts.find(p => p.type === kind)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}
const spokenTime = (hour: number, minute: number) => `às ${numberToWordsPt(hour)} ${hour === 1 ? "hora" : "horas"}${minute ? ` e ${numberToWordsPt(minute)} ${minute === 1 ? "minuto" : "minutos"}` : ""}`;
function spokenDecimal(value: number): string {
  const abs = Math.abs(value), whole = Math.floor(abs + 1e-9), cents = Math.round((abs - whole) * 100);
  return `${value < 0 ? "menos " : ""}${numberToWordsPt(whole)}${cents ? ` vírgula ${cents < 10 ? `zero ${numberToWordsPt(cents)}` : numberToWordsPt(cents)}` : ""}`;
}

/** Display and spoken forms of one value, from its declared type. The model never produces these strings. */
export function formatValue(raw: string | null, type: ColumnType, name: string, codes?: Record<string, string>): { kind: Fact["kind"]; value: Fact["value"]; display: string; spoken: string } {
  if (raw === null) return { kind: "text", value: null, display: "sem informação", spoken: "sem informação" };
  const numeric = Number(raw);
  const plainId = type === "inteiro" && /(^|_)id$/.test(name);
  switch (plainId ? "texto" : type) {
    case "dinheiro": if (Number.isFinite(numeric)) return { kind: "money", value: numeric, display: brl(numeric), spoken: spokenReais(numeric) }; break;
    case "percentual": if (Number.isFinite(numeric)) return { kind: "percent", value: numeric, display: `${numberBr(Math.abs(numeric))}%`.replace(/^/, numeric < 0 ? "-" : ""), spoken: spokenPercent(numeric) }; break;
    case "inteiro": if (Number.isFinite(numeric) && Math.abs(numeric) < 1e12) return { kind: "count", value: numeric, display: numberBr(numeric), spoken: spokenDecimal(numeric) }; break;
    case "numero": if (Number.isFinite(numeric) && Math.abs(numeric) < 1e12) return { kind: "count", value: numeric, display: numberBr(numeric), spoken: spokenDecimal(numeric) }; break;
    case "data": if (/^\d{4}-\d{2}-\d{2}/.test(raw)) { const day = raw.slice(0, 10); return { kind: "date", value: day, display: dateBr(day), spoken: spokenDate(day) }; } break;
    case "data_hora": {
      const parts = saoPauloParts(raw);
      if (parts) return { kind: "date", value: raw, display: `${dateBr(parts.date)} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`, spoken: `${spokenDate(parts.date)} ${spokenTime(parts.hour, parts.minute)}` };
      break;
    }
    case "booleano": { const yes = ["t", "true", "1"].includes(raw.toLowerCase()); return { kind: "text", value: yes ? "sim" : "não", display: yes ? "sim" : "não", spoken: yes ? "sim" : "não" }; }
    case "codigo": { const meaning = codes?.[raw] ?? raw; return { kind: "name", value: meaning, display: meaning, spoken: meaning }; }
    default: break;
  }
  const text = raw.length > TEXT_LIMIT ? `${raw.slice(0, TEXT_LIMIT - 1)}…` : raw;
  return { kind: "name", value: text, display: text, spoken: text };
}

/** Typed, labelled columns of a result: declared formats win, then the ficha, then the Postgres type. Used by cards. */
export function typedColumns(result: Pick<FreeQueryResult, "columns" | "views">, declared: DeclaredFormat[] = [], f: Ficha = currentFicha()): Array<{ name: string; label: string; type: ColumnType }> {
  const declaredByName = new Map(declared.map(d => [d.coluna, d.formato]));
  const labelByName = new Map(declared.filter(d => d.rotulo).map(d => [d.coluna, d.rotulo!]));
  return result.columns.map(c => {
    const def = columnDefinition(c.name, result.views, f);
    return { name: c.name, label: labelByName.get(c.name) ?? def?.rotulo ?? humanize(c.name), type: (declaredByName.get(c.name) as ColumnType | undefined) ?? def?.tipo ?? fromOid(c.oid) };
  });
}

export type FreeFacts = {
  /** Everything the screen table may show. */
  facts: Fact[];
  /** What the composition may cite: summary facts and the first rows only. */
  composerFacts: Fact[];
  columns: Array<{ id: string; name: string; label: string; plain: boolean }>;
  rowCount: number;
  shownRows: number;
};
const safe = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]/g, "_");

export function freeFacts(result: FreeQueryResult, interpretation: string, declared: DeclaredFormat[] = [], f: Ficha = currentFicha()): FreeFacts {
  const facts: Fact[] = [];
  const add = (fact: Omit<Fact, "key"> & { key?: string }) => facts.push({ key: `livre:${fact.id}`, ...fact });
  const rowCount = result.rows.length;
  add({ id: "consulta.linhas", label: "Quantidade de registros encontrados", kind: "count", value: rowCount, display: numberBr(rowCount), spoken: numberToWordsPt(rowCount) });
  if (result.truncated) add({ id: "consulta.limite", label: "Aviso de limite de linhas", kind: "text", value: "limitado", display: `o resultado foi limitado às primeiras ${numberBr(rowCount)} linhas`, spoken: `o resultado foi limitado às primeiras ${numberToWordsPt(rowCount)} linhas` });
  if (interpretation) add({ id: "consulta.interpretacao", label: "Como a pergunta foi entendida (critérios usados)", kind: "text", value: interpretation, display: interpretation, spoken: interpretation });
  const updated = result.updatedAt ? formatValue(result.updatedAt, "data_hora", "atualizado_em") : null;
  if (updated) add({ id: "consulta.atualizado_em", label: "Data e hora da última atualização dos dados", kind: "date", value: updated.value, display: updated.display, spoken: updated.spoken });
  const declaredByName = new Map(declared.map(d => [d.coluna, d.formato]));
  const labelByName = new Map(declared.filter(d => d.rotulo).map(d => [d.coluna, d.rotulo!]));
  const columns = result.columns.map(c => {
    const def = columnDefinition(c.name, result.views, f);
    const type: ColumnType = (declaredByName.get(c.name) as ColumnType | undefined) ?? def?.tipo ?? fromOid(c.oid);
    return { id: safe(c.name), name: c.name, label: labelByName.get(c.name) ?? def?.rotulo ?? humanize(c.name), type, codes: def?.valores, plain: /(^|_)id$/.test(c.name) };
  });
  const shown = result.rows.slice(0, FACT_ROWS);
  shown.forEach((row, i) => {
    for (const c of columns) {
      const v = formatValue(row[c.name] ?? null, c.type, c.name, c.codes);
      add({ id: `l${i + 1}.${c.id}`, label: `${c.label} (linha ${i + 1})`, kind: v.kind, value: v.value, display: v.display, spoken: v.spoken });
    }
  });
  const summaryCount = facts.length - shown.length * columns.length;
  return {
    facts, columns: columns.map(c => ({ id: c.id, name: c.name, label: c.label, plain: c.plain })), rowCount, shownRows: shown.length,
    composerFacts: facts.slice(0, summaryCount + Math.min(COMPOSER_ROWS, shown.length) * columns.length),
  };
}

const rowFacts = (facts: Fact[], row: number, columns: FreeFacts["columns"]) => columns.map(c => ({ label: c.label, fact: facts.find(f => f.id === `l${row}.${c.id}`)! }));
/** The table of the answer, rendered by code from facts: the screen shows every shown row, the voice reads the first few. */
export function renderRows(free: FreeFacts, spokenLimit = 3): { display: string; spoken: string } {
  // Identifier columns are for joining, not for reading: they stay in the facts but leave the table when there is something else to show.
  const readable = free.columns.filter(c => !c.plain);
  const columns = readable.length ? readable : free.columns;
  const { facts } = free;
  const lines: string[] = [], voice: string[] = [];
  for (let i = 1; i <= free.shownRows; i++) {
    const cells = rowFacts(facts, i, columns);
    lines.push(columns.length === 1 ? `${i}. ${cells[0]!.fact.display}` : `${i}. ${cells.map(c => `${c.label}: ${c.fact.display}`).join(" · ")}`);
    if (i <= spokenLimit) voice.push(columns.length === 1 ? cells[0]!.fact.spoken : cells.map(c => `${c.label.toLowerCase()} ${c.fact.spoken}`).join(", "));
  }
  const more = free.rowCount > spokenLimit ? " O detalhamento completo está na tela." : "";
  const hidden = free.rowCount > free.shownRows ? `\n… e mais ${numberBr(free.rowCount - free.shownRows)} registros além dos exibidos.` : "";
  return { display: lines.join("\n") + hidden, spoken: voice.length ? `${voice.join("; ")}.${more}` : "" };
}
/** Values the composer may read: names, codes' meanings and booleans, never numbers, money or dates. */
export function composerView(free: FreeFacts): Array<{ id: string; rotulo: string; tipo: string; valor?: string }> {
  return free.composerFacts.map(f => ({ id: f.id, rotulo: f.label, tipo: f.kind, ...(f.kind === "name" || (f.kind === "text" && f.id !== "consulta.limite") ? { valor: f.display.slice(0, 160) } : {}) }));
}

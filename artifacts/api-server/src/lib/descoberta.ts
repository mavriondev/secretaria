import type pg from "pg";
import type { TipoColuna } from "./pacotes/tipos";

/** Structure of the customer's database: names, types, keys and declared relations. Never contents. */
export type ColunaOrigem = { nome: string; tipoOrigem: string; tipo: TipoColuna | null; aceitaNulo: boolean };
export type TabelaOrigem = { nome: string; linhas: number | null; colunas: ColunaOrigem[]; chave: string[] | null };
export type EstruturaOrigem = { esquema: string; tabelas: TabelaOrigem[]; ligacoes: Array<[string, string, string, string]> };

/** Mirror names must be what an unquoted PostgreSQL name folds to, because that is what the model and the query guard use. */
export const NOME_VALIDO = /^[a-z_][a-z0-9_]{0,62}$/;
/** Columns that hold credentials are never copied, whatever the table. */
export const COLUNA_SENSIVEL = /(^|_)(senha|password|passwd|pwd|token|secret|segredo|hash|salt|apikey|api_key|chave_acesso)(_|$)/i;
/** Names of columns that usually record when a row last changed. */
export const COLUNA_ALTERACAO = /(dt|data|dh)_?(alter|atualiz|modif)|(alter|atualiz|modif|updat|chang)\w*(_at|_em|_dt|_data)?$|^updated|^modified|^last_?(update|change)/i;

/** How a source column is stored in the mirror. Null means the column is not copied (binary, arrays, documents). */
export function tipoNoEspelho(dataType: string): TipoColuna | null {
  const t = dataType.toLowerCase();
  if (t === "smallint" || t === "integer") return "integer";
  if (t === "bigint") return "bigint";
  if (/^(numeric|decimal|real|double precision)$/.test(t)) return "numeric";
  if (t === "boolean") return "boolean";
  if (t === "date") return "date";
  if (t === "timestamp without time zone") return "timestamp";
  if (t === "timestamp with time zone") return "timestamptz";
  if (t === "time without time zone") return "time";
  if (/^(character varying|character|text|uuid|citext|name|json|jsonb|money|time with time zone|interval)$/.test(t)) return "text";
  return null;
}

/** Reads names, types, keys and relations of one schema. Needs only the right to see the catalog. */
export async function lerEstrutura(origem: pg.Pool, esquema = "public"): Promise<EstruturaOrigem> {
  const tabelasRes = await origem.query(
    `SELECT c.relname AS nome, CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS linhas
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') ORDER BY c.relname`, [esquema]);
  const colunasRes = await origem.query(
    `SELECT table_name AS tabela, column_name AS nome, data_type AS tipo, is_nullable = 'YES' AS nulo
       FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position`, [esquema]);
  const chavesRes = await origem.query(
    `SELECT c.relname AS tabela, i.indisprimary AS primaria, bool_and(a.attnotnull) AS sem_nulos,
            array_agg(a.attname::text ORDER BY k.ord) AS colunas
       FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(num, ord)
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.num
      WHERE n.nspname = $1 AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indisvalid
      GROUP BY c.relname, i.indexrelid, i.indisprimary`, [esquema]);
  const ligacoesRes = await origem.query(
    `SELECT ct.relname AS de, cf.relname AS para,
            array(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num ORDER BY k.ord) AS colunas_de,
            array(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.num ORDER BY k.ord) AS colunas_para
       FROM pg_constraint con JOIN pg_class ct ON ct.oid = con.conrelid JOIN pg_namespace n ON n.oid = ct.relnamespace
       JOIN pg_class cf ON cf.oid = con.confrelid JOIN pg_namespace nf ON nf.oid = cf.relnamespace
      WHERE con.contype = 'f' AND n.nspname = $1 AND nf.nspname = $1`, [esquema]);

  const colunas = new Map<string, ColunaOrigem[]>();
  for (const r of colunasRes.rows) colunas.set(r.tabela, [...(colunas.get(r.tabela) ?? []), { nome: r.nome, tipoOrigem: r.tipo, tipo: tipoNoEspelho(r.tipo), aceitaNulo: r.nulo }]);
  const chaves = new Map<string, string[]>();
  for (const r of chavesRes.rows.filter(r => r.sem_nulos).sort((a, b) => Number(b.primaria) - Number(a.primaria) || a.colunas.length - b.colunas.length)) if (!chaves.has(r.tabela)) chaves.set(r.tabela, r.colunas);
  const ligacoes: EstruturaOrigem["ligacoes"] = [];
  for (const r of ligacoesRes.rows) r.colunas_de.forEach((c: string, i: number) => ligacoes.push([r.de, c, r.para, r.colunas_para[i]]));
  return {
    esquema, ligacoes,
    tabelas: tabelasRes.rows.map(r => ({ nome: r.nome, linhas: r.linhas === null ? null : Number(r.linhas), colunas: colunas.get(r.nome) ?? [], chave: chaves.get(r.nome) ?? null })),
  };
}

/** Why a table cannot be mirrored as it is, or null when it can. */
export function motivoDeIgnorar(t: TabelaOrigem, todas: TabelaOrigem[]): string | null {
  if (!NOME_VALIDO.test(t.nome.toLowerCase())) return "nome com espaços, acentos ou símbolos";
  if (todas.filter(o => o.nome.toLowerCase() === t.nome.toLowerCase()).length > 1) return "outra tabela com o mesmo nome em maiúsculas/minúsculas diferentes";
  if (!t.chave) return "sem chave primária (ou índice único sem nulos): não dá para copiar por partes";
  const aproveitaveis = t.colunas.filter(c => c.tipo && NOME_VALIDO.test(c.nome.toLowerCase()) && !COLUNA_SENSIVEL.test(c.nome));
  if (!t.chave.every(k => aproveitaveis.some(c => c.nome === k))) return "a chave tem coluna que não pode ser copiada";
  if (t.linhas === 0) return "vazia";
  return null;
}
/** Columns that can be copied, in the source's order. */
export function colunasCopiaveis(t: TabelaOrigem): ColunaOrigem[] {
  const vistos = new Set<string>();
  return t.colunas.filter(c => {
    if (!c.tipo || !NOME_VALIDO.test(c.nome.toLowerCase()) || COLUNA_SENSIVEL.test(c.nome)) return false;
    const baixa = c.nome.toLowerCase(); if (vistos.has(baixa)) return false; vistos.add(baixa); return true;
  });
}
/** Best guess for the column that records when a row changed, among date/time columns; null when none looks like it. */
export function colunaDeAlteracao(t: TabelaOrigem): string | null {
  const candidatas = colunasCopiaveis(t).filter(c => ["date", "timestamp", "timestamptz"].includes(c.tipo!));
  return candidatas.find(c => COLUNA_ALTERACAO.test(c.nome))?.nome ?? null;
}

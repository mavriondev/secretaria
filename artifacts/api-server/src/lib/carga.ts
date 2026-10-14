import pg from "pg";
import type { Pacote, TabelaPacote, TipoColuna } from "./pacotes/tipos";

/** Where the data comes from. Only PostgreSQL is implemented; Oracle and SQL Server readers plug in behind the same interface once the customer's database is known. */
export interface Fonte {
  /** Next batch of rows ordered by key, after `depois`, optionally only rows whose incremental column is at or after `desde`. Every value comes back as text (or null). */
  lerLote(tabela: string, spec: TabelaPacote, opcoes: { desde: string | null; depois: Array<string | null> | null; limite: number }): Promise<Array<Record<string, string | null>>>;
}
export type RelatorioTabela = { tabela: string; modo: "incremental" | "completa"; lidas: number; ms: number; erro?: string };
export type RelatorioCarga = { ok: boolean; tabelas: RelatorioTabela[] };

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** Destination names are lower case (what PostgreSQL folds unquoted names to), so generated queries can use them without quoting; the source keeps the ERP's own spelling. */
export const d = (name: string) => q(name.toLowerCase());
const oneLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/postgres(ql)?:\/\/\S+/gi, "[conexão]");
const TEXT_TYPES = new Set([1082, 1083, 1114, 1184, 1700, 20]); // date, time, timestamp, timestamptz, numeric, bigint: keep exactly as the server wrote them

/** Connection pool to the customer's database: read-only by construction, values as text so dates and amounts are never rounded or shifted by time zones. */
export function abrirLeitura(url: string, max = 2): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url, max, connectionTimeoutMillis: 8000, statement_timeout: 120_000,
    types: { getTypeParser: ((oid: number, format?: "text" | "binary") => (TEXT_TYPES.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format as "text"))) as never },
  });
  pool.on("error", () => undefined);
  // Whatever the address says, every session is read-only: nothing here can ever write to the customer's database.
  pool.on("connect", client => { void client.query("SET default_transaction_read_only = on"); });
  return pool;
}
export function fontePostgres(url: string, max = 2): { fonte: Fonte; fechar: () => Promise<void>; testar: () => Promise<void> } {
  const pool = abrirLeitura(url, max);
  return { fonte: fonteDePool(pool), fechar: () => pool.end(), testar: async () => { await pool.query("SELECT 1"); } };
}
export function fonteDePool(pool: pg.Pool): Fonte {
  return {
    async lerLote(tabela, spec, { desde, depois, limite }) {
      const cols = spec.colunas.map(c => q(c.nome)).join(", ");
      const where: string[] = []; const values: unknown[] = [];
      const typeOf = (name: string) => spec.colunas.find(c => c.nome === name)!.tipo;
      if (desde && spec.incremental) { values.push(desde); where.push(`${q(spec.incremental)} >= $${values.length}::${typeOf(spec.incremental)}`); }
      if (depois) {
        const placeholders = spec.chave.map((k, i) => { values.push(depois[i]); return `$${values.length}::${typeOf(k)}`; });
        where.push(`(${spec.chave.map(q).join(", ")}) > (${placeholders.join(", ")})`);
      }
      const sql = `SELECT ${cols} FROM ${spec.esquema ? `${q(spec.esquema)}.` : ""}${q(tabela)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${spec.chave.map(q).join(", ")} LIMIT ${limite}`;
      return (await pool.query(sql, values)).rows;
    },
  };
}

/** Creates the mirror tables (and adds columns the package gained since) in the company's own database. Safe to repeat. */
export async function garantirEspelho(destino: pg.Pool, pacote: Pacote, tabelas: string[], nomes: "minusculas" | "originais" = "minusculas"): Promise<void> {
  const n = nomes === "minusculas" ? d : q;
  await destino.query("CREATE TABLE IF NOT EXISTS espelho_controle (tabela text PRIMARY KEY, carregado_em timestamptz NOT NULL)");
  for (const nome of tabelas) {
    const spec = pacote.tabelas[nome]; if (!spec) throw new Error(`Tabela fora do pacote: ${nome}`);
    const defs = spec.colunas.map(c => `${n(c.nome)} ${c.tipo}${spec.chave.includes(c.nome) ? " NOT NULL" : ""}`);
    await destino.query(`CREATE TABLE IF NOT EXISTS ${n(nome)} (${defs.join(", ")}, PRIMARY KEY (${spec.chave.map(n).join(", ")}))`);
    for (const c of spec.colunas) await destino.query(`ALTER TABLE ${n(nome)} ADD COLUMN IF NOT EXISTS ${n(c.nome)} ${c.tipo}`);
    await alargarInteiros(destino, nome, spec, nomes);
  }
}

/**
 * Columns the package now declares as bigint but that an older mirror created as integer are widened in place
 * (ERP keys such as note or title numbers outgrow 32 bits). Views over the table block the change, so they are
 * dropped and recreated from their own definition inside the same transaction; nothing is lost on failure.
 */
async function alargarInteiros(destino: pg.Pool, nome: string, spec: TabelaPacote, nomes: "minusculas" | "originais"): Promise<void> {
  const n = nomes === "minusculas" ? d : q;
  const tabela = nomes === "minusculas" ? nome.toLowerCase() : nome;
  const bigints = spec.colunas.filter(c => c.tipo === "bigint").map(c => (nomes === "minusculas" ? c.nome.toLowerCase() : c.nome));
  if (!bigints.length) return;
  const { rows: estreitas } = await destino.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND data_type = 'integer' AND column_name = ANY($2::text[])`, [tabela, bigints]);
  if (!estreitas.length) return;
  const client = await destino.connect();
  try {
    await client.query("BEGIN");
    const { rows: visoes } = await client.query<{ nome: string; definicao: string }>(
      `SELECT DISTINCT v.relname AS nome, pg_get_viewdef(v.oid, true) AS definicao
         FROM pg_depend dep JOIN pg_rewrite rw ON rw.oid = dep.objid JOIN pg_class v ON v.oid = rw.ev_class
        WHERE dep.classid = 'pg_rewrite'::regclass AND dep.refclassid = 'pg_class'::regclass AND dep.refobjid = $1::regclass AND v.relkind = 'v' AND v.oid <> dep.refobjid`, [n(nome)]);
    for (const v of visoes) await client.query(`DROP VIEW ${q(v.nome)}`);
    for (const coluna of estreitas) await client.query(`ALTER TABLE ${n(nome)} ALTER COLUMN ${q(coluna.column_name)} TYPE bigint`);
    for (const v of visoes) await client.query(`CREATE VIEW ${q(v.nome)} AS ${v.definicao}`);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

/** Writes rows (values as text or null, keyed by the table's own column names) into a mirror table, replacing rows with the same key. The caller owns the transaction. */
export async function gravarLinhas(client: Pick<pg.PoolClient, "query">, tabela: string, spec: TabelaPacote, linhas: Array<Record<string, string | null>>, destinoNome = tabela): Promise<void> {
  const cols = spec.colunas.map(c => d(c.nome));
  const naoChave = spec.colunas.filter(c => !spec.chave.includes(c.nome));
  const conflito = naoChave.length ? `DO UPDATE SET ${naoChave.map(c => `${d(c.nome)} = EXCLUDED.${d(c.nome)}`).join(", ")}` : "DO NOTHING";
  const porInsert = Math.max(1, Math.floor(60_000 / spec.colunas.length));
  for (let i = 0; i < linhas.length; i += porInsert) {
    const parte = linhas.slice(i, i + porInsert); const params: Array<string | null> = [];
    const valores = parte.map(row => `(${spec.colunas.map(c => { params.push(row[c.nome] ?? null); return `$${params.length}::${c.tipo}`; }).join(", ")})`);
    await client.query(`INSERT INTO ${d(destinoNome)} (${cols.join(", ")}) VALUES ${valores.join(", ")} ON CONFLICT (${spec.chave.map(d).join(", ")}) ${conflito}`, params);
  }
}

async function carregarTabela(fonte: Fonte, destino: pg.Pool, nome: string, spec: TabelaPacote, modoPedido: "incremental" | "completa", opcoes: { lote: number; sobreposicaoHoras: number }): Promise<RelatorioTabela> {
  const inicio = Date.now();
  let modo = modoPedido; let desde: string | null = null;
  if (modo === "incremental" && spec.incremental) {
    // Re-read a little before the newest change already held, so edits made while the previous load ran are not missed.
    const { rows } = await destino.query(`SELECT to_char(max(${d(spec.incremental)}) - make_interval(hours => $1), 'YYYY-MM-DD HH24:MI:SS') AS marca FROM ${d(nome)}`, [opcoes.sobreposicaoHoras]);
    desde = rows[0]?.marca ?? null;
  }
  if (!spec.incremental || desde === null) modo = "completa";
  const client = await destino.connect();
  let lidas = 0;
  try {
    await client.query("BEGIN");
    // A whole-table load replaces the table inside one transaction: rows deleted at the source disappear, and nobody ever sees it half empty.
    if (modo === "completa") await client.query(`DELETE FROM ${d(nome)}`);
    let depois: Array<string | null> | null = null;
    for (;;) {
      const lote = await fonte.lerLote(nome, spec, { desde: modo === "incremental" ? desde : null, depois, limite: opcoes.lote });
      if (!lote.length) break;
      await gravarLinhas(client, nome, spec, lote);
      lidas += lote.length;
      const ultima = lote[lote.length - 1]!;
      depois = spec.chave.map(k => ultima[k] ?? null);
      if (lote.length < opcoes.lote) break;
    }
    await client.query("INSERT INTO espelho_controle (tabela, carregado_em) VALUES ($1, now()) ON CONFLICT (tabela) DO UPDATE SET carregado_em = now()", [nome.toLowerCase()]);
    await client.query("COMMIT");
    return { tabela: nome, modo, lidas, ms: Date.now() - inicio };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return { tabela: nome, modo, lidas: 0, ms: Date.now() - inicio, erro: oneLine(error) };
  } finally { client.release(); }
}

/** Copies the tables of the chosen subjects from the source into the mirror. A table that fails is rolled back and reported; the others still load. */
export async function carregar(entrada: { fonte: Fonte; destino: pg.Pool; pacote: Pacote; assuntos: string[]; modo?: "incremental" | "completa"; lote?: number; sobreposicaoHoras?: number }): Promise<RelatorioCarga> {
  const { fonte, destino, pacote } = entrada;
  const desconhecidos = entrada.assuntos.filter(a => !pacote.assuntos[a]);
  if (desconhecidos.length) throw new Error(`Assunto fora do pacote: ${desconhecidos.join(", ")}`);
  const tabelas = [...new Set(entrada.assuntos.flatMap(a => pacote.assuntos[a]!))];
  await garantirEspelho(destino, pacote, tabelas);
  const resultado: RelatorioTabela[] = [];
  for (const nome of tabelas) {
    resultado.push(await carregarTabela(fonte, destino, nome, pacote.tabelas[nome]!, entrada.modo ?? "incremental", { lote: entrada.lote ?? 5000, sobreposicaoHoras: entrada.sobreposicaoHoras ?? 24 }));
  }
  return { ok: resultado.every(t => !t.erro), tabelas: resultado };
}
export type { TipoColuna };

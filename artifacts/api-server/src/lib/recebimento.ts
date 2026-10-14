import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { companiesTable, db } from "@workspace/db";
import { alargarInteiros, d, garantirEspelho, gravarLinhas } from "./carga";
import { RECEBIDA, pacoteDaEmpresa } from "./carga-empresa";
import { newCompanyPool, onClosePools } from "./company-data";
import type { Pacote, TabelaPacote } from "./pacotes/tipos";
import { aplicarRegras, regrasEfetivas } from "./regras-sankhya";
import { decryptSecret } from "./secrets";

/**
 * Data sent by the customer's side. The customer's scheduled job calls our REST endpoints with a key that can only send; we check each batch against the
 * tables and columns the company's package expects and write it into the same mirror a pulled load fills. From there nothing differs: same freshness
 * record, same health screen, same free queries.
 */
type Empresa = typeof companiesTable.$inferSelect;
export const MAX_LINHAS_POR_LOTE = 20_000;
const PREFIXO = "tato_env_";
export const hashDaChave = (token: string) => createHash("sha256").update(token).digest("hex");
export function novaChave(): { token: string; hash: string; prefixo: string } {
  const token = `${PREFIXO}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashDaChave(token), prefixo: token.slice(0, PREFIXO.length + 6) };
}

export type Falha = { status: 400 | 401 | 403 | 404 | 409 | 413 | 422; error: string };
const falha = (status: Falha["status"], error: string): Falha => ({ status, error });
const oneLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/postgres(ql)?:\/\/\S+/gi, "[conexão]");

/** The company a key belongs to, only while it is active and set to receive data. */
export async function empresaDaChave(token: string | undefined): Promise<Empresa | null> {
  if (!token || !token.startsWith(PREFIXO) || token.length > 200) return null;
  const [c] = await db.select().from(companiesTable).where(eq(companiesTable.ingestKeyHash, hashDaChave(token)));
  return c && c.active && c.sourceKind === RECEBIDA ? c : null;
}

const pools = new Map<number, { url: string; pool: pg.Pool }>();
onClosePools(async () => { const todos = [...pools.values()]; pools.clear(); await Promise.all(todos.map(p => p.pool.end().catch(() => undefined))); });
async function poolDa(c: Empresa): Promise<pg.Pool | Falha> {
  if (!c.dataUrlEnc) return falha(409, "A empresa ainda não tem banco de dados cadastrado. Fale com o responsável pela implantação.");
  const url = decryptSecret(c.dataUrlEnc); const atual = pools.get(c.id);
  if (atual?.url === url) return atual.pool;
  if (atual) await atual.pool.end().catch(() => undefined);
  const pool = newCompanyPool(url, 3); pools.set(c.id, { url, pool });
  return pool;
}

type Contrato = { pacote: Pacote; tabelas: Record<string, TabelaPacote> };
function contratoDa(c: Empresa): Contrato | Falha {
  const pacote = pacoteDaEmpresa(c);
  if (!pacote) return falha(409, `Ainda não existe pacote de tabelas para o ERP "${c.erp}".`);
  if (!c.subjects.length) return falha(409, "A empresa ainda não tem assuntos escolhidos. Fale com o responsável pela implantação.");
  const nomes = [...new Set(c.subjects.flatMap(a => pacote.assuntos[a] ?? []))];
  return { pacote, tabelas: Object.fromEntries(nomes.map(n => [n, pacote.tabelas[n]!])) };
}

/** Where a complete load is staged until its last batch swaps it in. */
const sombraDe = (nome: string) => `${nome}__nova`;
const preparadas = new Set<string>();
/** The mirror tables exist before the first batch lands (and, for Sankhya, the sales and receivable views over them). */
async function prepararEspelho(c: Empresa, pool: pg.Pool, contrato: Contrato) {
  const marca = `${c.id}:${c.dataUrlEnc}:${JSON.stringify(c.subjects)}:${c.packageJson ? "p" : "e"}`;
  if (preparadas.has(marca)) return;
  await garantirEspelho(pool, contrato.pacote, Object.keys(contrato.tabelas));
  // A complete load interrupted before the package widened its columns may resume into its staging copy: widen that too.
  for (const [nome, spec] of Object.entries(contrato.tabelas)) await alargarInteiros(pool, nome, spec, "minusculas", sombraDe(nome));
  await pool.query("CREATE TABLE IF NOT EXISTS espelho_recebimento (tabela text PRIMARY KEY, carga text NOT NULL, iniciada_em timestamptz NOT NULL)");
  if (c.erp === "sankhya" && !c.packageJson) await aplicarRegras(pool, regrasEfetivas(c.rules), c.subjects).catch(() => undefined);
  preparadas.add(marca);
}

/** What the sending job needs to know: the tables and columns expected, and how far we already are in each, so it sends only what is newer. */
export async function estadoDoRecebimento(c: Empresa): Promise<{ tabelas: Array<Record<string, unknown>> } | Falha> {
  const contrato = contratoDa(c); if ("error" in contrato) return contrato;
  const pool = await poolDa(c); if ("error" in pool) return pool;
  try {
    await prepararEspelho(c, pool, contrato);
    const controle = new Map((await pool.query("SELECT tabela, carregado_em FROM espelho_controle")).rows.map(r => [String(r.tabela), r.carregado_em as Date]));
    const tabelas: Array<Record<string, unknown>> = [];
    for (const [nome, spec] of Object.entries(contrato.tabelas)) {
      const marca = spec.incremental ? `to_char(max(${d(spec.incremental)}), 'YYYY-MM-DD"T"HH24:MI:SS')` : "NULL";
      const { rows } = await pool.query(`SELECT count(*)::bigint AS linhas, ${marca} AS marca FROM ${d(nome)}`);
      tabelas.push({
        tabela: nome, chave: spec.chave, colunaDeAlteracao: spec.incremental, colunas: spec.colunas.map(col => ({ nome: col.nome, tipo: col.tipo })),
        linhas: Number(rows[0].linhas), ultimaMarca: rows[0].marca ?? null, recebidoEm: controle.get(nome.toLowerCase())?.toISOString() ?? null,
      });
    }
    return { tabelas };
  } catch (error) { return falha(409, `Não foi possível ler o banco da empresa: ${oneLine(error)}`); }
}

export type Lote = { modo: "incremental" | "completa"; carga?: string; ultimo?: boolean; linhas: Array<Record<string, unknown>> };
const texto = (v: unknown): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === "boolean") return v ? "true" : "false";
  return undefined;
};

/** Checks a batch against the table's columns. Text keeps empty strings; every other type reads an empty string as "no value". */
function conferir(spec: TabelaPacote, linhas: Lote["linhas"]): { linhas: Array<Record<string, string | null>>; ignoradas: string[] } | Falha {
  const porNome = new Map(spec.colunas.map(c => [c.nome.toLowerCase(), c]));
  const ignoradas = new Set<string>(); const unicas = new Map<string, Record<string, string | null>>();
  for (let i = 0; i < linhas.length; i++) {
    const origem = linhas[i]; const saida: Record<string, string | null> = {};
    if (!origem || typeof origem !== "object" || Array.isArray(origem)) return falha(422, `A linha ${i + 1} não é um objeto com colunas e valores.`);
    for (const [k, v] of Object.entries(origem)) {
      const col = porNome.get(k.toLowerCase());
      if (!col) { ignoradas.add(k); continue; }
      const t = texto(v);
      if (t === undefined) return falha(422, `A linha ${i + 1} traz um valor que não é texto, número, verdadeiro/falso ou nulo na coluna ${col.nome}.`);
      saida[col.nome] = t === "" && col.tipo !== "text" ? null : t;
    }
    for (const c of spec.colunas) if (!(c.nome in saida)) saida[c.nome] = null;
    const faltando = spec.chave.find(k => saida[k] === null);
    if (faltando) return falha(422, `A linha ${i + 1} não tem valor na coluna ${faltando}, que identifica a linha.`);
    unicas.set(JSON.stringify(spec.chave.map(k => saida[k])), saida); // the last one of a repeated key wins
  }
  return { linhas: [...unicas.values()], ignoradas: [...ignoradas].slice(0, 20) };
}

/** Writes one batch. An incremental batch replaces rows with the same key. A complete load is staged beside the table and swapped in by its last batch, so rows deleted at the source disappear and nobody sees it half empty. */
export async function receberLote(c: Empresa, tabelaPedida: string, lote: Lote): Promise<{ resultado: Record<string, unknown> } | Falha> {
  if (lote.linhas.length > MAX_LINHAS_POR_LOTE) return falha(413, `Envie no máximo ${MAX_LINHAS_POR_LOTE.toLocaleString("pt-BR")} linhas por vez.`);
  const contrato = contratoDa(c); if ("error" in contrato) return contrato;
  const nome = Object.keys(contrato.tabelas).find(n => n.toLowerCase() === tabelaPedida.toLowerCase());
  if (!nome) return falha(404, `A tabela "${tabelaPedida}" não faz parte do que esta empresa recebe.`);
  const spec = contrato.tabelas[nome]!;
  if (lote.modo === "completa" && !/^[A-Za-z0-9_-]{4,64}$/.test(lote.carga ?? "")) return falha(400, 'Em carga completa, informe "carga": um identificador de 4 a 64 letras, números, "-" ou "_", igual em todos os lotes da mesma carga.');
  const conferido = conferir(spec, lote.linhas); if ("error" in conferido) return conferido;
  const pool = await poolDa(c); if ("error" in pool) return pool;
  const sombra = sombraDe(nome);
  const client = await pool.connect();
  try {
    await prepararEspelho(c, pool, contrato);
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recebimento:${nome}`]);
    let destino = nome;
    if (lote.modo === "completa") {
      const atual = (await client.query("SELECT carga FROM espelho_recebimento WHERE tabela = $1", [nome.toLowerCase()])).rows[0]?.carga as string | undefined;
      if (atual !== lote.carga) {
        // a new complete load starts: whatever an interrupted one left behind is thrown away
        await client.query(`DROP TABLE IF EXISTS ${d(sombra)}`);
        await client.query(`CREATE TABLE ${d(sombra)} (LIKE ${d(nome)} INCLUDING ALL)`);
        await client.query("INSERT INTO espelho_recebimento (tabela, carga, iniciada_em) VALUES ($1, $2, now()) ON CONFLICT (tabela) DO UPDATE SET carga = EXCLUDED.carga, iniciada_em = now()", [nome.toLowerCase(), lote.carga]);
      }
      destino = sombra;
    }
    await gravarLinhas(client, nome, spec, conferido.linhas, destino);
    let efetivada = lote.modo === "incremental";
    if (lote.modo === "completa" && lote.ultimo) {
      await client.query(`DELETE FROM ${d(nome)}`);
      await client.query(`INSERT INTO ${d(nome)} SELECT * FROM ${d(sombra)}`);
      await client.query(`DROP TABLE ${d(sombra)}`);
      await client.query("DELETE FROM espelho_recebimento WHERE tabela = $1", [nome.toLowerCase()]);
      efetivada = true;
    }
    // Freshness is the moment of the last accepted batch of a finished kind of load; an empty incremental batch is how the job says "nothing changed".
    if (efetivada) await client.query("INSERT INTO espelho_controle (tabela, carregado_em) VALUES ($1, now()) ON CONFLICT (tabela) DO UPDATE SET carregado_em = now()", [nome.toLowerCase()]);
    await client.query("COMMIT");
    return { resultado: { ok: true, tabela: nome, modo: lote.modo, recebidas: lote.linhas.length, gravadas: conferido.linhas.length, concluida: efetivada, ...(conferido.ignoradas.length ? { colunasIgnoradas: conferido.ignoradas } : {}) } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return falha(422, `O lote não foi gravado: ${oneLine(error)}`);
  } finally { client.release(); }
}

/** For the owner's screen: when each table last received data. */
export async function resumoDoRecebimento(c: Empresa): Promise<Array<{ tabela: string; recebidoEm: string | null }> | null> {
  if (!c.dataUrlEnc) return null;
  const pool = await poolDa(c); if ("error" in pool) return null;
  const { rows } = await pool.query("SELECT tabela, carregado_em FROM espelho_controle ORDER BY tabela").catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  return rows.map(r => ({ tabela: String(r.tabela), recebidoEm: r.carregado_em ? (r.carregado_em as Date).toISOString() : null }));
}

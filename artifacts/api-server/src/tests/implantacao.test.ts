import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { companiesTable, db, loadRunsTable, pool, usersTable } from "@workspace/db";
import app from "../app";
import { type Modelo } from "../lib/agente-implantacao";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { abrirLeitura } from "../lib/carga";
import { lerEstrutura, tipoNoEspelho } from "../lib/descoberta";
import { usarModeloDeImplantacao } from "../lib/implantacao";
import { encryptSecret } from "../lib/secrets";

// The implantation agent: it reads only the structure, proposes tables, and nothing is copied until a person approves.
const BASE = process.env.SECOND_DATABASE_URL;
const tag = Math.random().toString(36).slice(2, 8);
const SRC = `isrc_${tag}`, TGT = `itgt_${tag}`;
process.env.COMPANY_DATA_KEY ||= "chave-de-teste-com-mais-de-16-caracteres";
const urlDoEspelho = (() => { const u = new URL(process.env.DATABASE_URL!); u.pathname = `/${TGT}`; return u.toString(); })();
const withSchema = (schema: string) => `${BASE}${BASE!.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
const cookies: Record<string, string> = {}; const emails: string[] = [];
let admin: pg.Pool, src: pg.Pool, companyId = 0; const vistoPeloModelo: string[] = [];
const call = async (method: "GET" | "PUT" | "POST", url: string, as: string, body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "dono" | "administrador", company: number | null) {
  const email = `${key}.im.${tag}@teste.local`.toLowerCase(); emails.push(email);
  await db.insert(usersTable).values({ companyId: company, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
const waitLoad = async () => { for (let i = 0; i < 200; i++) { const [r] = await db.select().from(loadRunsTable).where(eq(loadRunsTable.companyId, companyId)).orderBy(loadRunsTable.id).limit(100).then(x => x.slice(-1)); if (r && r.status !== "executando") return r; await new Promise(r => setTimeout(r, 50)); } throw new Error("load did not finish"); };
const waitProposal = async () => { for (let i = 0; i < 200; i++) { const r = await call("GET", `/api/plataforma/empresas/${companyId}/implantacao`, "dono"); if (r.body.estado && r.body.estado.status !== "analisando") return r.body; await new Promise(r => setTimeout(r, 50)); } throw new Error("analysis did not finish"); };

/** A model that answers the way a careful one would, and records everything it was shown. */
const modeloScriptado: Modelo = async ({ nome, entrada }) => {
  vistoPeloModelo.push(JSON.stringify(entrada));
  const tabelas = (entrada as { tabelas: Array<{ nome: string }> }).tabelas;
  if (nome === "triagem_tabelas") return { usd: 0.01, json: { tabelas: tabelas.map(t => ({ nome: t.nome, incluir: !/^log_/.test(t.nome), descricao: `Linha de ${t.nome}`, motivo: /^log_/.test(t.nome) ? "Registro técnico de acessos." : "Dado de negócio." })) } };
  return { usd: 0.02, json: { tabelas: tabelas.map(t => t.nome === "pedidos"
    ? { nome: "pedidos", incremental: "dt_alteracao", omitir: ["situacao"], colunas: [{ nome: "id", descricao: "Número do pedido" }, { nome: "valor", descricao: "Valor do pedido" }] }
    : { nome: t.nome, incremental: "coluna_que_nao_existe", omitir: ["senha_inventada"], colunas: [{ nome: "nome", descricao: "Nome do cliente" }] }) } };
};

before(async () => {
  await ensureDemoCompany(); await app.ready();
  if (!BASE) return;
  admin = new pg.Pool({ connectionString: BASE, max: 1 });
  await admin.query(`CREATE SCHEMA ${SRC}`);
  await pool.query(`CREATE DATABASE ${TGT}`); // a database of its own: the real thing reads the public schema of the company's database
  src = new pg.Pool({ connectionString: withSchema(SRC), max: 1 });
  await src.query(`CREATE TABLE clientes (id integer PRIMARY KEY, nome text, email text, senha text, criado_em date, dt_alteracao timestamp)`);
  await src.query(`CREATE TABLE pedidos (id bigint PRIMARY KEY, cliente_id integer REFERENCES clientes(id), valor numeric(12,2), situacao text, dt_alteracao timestamp, anexo bytea)`);
  await src.query(`CREATE TABLE log_acesso (id integer PRIMARY KEY, quando timestamp)`);
  await src.query(`CREATE TABLE sem_chave (a integer, b text)`);
  await src.query(`CREATE TABLE "Tabela Estranha" (id integer PRIMARY KEY)`);
  await src.query(`CREATE TABLE vazia (id integer PRIMARY KEY)`);
  await src.query(`INSERT INTO clientes VALUES (1, 'Cliente Secreto', 'segredo@x.com', 'hash-da-senha', '2026-01-01', '2026-01-02 10:00'), (2, 'Outro', 'o@x.com', 'hash2', '2026-02-01', '2026-02-02 10:00')`);
  await src.query(`INSERT INTO pedidos VALUES (10, 1, 150.50, 'A', '2026-09-01 08:00', '\\x00'), (11, 2, 20, 'B', '2026-09-02 08:00', NULL)`);
  await src.query(`INSERT INTO log_acesso VALUES (1, now())`); await src.query(`INSERT INTO sem_chave VALUES (1, 'x')`);
  await src.query(`ANALYZE`);
  const [c] = await db.insert(companiesTable).values({ name: `Implantação ${tag}`, erp: "outro", dataReady: false, dataUrlEnc: encryptSecret(urlDoEspelho) }).returning();
  companyId = c!.id;
  await seed("dono", "dono", null); await seed("adminX", "administrador", companyId);
  usarModeloDeImplantacao(() => modeloScriptado);
});
after(async () => {
  usarModeloDeImplantacao(null);
  if (BASE) {
    await db.delete(loadRunsTable).where(eq(loadRunsTable.companyId, companyId));
    await db.delete(usersTable).where(inArray(usersTable.email, emails));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await src.end(); await admin.query(`DROP SCHEMA ${SRC} CASCADE`); await pool.query(`DROP DATABASE IF EXISTS ${TGT} WITH (FORCE)`);
    await admin.end();
  }
  await app.close(); await pool.end();
});

test("column types map to the mirror, and what cannot be mirrored is left out", () => {
  assert.equal(tipoNoEspelho("integer"), "integer"); assert.equal(tipoNoEspelho("bigint"), "bigint");
  assert.equal(tipoNoEspelho("numeric"), "numeric"); assert.equal(tipoNoEspelho("timestamp with time zone"), "timestamptz");
  assert.equal(tipoNoEspelho("character varying"), "text"); assert.equal(tipoNoEspelho("bytea"), null); assert.equal(tipoNoEspelho("ARRAY"), null);
});

test("the structure reader finds keys and declared relations, and never reads contents", { skip: !BASE }, async () => {
  const origem = abrirLeitura(withSchema(SRC), 1);
  try {
    const e = await lerEstrutura(origem, SRC);
    assert.deepEqual(e.tabelas.find(t => t.nome === "clientes")!.chave, ["id"]);
    assert.equal(e.tabelas.find(t => t.nome === "sem_chave")!.chave, null);
    assert.deepEqual(e.ligacoes, [["pedidos", "cliente_id", "clientes", "id"]]);
    assert.equal(e.tabelas.find(t => t.nome === "pedidos")!.colunas.find(c => c.nome === "anexo")!.tipo, null);
  } finally { await origem.end(); }
});

test("only the owner reaches the agent, and it needs a source first", { skip: !BASE }, async () => {
  assert.equal((await call("POST", `/api/plataforma/empresas/${companyId}/implantacao/analisar`, "adminX", {})).status, 403);
  assert.equal((await call("POST", `/api/plataforma/empresas/${companyId}/implantacao/analisar`, "dono", {})).status, 409, "no source address yet");
  const ok = await call("PUT", `/api/plataforma/empresas/${companyId}/origem`, "dono", { url: withSchema(SRC) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test("the agent proposes tables from the structure alone, leaves credentials and unusable tables out, and checks what the model says", { skip: !BASE }, async () => {
  const started = await call("POST", `/api/plataforma/empresas/${companyId}/implantacao/analisar`, "dono", { esquema: SRC, contexto: "Loja de varejo" });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const { estado } = await waitProposal();
  assert.equal(estado.status, "pronta", JSON.stringify(estado));
  const por = Object.fromEntries(estado.tabelas.map((t: { nome: string }) => [t.nome, t]));
  assert.deepEqual(Object.keys(por).sort(), ["clientes", "log_acesso", "pedidos"]);
  assert.equal(por.log_acesso.incluir, false); assert.match(por.log_acesso.motivo, /acessos/);
  assert.equal(por.clientes.incluir, true); assert.equal(por.pedidos.incluir, true);
  const motivos = Object.fromEntries(estado.ignoradas.map((i: { nome: string; motivo: string }) => [i.nome, i.motivo]));
  assert.match(motivos.sem_chave, /chave/); assert.match(motivos["Tabela Estranha"], /nome/); assert.match(motivos.vazia, /vazia/);
  assert.equal(por.clientes.incremental, "dt_alteracao", "a column the model invented is replaced by the one that looks like a change date");
  assert.equal(por.pedidos.incremental, "dt_alteracao"); assert.equal(por.pedidos.omitidas, 1);
  assert.ok(Math.abs(estado.custoUsd - 0.03) < 1e-9, "the cost of the analysis (one triage call, one detail call) is recorded");
  // the model saw names and counts, never a value
  const tudo = vistoPeloModelo.join(" ");
  for (const valor of ["Cliente Secreto", "segredo@x.com", "hash-da-senha"]) assert.ok(!tudo.includes(valor), `the model must not see data: ${valor}`);
  const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  const proposta = c!.proposalJson as { tabelas: Array<{ nome: string; colunas: Array<{ nome: string }> }> };
  assert.ok(!proposta.tabelas.find(t => t.nome === "clientes")!.colunas.some(col => col.nome === "senha"), "credential columns are never offered");
  assert.ok(!proposta.tabelas.find(t => t.nome === "pedidos")!.colunas.some(col => col.nome === "anexo"), "binary columns are not copied");
});

test("the owner adjusts the choice, approves, and the load copies exactly that", { skip: !BASE }, async () => {
  assert.equal((await call("PUT", `/api/plataforma/empresas/${companyId}/implantacao/tabelas`, "dono", { incluir: ["pedidos", "inventada"] })).status, 409, "only tables of the proposal");
  assert.equal((await call("POST", `/api/plataforma/empresas/${companyId}/implantacao/aprovar`, "adminX", {})).status, 403);
  assert.equal((await call("PUT", `/api/plataforma/empresas/${companyId}/implantacao/tabelas`, "dono", { incluir: ["pedidos", "clientes"] })).status, 200);
  const approved = await call("POST", `/api/plataforma/empresas/${companyId}/implantacao/aprovar`, "dono", {});
  assert.equal(approved.status, 200, JSON.stringify(approved.body)); assert.equal(approved.body.tabelas, 2);
  const origem = await call("GET", `/api/plataforma/empresas/${companyId}/origem`, "dono");
  assert.deepEqual(origem.body.assuntos, ["geral"]); assert.deepEqual(origem.body.assuntosDisponiveis.geral.sort(), ["clientes", "pedidos"]);
  const load = await call("POST", `/api/plataforma/empresas/${companyId}/carga`, "dono", { modo: "completa" });
  assert.equal(load.status, 202, JSON.stringify(load.body));
  const run = await waitLoad(); assert.equal(run.ok, true, JSON.stringify(run));
  const tgt = new pg.Pool({ connectionString: urlDoEspelho, max: 1 });
  try {
    assert.equal((await tgt.query("SELECT count(*)::int AS n FROM pedidos")).rows[0].n, 2);
    assert.equal((await tgt.query("SELECT valor::text AS v FROM pedidos WHERE id = 10")).rows[0].v, "150.50");
    const colunas = (await tgt.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clientes'`)).rows.map(r => r.column_name);
    assert.ok(!colunas.includes("senha") && colunas.includes("nome"), JSON.stringify(colunas));
    // a changed row arrives with the incremental load, found through the change column the agent chose
    await src.query(`UPDATE pedidos SET valor = 999, dt_alteracao = '2026-09-05 08:00' WHERE id = 11`);
    assert.equal((await call("POST", `/api/plataforma/empresas/${companyId}/carga`, "dono", { modo: "incremental" })).status, 202);
    await new Promise(r => setTimeout(r, 100)); const inc = await waitLoad(); assert.equal(inc.ok, true, JSON.stringify(inc));
    assert.equal((await tgt.query("SELECT valor::text AS v FROM pedidos WHERE id = 11")).rows[0].v, "999.00");
    assert.equal((inc.report as { tabelas: Array<{ tabela: string; modo: string }> }).tabelas.find(t => t.tabela === "pedidos")!.modo, "incremental");
  } finally { await tgt.end(); }
});

test("the company is released from what was copied, with the agent's descriptions and the declared relations in its ficha", { skip: !BASE }, async () => {
  const released = await call("POST", `/api/plataforma/empresas/${companyId}/liberar-do-espelho`, "dono", {});
  assert.equal(released.status, 200, JSON.stringify(released.body)); assert.equal(released.body.ok, true, JSON.stringify(released.body));
  const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  const ficha = c!.fichaJson as { orientacoes?: string; visoes: Array<{ nome: string; descricao: string; colunas: Array<{ nome: string; descricao: string }> }> };
  assert.deepEqual(ficha.visoes.map(v => v.nome).sort(), ["clientes", "pedidos"]);
  assert.equal(ficha.visoes.find(v => v.nome === "pedidos")!.colunas.find(col => col.nome === "valor")!.descricao, "Valor do pedido");
  assert.match(ficha.orientacoes!, /pedidos\.cliente_id = clientes\.id/);
});

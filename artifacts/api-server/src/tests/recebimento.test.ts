import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { companiesTable, db, pool, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { closeCompanyPools } from "../lib/company-data";
import { encryptSecret } from "../lib/secrets";

// Data sent by the customer's side: a key that can only send, a contract to follow, batches checked against it, complete loads swapped in whole.
const tag = Math.random().toString(36).slice(2, 8);
const TGT = `rcb_${tag}`;
process.env.COMPANY_DATA_KEY ||= "chave-de-teste-com-mais-de-16-caracteres";
const urlDoEspelho = (() => { const u = new URL(process.env.DATABASE_URL!); u.pathname = `/${TGT}`; return u.toString(); })();
const cookies: Record<string, string> = {}; const emails: string[] = [];
let companyId = 0, otherId = 0, token = "", tgt: pg.Pool;
async function seed(key: string, role: "dono" | "administrador", company: number | null) {
  const email = `${key}.rc.${tag}@teste.local`.toLowerCase(); emails.push(email);
  await db.insert(usersTable).values({ companyId: company, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
const owner = async (method: "GET" | "POST", url: string, as = "dono", body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const send = async (method: "GET" | "POST", url: string, body?: unknown, bearer: string | null = token) => {
  const res = await app.inject({ method, url: `/api/ingestao${url}`, payload: body as object | undefined, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const nota = (n: number, extra: Record<string, unknown> = {}) => ({ NUNOTA: n, NUMNOTA: n, CODPARC: 1, TIPMOV: "V", STATUSNOTA: "L", DTNEG: "2026-10-01", DTALTER: "2026-10-01T10:00:00", VLRNOTA: 100.5, CODTIPOPER: 1100, ...extra });

before(async () => {
  await ensureDemoCompany(); await app.ready();
  await pool.query(`CREATE DATABASE ${TGT}`);
  tgt = new pg.Pool({ connectionString: urlDoEspelho, max: 2 });
  const [c] = await db.insert(companiesTable).values({ name: `Recebe ${tag}`, erp: "sankhya", dataReady: false, dataUrlEnc: encryptSecret(urlDoEspelho), subjects: ["vendas"] }).returning(); companyId = c!.id;
  const [o] = await db.insert(companiesTable).values({ name: `Outra ${tag}`, erp: "sankhya", dataReady: false }).returning(); otherId = o!.id;
  await seed("dono", "dono", null); await seed("adminX", "administrador", companyId);
});
after(async () => {
  await closeCompanyPools(); await tgt.end();
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId, otherId]));
  await pool.query(`DROP DATABASE IF EXISTS ${TGT} WITH (FORCE)`);
  await app.close(); await pool.end();
});

test("only the owner issues the key, it is shown once, and without it nothing is accepted", async () => {
  assert.equal((await owner("POST", `/api/plataforma/empresas/${companyId}/ingestao/chave`, "adminX", {})).status, 403);
  assert.equal((await send("GET", "/estado", undefined, null)).status, 401);
  assert.equal((await send("GET", "/estado", undefined, "tato_env_chute")).status, 401);
  const issued = await owner("POST", `/api/plataforma/empresas/${companyId}/ingestao/chave`, "dono", { intervaloMin: 60 });
  assert.equal(issued.status, 200); token = issued.body.chave; assert.match(token, /^tato_env_/);
  const view = await owner("GET", `/api/plataforma/empresas/${companyId}/ingestao`);
  assert.equal(view.body.ativa, true); assert.ok(!JSON.stringify(view.body).includes(token), "the key is never shown again");
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  assert.equal(row!.sourceKind, "recebida"); assert.equal(row!.loadEveryMin, 60); assert.ok(!JSON.stringify(row).includes(token), "only a hash is stored");
  // a user's session does not open the sending door either way
  const session = await app.inject({ method: "GET", url: "/api/ingestao/estado", headers: { cookie: cookies.adminX! } });
  assert.equal(session.statusCode, 401);
  // a key of a company that is not set to receive data does nothing
  assert.equal((await send("GET", "/estado", undefined, "tato_env_" + "x".repeat(43))).status, 401);
});

test("the contract lists tables, columns and how far we are, and prepares the mirror and the views", async () => {
  const r = await send("GET", "/estado");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cab = r.body.tabelas.find((t: { tabela: string }) => t.tabela === "TGFCAB");
  assert.deepEqual(cab.chave, ["NUNOTA"]); assert.equal(cab.colunaDeAlteracao, "DTALTER");
  assert.ok(cab.colunas.some((c: { nome: string }) => c.nome === "VLRNOTA")); assert.equal(cab.linhas, 0); assert.equal(cab.ultimaMarca, null);
  assert.ok(!r.body.tabelas.some((t: { tabela: string }) => t.tabela === "TGFFIN"), "only the chosen subjects");
  assert.equal((await tgt.query("SELECT to_regclass('vw_vendas_itens') AS v")).rows[0].v, "vw_vendas_itens");
});

test("a batch is checked against the contract and written; repeating it changes nothing, changing a row updates it", async () => {
  assert.equal((await send("POST", "/tabelas/TGFINEXISTENTE", { linhas: [] })).status, 404);
  assert.equal((await send("POST", "/tabelas/tgfcab", { modo: "talvez", linhas: [] })).status, 400);
  assert.equal((await send("POST", "/tabelas/tgfcab", { linhas: [{ ...nota(1), NUNOTA: null }] })).status, 422, "a row without its key");
  assert.equal((await send("POST", "/tabelas/tgfcab", { linhas: [{ ...nota(1), VLRNOTA: { x: 1 } }] })).status, 422, "a value that is not a plain value");
  assert.equal((await send("POST", "/tabelas/tgfcab", { linhas: [{ ...nota(1), VLRNOTA: "não é número" }] })).status, 422, "a value the column cannot hold");
  assert.equal((await tgt.query("SELECT count(*)::int AS n FROM tgfcab")).rows[0].n, 0, "a refused batch writes nothing");
  assert.equal((await send("POST", "/tabelas/tgfcab", { linhas: Array.from({ length: 20_001 }, (_, i) => ({ NUNOTA: i })) })).status, 413);

  const ok = await send("POST", "/tabelas/tgfcab", { linhas: [nota(1), nota(2, { DTALTER: "2026-10-02T09:30:00", VLRNOTA: "" }), nota(2, { DTALTER: "2026-10-02T09:30:00", VLRNOTA: 77 }), { ...nota(3), COLUNA_QUE_NAO_EXISTE: "x" }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.recebidas, 4); assert.equal(ok.body.gravadas, 3, "a repeated key inside a batch keeps the last one"); assert.deepEqual(ok.body.colunasIgnoradas, ["COLUNA_QUE_NAO_EXISTE"]);
  assert.equal((await tgt.query("SELECT vlrnota::text AS v FROM tgfcab WHERE nunota = 2")).rows[0].v, "77.0000");
  const again = await send("POST", "/tabelas/TGFCAB", { linhas: [nota(1)] });
  assert.equal(again.status, 200); assert.equal((await tgt.query("SELECT count(*)::int AS n FROM tgfcab")).rows[0].n, 3);
  await send("POST", "/tabelas/tgfcab", { linhas: [nota(1, { VLRNOTA: 999, DTALTER: "2026-10-03T08:00:00" })] });
  assert.equal((await tgt.query("SELECT vlrnota::text AS v FROM tgfcab WHERE nunota = 1")).rows[0].v, "999.0000");
  const state = await send("GET", "/estado");
  const cab = state.body.tabelas.find((t: { tabela: string }) => t.tabela === "TGFCAB");
  assert.equal(cab.linhas, 3); assert.equal(cab.ultimaMarca, "2026-10-03T08:00:00"); assert.ok(cab.recebidoEm, "the arrival is recorded");
  assert.ok(Date.now() - new Date(cab.recebidoEm).getTime() < 60_000);
});

test("an empty incremental batch says 'nothing changed' and renews the freshness", async () => {
  await tgt.query("UPDATE espelho_controle SET carregado_em = now() - interval '5 hours' WHERE tabela = 'tgfcab'");
  assert.equal((await send("POST", "/tabelas/tgfcab", { linhas: [] })).status, 200);
  const { rows } = await tgt.query("SELECT extract(epoch FROM now() - carregado_em) AS s FROM espelho_controle WHERE tabela = 'tgfcab'");
  assert.ok(Number(rows[0].s) < 60);
});

test("a complete load is staged and swapped in by its last batch, so deleted rows disappear and nothing is seen half done", async () => {
  const ids = async () => (await tgt.query("SELECT nunota::int AS n FROM tgfcab ORDER BY 1")).rows.map(r => r.n);
  assert.deepEqual(await ids(), [1, 2, 3]);
  assert.equal((await send("POST", "/tabelas/tgfcab", { modo: "completa", linhas: [nota(10)] })).status, 400, "a complete load needs its identifier");
  const first = await send("POST", "/tabelas/tgfcab", { modo: "completa", carga: "carga-0001", linhas: [nota(2), nota(4)] });
  assert.equal(first.status, 200); assert.equal(first.body.concluida, false);
  assert.deepEqual(await ids(), [1, 2, 3], "the table still shows the previous state");
  const last = await send("POST", "/tabelas/tgfcab", { modo: "completa", carga: "carga-0001", ultimo: true, linhas: [nota(5)] });
  assert.equal(last.body.concluida, true);
  assert.deepEqual(await ids(), [2, 4, 5], "rows 1 and 3 were deleted at the source");
  assert.equal((await tgt.query("SELECT to_regclass('tgfcab__nova') AS t")).rows[0].t, null, "the staging table is gone");
  // an interrupted load is thrown away when another one starts
  await send("POST", "/tabelas/tgfcab", { modo: "completa", carga: "carga-0002", linhas: [nota(90)] });
  await send("POST", "/tabelas/tgfcab", { modo: "completa", carga: "carga-0003", ultimo: true, linhas: [nota(7)] });
  assert.deepEqual(await ids(), [7]);
});

test("the owner revokes the key and it stops working at once; a new key replaces the old one", async () => {
  assert.equal((await send("GET", "/estado")).status, 200);
  assert.equal((await owner("POST", `/api/plataforma/empresas/${companyId}/ingestao/revogar`)).status, 200);
  assert.equal((await send("GET", "/estado")).status, 401);
  const first = (await owner("POST", `/api/plataforma/empresas/${companyId}/ingestao/chave`)).body.chave;
  const second = (await owner("POST", `/api/plataforma/empresas/${companyId}/ingestao/chave`)).body.chave;
  assert.equal((await send("GET", "/estado", undefined, first)).status, 401); assert.equal((await send("GET", "/estado", undefined, second)).status, 200);
});

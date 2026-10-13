import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { companiesTable, db, pool, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { garantirEspelho } from "../lib/carga";
import { PACOTE_SANKHYA } from "../lib/pacotes/sankhya";
import { aplicarRegras, diagnosticoVendas, procurarRegras, REGRAS_PADRAO, regrasEfetivas, regrasSchema, viewVendasSql } from "../lib/regras-sankhya";

const tag = Math.random().toString(36).slice(2, 8);
const schema = `rg_${tag}`;
const emails: string[] = [];
const cookies: Record<string, string> = {};
let scoped: pg.Pool; let sankhyaCompany = 0; let otherCompany = 0;
const call = async (method: "GET" | "PUT" | "POST", url: string, as: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: { cookie: cookies[as]! }, ...(payload ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "dono" | "administrador", companyId: number | null) {
  const email = `${key}.rg.${tag}@teste.local`.toLowerCase(); emails.push(email);
  await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
const sum = async (sql: string) => Number((await scoped.query(sql)).rows[0].t);

before(async () => {
  await ensureDemoCompany(); await app.ready();
  await pool.query(`CREATE SCHEMA ${schema}`);
  scoped = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 2 });
  await garantirEspelho(scoped, PACOTE_SANKHYA, Object.keys(PACOTE_SANKHYA.tabelas));
  await scoped.query(`INSERT INTO espelho_controle VALUES ('TGFCAB', now()), ('TGFITE', now()), ('TGFFIN', now())`);
  await scoped.query(`INSERT INTO "TGFPAR"("CODPARC","NOMEPARC") VALUES (1,'Cliente A')`);
  await scoped.query(`INSERT INTO "TGFPRO"("CODPROD","DESCRPROD") VALUES (10,'Produto X')`);
  await scoped.query(`INSERT INTO "TGFTOP"("CODTIPOPER","DHALTER","TIPMOV","BONIFICACAO") VALUES (1100,'2026-01-01','V','N'),(1200,'2026-01-01','V','S'),(1300,'2026-01-01','D','N')`);
  // September: 100 sale (invoiced in October), 50 cancelled, 30 return, 20 bonus; plus a 10 sale in August
  const note = (n: number, top: number, mov: string, st: string, neg: string, fat: string, val: number) =>
    scoped.query(`INSERT INTO "TGFCAB"("NUNOTA","CODTIPOPER","DHTIPOPER","CODPARC","TIPMOV","STATUSNOTA","DTNEG","DTFATUR","CODEMP") VALUES ($1,$2,'2026-01-01',1,$3,$4,$5,$6,1)`, [n, top, mov, st, neg, fat])
      .then(() => scoped.query(`INSERT INTO "TGFITE"("NUNOTA","SEQUENCIA","CODPROD","QTDNEG","VLRTOT","VLRDESC") VALUES ($1,1,10,1,$2,0)`, [n, val]));
  await note(1, 1100, "V", "L", "2026-09-10", "2026-10-02", 100); await note(2, 1100, "V", "C", "2026-09-11", "2026-09-11", 50);
  await note(3, 1300, "D", "L", "2026-09-12", "2026-09-12", 30); await note(4, 1200, "V", "L", "2026-09-13", "2026-09-13", 20);
  await note(5, 1100, "V", "L", "2026-08-20", "2026-08-20", 10);
  await scoped.query(`INSERT INTO "TGFFIN"("NUFIN","CODPARC","DTVENC","VLRDESDOB","RECDESP","PROVISAO") VALUES (1,1,'2026-09-01',200,1,'N'),(2,1,'2026-09-01',70,1,'S'),(3,1,'2026-09-01',40,-1,'N')`);
  const [c] = await db.insert(companiesTable).values({ name: `Regras ${tag}`, erp: "sankhya", dataReady: false }).returning(); sankhyaCompany = c!.id;
  const [o] = await db.insert(companiesTable).values({ name: `Regras outro ${tag}`, erp: "outro", dataReady: false }).returning(); otherCompany = o!.id;
  await seed("dono", "dono", null); await seed("admin", "administrador", sankhyaCompany);
});
after(async () => {
  await scoped.end();
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [sankhyaCompany, otherCompany]));
  await app.close(); await pool.end();
});

test("rules are validated to safe shapes because they are written into a view definition", () => {
  assert.ok(regrasSchema.safeParse(REGRAS_PADRAO).success);
  for (const bad of [{ tiposMovimento: ["V'; DROP TABLE x;--"] }, { statusNota: [] }, { operacoesExcluidas: ["1100"] }, { dataVenda: "DTALTER" }, { empresas: [1.5] }, { extra: true }])
    assert.equal(regrasSchema.safeParse({ ...REGRAS_PADRAO, ...bad }).success, false, JSON.stringify(bad));
  assert.deepEqual(regrasEfetivas(null), REGRAS_PADRAO);
  assert.match(viewVendasSql({ ...REGRAS_PADRAO, operacoesExcluidas: [1200] }), /NOT IN \(1200\)/);
});

test("the views over the mirror follow the rules, and each rule changes what counts", async () => {
  await aplicarRegras(scoped, REGRAS_PADRAO, ["vendas", "financeiro"]);
  const sept = `SELECT COALESCE(SUM(valor_liquido),0) t FROM vw_vendas_itens WHERE to_char(data,'YYYY-MM')='2026-09'`;
  assert.equal(await sum(sept), 120, "by negotiation date: the 100 sale and the 20 bonus; the cancelled, the return and August stay out");
  assert.equal(await sum(`SELECT COALESCE(SUM(valor),0) t FROM vw_titulos_receber`), 200, "provisioned and expense titles stay out");
  await aplicarRegras(scoped, { ...REGRAS_PADRAO, dataVenda: "DTFATUR" }, ["vendas"]);
  assert.equal(await sum(sept), 20, "by invoicing date the 100 moves to October");
  await aplicarRegras(scoped, { ...REGRAS_PADRAO, dataVenda: "DTNEG", excluirBonificacao: true }, ["vendas"]);
  assert.equal(await sum(sept), 100, "without the bonus");
  await aplicarRegras(scoped, { ...REGRAS_PADRAO, dataVenda: "DTNEG", statusNota: ["L", "C"] }, ["vendas"]);
  assert.equal(await sum(sept), 100 + 50 + 20, "cancelled notes counted when the rule says so");
  await aplicarRegras(scoped, { ...REGRAS_PADRAO, incluirProvisao: true }, ["financeiro"]);
  assert.equal(await sum(`SELECT COALESCE(SUM(valor),0) t FROM vw_titulos_receber`), 270);
  const cols = (await scoped.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'vw_vendas_itens' ORDER BY ordinal_position`, [schema])).rows.map(r => r.column_name);
  const demo = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vw_vendas_itens' ORDER BY ordinal_position`)).rows.map(r => r.column_name);
  assert.deepEqual(cols, demo, "same columns as the demonstration view, which is what the governed metrics read");
});

test("given a month the customer trusts, the search finds the combination of rules that reproduces it", async () => {
  const linhas = await diagnosticoVendas(scoped, "2026-09");
  assert.ok(linhas.some(l => l.tipmov === "V" && l.status === "C"));
  // the customer says September is 120: sales and bonus, released only, by negotiation date
  const found = procurarRegras(linhas, 120);
  assert.ok(found.length >= 1);
  assert.deepEqual(found[0]!.regras, { dataVenda: "DTNEG", tiposMovimento: ["V"], statusNota: ["L"], valorItem: "liquido", excluirBonificacao: false }, "the simplest match comes first");
  assert.ok(procurarRegras(linhas, 100).some(c => c.regras.excluirBonificacao), "a different reference total points to a different rule");
  assert.equal(procurarRegras(linhas, 123456.78).length, 0, "an impossible total finds nothing instead of a wrong rule");
  await assert.rejects(diagnosticoVendas(scoped, "setembro"));
});

test("only the product owner sets the rules, only for Sankhya companies, and invalid rules are refused", async () => {
  assert.equal((await call("GET", `/api/plataforma/empresas/${sankhyaCompany}/regras`, "admin")).status, 403);
  const got = await call("GET", `/api/plataforma/empresas/${sankhyaCompany}/regras`, "dono");
  assert.equal(got.status, 200); assert.equal(got.body.personalizada, false); assert.deepEqual(got.body.regras, REGRAS_PADRAO);
  assert.equal((await call("GET", `/api/plataforma/empresas/${otherCompany}/regras`, "dono")).status, 400);
  assert.equal((await call("PUT", `/api/plataforma/empresas/${sankhyaCompany}/regras`, "dono", { tiposMovimento: ["V;"] })).status, 400);
  const saved = await call("PUT", `/api/plataforma/empresas/${sankhyaCompany}/regras`, "dono", { dataVenda: "DTFATUR", operacoesExcluidas: [1200] });
  assert.equal(saved.status, 200); assert.equal(saved.body.aplicada, null, "no database yet: saved for the first load");
  const again = (await call("GET", `/api/plataforma/empresas/${sankhyaCompany}/regras`, "dono")).body;
  assert.equal(again.personalizada, true); assert.equal(again.regras.dataVenda, "DTFATUR"); assert.deepEqual(again.regras.operacoesExcluidas, [1200]);
});

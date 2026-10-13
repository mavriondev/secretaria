import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { companiesTable, db, pool, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import type { Ficha } from "../lib/ficha";
import { classify, readHealth, worst } from "../lib/saude-dados";

const tag = Math.random().toString(36).slice(2, 8);
const schema = `saude_${tag}`;
const emails: string[] = [];
const cookies: Record<string, string> = {};
let company = 0;
const get = async (as: string) => {
  const res = await app.inject({ method: "GET", url: "/api/saude", headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "administrador" | "gestor", companyId: number) {
  const email = `${key}.saude.${tag}@teste.local`.toLowerCase(); emails.push(email);
  await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
before(async () => {
  await ensureDemoCompany(); await app.ready();
  const [c] = await db.insert(companiesTable).values({ name: `Saúde ${tag}`, erp: "outro", dataReady: false }).returning();
  company = c!.id;
  await seed("adminDemo", "administrador", 1); await seed("adminNovo", "administrador", company); await seed("gestorDemo", "gestor", 1);
});
after(async () => {
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await db.delete(companiesTable).where(eq(companiesTable.id, company));
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await app.close(); await pool.end();
});

test("age limits follow the load schedule, and the worst state wins", () => {
  const h = 3_600_000;
  assert.equal(classify(null, 60), "sem_dados");
  assert.equal(classify(50 * 60_000, 60), "em_dia");
  assert.equal(classify(100 * 60_000, 60), "atencao", "past one and a half intervals");
  assert.equal(classify(4 * h, 60), "desatualizado", "past three intervals");
  assert.equal(classify(20 * h, null), "em_dia");
  assert.equal(classify(30 * h, null), "atencao");
  assert.equal(classify(80 * h, null), "desatualizado");
  assert.equal(worst(["em_dia", "atencao", "em_dia"]), "atencao");
  assert.equal(worst(["atencao", "desatualizado"]), "desatualizado");
});

test("reads load times and the newest row of each described view from the company database", async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE ${schema}.espelho_controle (tabela text PRIMARY KEY, carregado_em timestamptz NOT NULL)`);
  await pool.query(`CREATE TABLE ${schema}.vw_x (atualizado_em timestamptz)`);
  const now = Date.now();
  await pool.query(`INSERT INTO ${schema}.espelho_controle VALUES ('TGFCAB', $1), ('TGFFIN', $2)`, [new Date(now - 30 * 60_000), new Date(now - 10 * 3_600_000)]);
  await pool.query(`INSERT INTO ${schema}.vw_x VALUES ($1), ($2)`, [new Date(now - 5 * 3_600_000), new Date(now - 2 * 3_600_000)]);
  const scoped = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 1 });
  try {
    const ficha = { visoes: [{ nome: "vw_x", assunto: "vendas", atualizadoEm: "atualizado_em" }, { nome: "vw_sem_coluna", assunto: "financeiro", atualizadoEm: null }] } as unknown as Ficha;
    const health = await readHealth(scoped, ficha, 60, now);
    assert.deepEqual(health.tabelas.map(t => [t.nome, t.estado]), [["TGFCAB", "em_dia"], ["TGFFIN", "desatualizado"]]);
    assert.ok(Math.abs(health.visoes[0]!.idadeHoras! - 2) < 0.01, "newest row decides the age");
    assert.equal(health.visoes[0]!.estado, "atencao", "2 h is late for an hourly schedule, not yet critical");
    assert.equal(health.visoes[1]!.estado, "sem_dados");
    // a database that never received a load has no control table: nothing to report, not an error
    const empty = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=pg_catalog", max: 1 });
    try { assert.deepEqual((await readHealth(empty, { visoes: [] } as unknown as Ficha, null)).tabelas, []); } finally { await empty.end(); }
  } finally { await scoped.end(); }
});

test("the demonstration is always fine, a company without a database says so, managers are refused", async () => {
  const demo = await get("adminDemo");
  assert.equal(demo.status, 200); assert.equal(demo.body.demonstracao, true); assert.equal(demo.body.estado, "em_dia");
  const novo = await get("adminNovo");
  assert.equal(novo.status, 200); assert.equal(novo.body.estado, "sem_dados"); assert.deepEqual(novo.body.tabelas, []);
  assert.equal((await get("gestorDemo")).status, 403);
});

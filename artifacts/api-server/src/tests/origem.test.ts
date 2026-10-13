import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { companiesTable, db, loadRunsTable, pool, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { garantirEspelho } from "../lib/carga";
import { runDueLoads } from "../lib/carga-empresa";
import { encryptSecret } from "../lib/secrets";
import { PACOTE_SANKHYA } from "../lib/pacotes/sankhya";

const BASE = process.env.SECOND_DATABASE_URL;
const tag = Math.random().toString(36).slice(2, 8);
const SRC = `osrc_${tag}`, TGT = `otgt_${tag}`;
process.env.COMPANY_DATA_KEY ||= "chave-de-teste-com-mais-de-16-caracteres";
const withSchema = (schema: string) => `${BASE}${BASE!.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
const cookies: Record<string, string> = {}; const emails: string[] = [];
let admin: pg.Pool, companyId = 0;
const call = async (method: "GET" | "PUT" | "POST", url: string, as: string, body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "dono" | "administrador", company: number | null) {
  const email = `${key}.or.${tag}@teste.local`.toLowerCase(); emails.push(email);
  await db.insert(usersTable).values({ companyId: company, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false });
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
const waitLoad = async () => { for (let i = 0; i < 200; i++) { const [r] = await db.select().from(loadRunsTable).where(eq(loadRunsTable.companyId, companyId)).orderBy(loadRunsTable.id).limit(100).then(x => x.slice(-1)); if (r && r.status !== "executando") return r; await new Promise(r => setTimeout(r, 50)); } throw new Error("load did not finish"); };

before(async () => {
  await ensureDemoCompany(); await app.ready();
  if (!BASE) return;
  admin = new pg.Pool({ connectionString: BASE, max: 1 });
  for (const s of [SRC, TGT]) await admin.query(`CREATE SCHEMA ${s}`);
  const src = new pg.Pool({ connectionString: withSchema(SRC), max: 1 });
  await garantirEspelho(src, PACOTE_SANKHYA, Object.keys(PACOTE_SANKHYA.tabelas));
  await src.query(`INSERT INTO "TGFPAR"("CODPARC","NOMEPARC") VALUES (1,'Cliente A')`);
  await src.query(`INSERT INTO "TGFVEN"("CODVEND","APELIDO") VALUES (5,'Vend')`);
  await src.end();
  const [c] = await db.insert(companiesTable).values({ name: `Origem ${tag}`, erp: "sankhya", dataReady: false, dataUrlEnc: encryptSecret(withSchema(TGT)) }).returning();
  companyId = c!.id;
  await seed("dono", "dono", null); await seed("adminX", "administrador", companyId);
});
after(async () => {
  if (BASE) {
    await db.delete(loadRunsTable).where(eq(loadRunsTable.companyId, companyId));
    await db.delete(usersTable).where(inArray(usersTable.email, emails));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    for (const s of [SRC, TGT]) await admin.query(`DROP SCHEMA ${s} CASCADE`);
    await admin.end();
  }
  await app.close(); await pool.end();
});

test("the owner connects a source: a bad address or subject is refused, the address is never returned", { skip: !BASE }, async () => {
  const bad = await call("PUT", `/api/plataforma/empresas/${companyId}/origem`, "dono", { url: "postgresql://x:y@127.0.0.1:1/nada" });
  assert.equal(bad.status, 422); assert.doesNotMatch(JSON.stringify(bad.body), /x:y@|postgresql:\/\//);
  assert.equal((await call("PUT", `/api/plataforma/empresas/${companyId}/origem`, "dono", { assuntos: ["inexistente"] })).status, 400);
  assert.equal((await call("POST", `/api/plataforma/empresas/${companyId}/carga`, "dono", {})).status, 409, "no source yet");
  const ok = await call("PUT", `/api/plataforma/empresas/${companyId}/origem`, "dono", { url: withSchema(SRC), assuntos: ["vendas"], intervaloMin: 5 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const state = await call("GET", `/api/plataforma/empresas/${companyId}/origem`, "dono");
  assert.equal(state.body.conectada, true); assert.deepEqual(state.body.assuntos, ["vendas"]);
  assert.ok(!JSON.stringify(state.body).includes(BASE!));
  assert.equal((await call("GET", `/api/plataforma/empresas/${companyId}/origem`, "adminX")).status, 403, "only the product owner");
});

test("a manual load fills the mirror and is recorded; a second one at once is refused", { skip: !BASE }, async () => {
  const first = await call("POST", `/api/plataforma/empresas/${companyId}/carga`, "dono", { modo: "completa" });
  assert.equal(first.status, 202, JSON.stringify(first.body));
  const run = await waitLoad();
  assert.equal(run.status, "concluida"); assert.equal(run.ok, true);
  const mirror = new pg.Pool({ connectionString: withSchema(TGT), max: 1 });
  assert.equal((await mirror.query(`SELECT "NOMEPARC" n FROM "TGFPAR"`)).rows[0].n, "Cliente A");
  assert.ok((await mirror.query(`SELECT 1 FROM espelho_controle WHERE tabela = 'TGFVEN'`)).rowCount);
  await mirror.end();
  const history = (await call("GET", `/api/plataforma/empresas/${companyId}/origem`, "dono")).body.cargas;
  assert.equal(history[0].modo, "completa"); assert.ok(history[0].relatorio.tabelas.length >= 10);
});

test("the scheduler loads only when the interval has passed, and does a complete load first", { skip: !BASE }, async () => {
  const now = new Date();
  assert.ok(!(await runDueLoads(now)).includes(companyId), "the last load is recent");
  const later = new Date(now.getTime() + 10 * 60_000);
  assert.ok((await runDueLoads(later)).includes(companyId), "ten minutes later it is due");
  const run = await waitLoad();
  assert.equal(run.trigger, "agendada");
  assert.equal(run.mode, "incremental", "a complete one already succeeded within the week");
});

import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { companiesTable, costsTable, db, pool, queryLogsTable, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { consumoPorEmpresa, csvConsumo, periodoConsumo } from "../lib/consumo";
import { assinaturaEleven, saldoOpenai } from "../lib/saldo-provedores";
import { erroDeCota, observarFetch, registrarRespostaProvedor } from "../lib/provedor-eventos";
import app from "../app";
import { hashPassword } from "../lib/auth";

const tag = `consumo_${Date.now()}`;
const companyIds: number[] = [], userIds: number[] = [];
const logIds: number[] = [];
const cookies: Record<string, string> = {};
const now = new Date("2026-10-15T18:00:00Z");
let previousCredit: { valor: string; atualizado_em: Date } | undefined;
let previousProvider: Record<string, unknown> | undefined;
before(async () => {
  await app.ready();
  previousCredit = (await pool.query("SELECT valor,atualizado_em FROM plataforma_configuracao WHERE chave='credito_openai_estimativa'")).rows[0];
  previousProvider = (await pool.query("SELECT * FROM provedores_estado WHERE provedor='openai'")).rows[0];
  for (const name of ["=EMPRESA", "Com consumo", "Sem consumo"]) {
    const [c] = await db.insert(companiesTable).values({ name: `${name} ${tag}`, erp: "outro", monthlyLimitUsd: "100" }).returning();
    companyIds.push(c!.id);
  }
  for (const [role, company] of [["dono", null], ["administrador", companyIds[0]], ["gestor", companyIds[0]]] as const) {
    const email = `${role}.${tag}@example.invalid`;
    const [u] = await db.insert(usersTable).values({ name: tag, email, companyId: company, role, mustChangePassword: false, passwordHash: await hashPassword("test-consumo-123") }).returning();
    userIds.push(u!.id);
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "test-consumo-123" } });
    cookies[role] = String(r.headers["set-cookie"]).split(";")[0]!;
  }
  for (let n=0; n<2; n++) {
    const [log] = await db.insert(queryLogsTable).values({ companyId: companyIds[0], question: "teste sem conteúdo real", answer: "teste", freedomLevel: 1, latencyMs: 1 }).returning();
    logIds.push(log!.id);
  }
  for (const [companyId, kind, provider, cost, at, logId] of [
    [companyIds[0], "texto", "openai", 1, "2026-10-01T02:59:59Z", logIds[0]],
    [companyIds[0], "texto", "openai", 2, "2026-10-01T03:00:00Z", logIds[1]],
    [companyIds[0], "voz", "elevenlabs", 3, "2026-10-10T12:00:00Z", null],
    [companyIds[0], "transcricao", "elevenlabs", 4, "2026-10-11T12:00:00Z", null],
    [companyIds[1], "reescrita", "openai", 0.5, "2026-10-12T12:00:00Z", null],
  ] as const) await db.insert(costsTable).values({ companyId, userId: userIds[1], kind, provider, costUsd: String(cost), quantity: "1", unit: "tokens", createdAt: new Date(at), queryLogId: logId });
});
after(async () => {
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
  await db.delete(queryLogsTable).where(inArray(queryLogsTable.id, logIds));
  if (previousCredit) await pool.query("INSERT INTO plataforma_configuracao(chave,valor,atualizado_em) VALUES('credito_openai_estimativa',$1,$2) ON CONFLICT(chave) DO UPDATE SET valor=$1,atualizado_em=$2", [previousCredit.valor, previousCredit.atualizado_em]);
  else await pool.query("DELETE FROM plataforma_configuracao WHERE chave='credito_openai_estimativa'");
  await pool.query("DELETE FROM provedores_estado WHERE provedor='openai'");
  if (previousProvider) await pool.query("INSERT INTO provedores_estado(provedor,consecutivos,ultimo_status,atualizado_em) VALUES('openai',$1,$2,$3)", [previousProvider.consecutivos, previousProvider.ultimo_status, previousProvider.atualizado_em]);
  await app.close(); await pool.end();
});
test("Brasilia month boundary and last 30 local calendar days are explicit", () => {
  const p = periodoConsumo({ mes: "2026-10" }, now);
  assert.equal(p.inicio, "2026-10-01T03:00:00.000Z"); assert.equal(p.fim, "2026-11-01T03:00:00.000Z");
  assert.equal(p.diasDecorridos, 15); assert.equal(p.diasMes, 31);
  assert.equal(periodoConsumo({}, new Date("2026-11-01T02:59:59Z")).mes, "2026-10");
  assert.equal(periodoConsumo({ periodo: "30dias" }, now).inicio, "2026-09-16T03:00:00.000Z");
});
test("month reads ledger categories, zero-use company, averages and projection without changing ceilings", async () => {
  const d = await consumoPorEmpresa({ mes: "2026-10" }, now);
  const a = d.empresas.find(x => x.empresaId === companyIds[0])!, b = d.empresas.find(x => x.empresaId === companyIds[1])!, c = d.empresas.find(x => x.empresaId === companyIds[2])!;
  assert.equal(a.totalUsd, 9); assert.equal(a.textoUsd, 2); assert.equal(a.vozUsd, 3); assert.equal(a.transcricaoUsd, 4);
  assert.equal(b.textoUsd, 0.5); assert.equal(c.totalUsd, 0); assert.equal(c.custoPorPerguntaUsd, null); assert.equal(c.custoPorUsuarioUsd, null);
  assert.equal(a.usuariosAtivos, 1); assert.equal(a.custoPorUsuarioUsd, 9); assert.equal(a.projecaoUsd, 9 / 15 * 31);
  assert.equal(a.perguntas, 1); assert.equal(a.custoPorPerguntaUsd, 9);
  assert.equal(a.tetoMensalUsd, 100); assert.equal(a.percentualTeto, 9);
  assert.ok(d.dias.some(x => x.empresaId === companyIds[0] && x.dia === "2026-10-01" && x.totalUsd === 2));
});
test("screen total exactly matches ledger within currency precision in three periods", async () => {
  for (const filter of [{ mes: "2026-09" }, { mes: "2026-10" }, { periodo: "30dias" as const }]) {
    const d = await consumoPorEmpresa(filter, now);
    const end = new Date(Math.min(new Date(d.periodo.fim).getTime(), now.getTime()));
    const exact = (await pool.query("SELECT coalesce(sum(custo_usd),0)::text AS n FROM custos_ia WHERE criado_em >= $1 AND criado_em < $2", [d.periodo.inicio, end])).rows[0].n;
    assert.ok(Math.abs(d.totais.totalUsd - Number(exact)) < 1e-8);
    assert.ok(Math.abs(d.empresas.reduce((n, e) => n + e.totalUsd, 0) - Number(exact)) < 1e-8);
  }
});
test("CSV is numbers-only content and neutralizes spreadsheet formula company names", async () => {
  const csv = csvConsumo(await consumoPorEmpresa({ mes: "2026-10" }, now));
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes(`"'=EMPRESA ${tag}"`));
  assert.ok(csv.includes('"texto"')); assert.ok(!csv.includes("senha")); assert.ok(!csv.includes("SELECT "));
});
test("only owner can read consumption and export or update credit; admin/manager remain scoped", async () => {
  for (const path of ["/api/plataforma/consumo?mes=2026-10", "/api/plataforma/consumo.csv?mes=2026-10"]) {
    assert.equal((await app.inject({ method: "GET", url: path, headers: { cookie: cookies.dono } })).statusCode, 200);
    for (const role of ["administrador", "gestor"]) assert.equal((await app.inject({ method: "GET", url: path, headers: { cookie: cookies[role] } })).statusCode, 403);
  }
  for (const role of ["administrador", "gestor"]) assert.equal((await app.inject({ method: "PUT", url: "/api/plataforma/provedores/openai", headers: { cookie: cookies[role] }, payload: { creditoUsd: 100, creditoEm: now.toISOString(), limiarUsd: null } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/plataforma/consumo?mes=2026-13", headers: { cookie: cookies.dono } })).statusCode, 400);
});
test("credit estimate subtracts OpenAI only and respects manual or automatic threshold", async () => {
  await pool.query("INSERT INTO plataforma_configuracao(chave,valor) VALUES('credito_openai_estimativa',$1) ON CONFLICT(chave) DO UPDATE SET valor=$1", [JSON.stringify({ creditoUsd: 100, creditoEm: "2026-10-01T03:00:00Z", limiarUsd: null })]);
  const exact = Number((await pool.query("SELECT coalesce(sum(custo_usd),0)::text AS n FROM custos_ia WHERE provedor='openai' AND criado_em >= '2026-10-01T03:00:00Z' AND criado_em <= $1", [now])).rows[0].n);
  const estimate = await saldoOpenai(now);
  assert.equal(estimate.modo, "estimativa"); assert.equal(estimate.saldoEstimadoUsd, 100 - exact);
  assert.ok(estimate.limiarUsd >= 10);
  await pool.query("UPDATE plataforma_configuracao SET valor=$1 WHERE chave='credito_openai_estimativa'", [JSON.stringify({ creditoUsd: 200, creditoEm: now.toISOString(), limiarUsd: 20 })]);
  const updated = await saldoOpenai(now); assert.equal(updated.saldoEstimadoUsd, 200); assert.equal(updated.limiarUsd, 20);
});
test("subscription capability is truthful and never invents a balance after permission denial", async () => {
  const valid = await assinaturaEleven(async () => new Response(JSON.stringify({ character_count: 81, character_limit: 100 })), () => now.getTime(), false);
  assert.equal(valid.percentual, 81);
  const denied = await assinaturaEleven(async () => { throw Error("permission"); }, () => now.getTime(), false);
  assert.equal(denied.status, "indisponivel"); assert.equal(denied.usado, null); assert.equal(denied.percentual, null);
});
test("only quota-specific 429 errors count as credit failures, never ordinary rate limiting", () => {
  assert.equal(erroDeCota(429, "insufficient_quota"), true); assert.equal(erroDeCota(429, "rate_limit_exceeded"), false);
  assert.equal(erroDeCota(401), true); assert.equal(erroDeCota(402), true); assert.equal(erroDeCota(500), false);
});
test("consecutive quota failures persist, trigger monitor and recover on success", async () => {
  await pool.query("DELETE FROM provedores_estado WHERE provedor='openai'");
  let notified = 0;
  for (let n = 0; n < 3; n++) await registrarRespostaProvedor("openai", 429, "insufficient_quota", () => notified++);
  assert.equal((await pool.query("SELECT consecutivos FROM provedores_estado WHERE provedor='openai'")).rows[0].consecutivos, 3);
  assert.equal(notified, 1);
  await registrarRespostaProvedor("openai", 200, undefined, () => notified++);
  assert.equal((await pool.query("SELECT consecutivos FROM provedores_estado WHERE provedor='openai'")).rows[0].consecutivos, 0);
  assert.equal(notified, 2, "successful call also asks monitor to resolve the alert");
});
test("OpenAI transport observation preserves body and status and observes errors/success in order", async () => {
  const payload = '{"error":{"code":"insufficient_quota","message":"not logged"}}';
  const responses = [new Response(payload, { status: 429 }), new Response("ok", { status: 200 })];
  const seen: Array<{ status: number; code?: string }> = [];
  let n = 0;
  const observed = observarFetch(async () => responses[n++]!, async (_provider, status, code) => { seen.push({ status, code }); });
  const a = await observed("https://api.openai.com/v1/responses"), b = await observed("https://api.openai.com/v1/responses");
  assert.equal(a, responses[0]); assert.equal(b, responses[1]); assert.equal(await a.text(), payload); assert.equal(await b.text(), "ok");
  for (let attempts = 0; attempts < 100 && seen.length < 2; attempts++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(seen, [{ status: 429, code: "insufficient_quota" }, { status: 200, code: undefined }]);
});

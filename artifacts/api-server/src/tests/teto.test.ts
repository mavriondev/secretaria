import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ceilingEventsTable, companiesTable, costsTable, db, notificationsTable, platformSettingsTable, pool, queryLogsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { answerQuestion } from "../lib/assistant";
import { startRun } from "../lib/testes";
import { runAsTenant } from "../lib/tenant";
import { _definirRitmo, _limparRitmo, categoriaPaga, permitirRitmo, RITMO_POR_MINUTO } from "../lib/ritmo";
import { CONFIG_PADRAO, dayStart, gravarConfiguracao, lerConfiguracao, mensagens, MINIMO_DIARIO_USD, registrarCusto, statusDosTetos, tetoDiarioEfetivo, verificarTeto } from "../lib/limite-custo";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const emails: string[] = [];
let company = 0;
let configAntes: Record<string, number> = {};
const call = async (method: "GET" | "POST" | "PATCH" | "PUT", url: string, as: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: { cookie: cookies[as]! }, ...(payload ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "dono" | "administrador" | "gestor", companyId: number | null) {
  const email = `${key}.teto.${tag}@teste.local`.toLowerCase(); emails.push(email);
  const [u] = await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false }).returning({ id: usersTable.id });
  ids[key] = u!.id;
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
const tenant = () => ({ companyId: company, userId: ids.gestor!, role: "gestor" as const });

before(async () => {
  await ensureDemoCompany(); await app.ready();
  configAntes = await lerConfiguracao();
  const [c] = await db.insert(companiesTable).values({ name: `Teto ${tag}`, erp: "outro", dataReady: false }).returning();
  company = c!.id;
  await seed("dono", "dono", null); await seed("admin", "administrador", company); await seed("gestor", "gestor", company);
});
after(async () => {
  await gravarConfiguracao(configAntes as Parameters<typeof gravarConfiguracao>[0]);
  await db.delete(platformSettingsTable).where(sql`${platformSettingsTable.key} not in ('teto_diario_plataforma_usd', 'teto_diario_empresa_padrao_usd')`);
  await db.delete(notificationsTable).where(eq(notificationsTable.companyId, company));
  await db.delete(ceilingEventsTable).where(eq(ceilingEventsTable.companyId, company));
  await db.delete(ceilingEventsTable).where(eq(ceilingEventsTable.triggeredBy, company));
  await db.delete(costsTable).where(eq(costsTable.companyId, company));
  await db.delete(queryLogsTable).where(eq(queryLogsTable.companyId, company));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await db.delete(companiesTable).where(eq(companiesTable.id, company));
  await app.close(); await pool.end();
});

test("the daily ceiling turns over at São Paulo midnight and defaults to a tenth of the monthly one, never below the minimum", () => {
  assert.equal(dayStart(new Date("2026-10-14T02:30:00Z")).toISOString(), "2026-10-13T03:00:00.000Z", "still the 13th in São Paulo");
  assert.equal(dayStart(new Date("2026-10-14T03:00:00Z")).toISOString(), "2026-10-14T03:00:00.000Z");
  assert.deepEqual(tetoDiarioEfetivo({ monthlyLimitUsd: null, dailyLimitUsd: "1.50" }, 2), { limiteUsd: 1.5, padrao: false });
  assert.deepEqual(tetoDiarioEfetivo({ monthlyLimitUsd: "30.00", dailyLimitUsd: null }, 2), { limiteUsd: 3, padrao: true });
  assert.deepEqual(tetoDiarioEfetivo({ monthlyLimitUsd: "1.00", dailyLimitUsd: null }, 2), { limiteUsd: MINIMO_DIARIO_USD, padrao: true });
  assert.deepEqual(tetoDiarioEfetivo({ monthlyLimitUsd: null, dailyLimitUsd: null }, 2), { limiteUsd: CONFIG_PADRAO.teto_diario_empresa_padrao_usd, padrao: true });
});

test("every kind of paid call lands in one ledger and the backfill of old answers is idempotent", async () => {
  const [log] = await db.insert(queryLogsTable).values({ companyId: company, question: `antiga ${tag}`, answer: "r", freedomLevel: 1, latencyMs: 1, inputTokens: 10, outputTokens: 5, estimatedCostUsd: "0.00300000", parameters: {} }).returning({ id: queryLogsTable.id });
  const backfill = readFileSync(path.resolve(import.meta.dirname, "../../../../lib/db/migracao-complementos.sql"), "utf8");
  await db.execute(sql.raw(backfill)); await db.execute(sql.raw(backfill));
  const copied = await db.select().from(costsTable).where(eq(costsTable.queryLogId, log!.id));
  assert.equal(copied.length, 1, "a second run copies nothing");
  assert.equal(copied[0]!.kind, "texto"); assert.equal(Number(copied[0]!.quantity), 15); assert.equal(Number(copied[0]!.costUsd), 0.003);
  await runAsTenant(tenant(), async () => {
    await registrarCusto({ tipo: "voz", provedor: "elevenlabs", modelo: "eleven_v4_turbo", quantidade: 120, unidade: "caracteres", custoUsd: 0.018 });
    await registrarCusto({ tipo: "transcricao", provedor: "elevenlabs", modelo: "scribe_v2_realtime", quantidade: 6, unidade: "segundos", custoUsd: 0.0007 });
  });
  const rows = await db.select().from(costsTable).where(eq(costsTable.companyId, company));
  assert.deepEqual(rows.map(r => r.kind).sort(), ["texto", "transcricao", "voz"]);
  assert.ok(rows.filter(r => r.kind !== "texto").every(r => r.userId === ids.gestor), "calls made in a tenant are attributed to the person");
  const status = await statusDosTetos(company);
  assert.ok(Math.abs(status.dia.usadoUsd - 0.0217) < 1e-9, "day = voice + transcription (the old answer is dated by its log)");
  assert.equal(status.dia.limiteUsd, CONFIG_PADRAO.teto_diario_empresa_padrao_usd); assert.equal(status.dia.padrao, true);
});

test("reaching the daily ceiling pauses text, audio and voice with a short sentence, spends nothing and warns administrators once", async () => {
  assert.equal((await call("PATCH", `/api/plataforma/empresas/${company}`, "admin", { limiteDiarioUsd: 0.05 })).status, 403, "only the owner sets ceilings");
  const set = await call("PATCH", `/api/plataforma/empresas/${company}`, "dono", { limiteDiarioUsd: 0.05 });
  assert.equal(set.status, 200); assert.equal(set.body.limiteDiarioUsd, 0.05);
  await runAsTenant(tenant(), () => registrarCusto({ tipo: "texto", provedor: "openai", quantidade: 1000, unidade: "tokens", custoUsd: 0.02 }));
  let status = await statusDosTetos(company);
  assert.equal(status.dia.aviso, true); assert.equal(status.dia.bloqueado, false); assert.equal(status.bloqueado, false);
  const avisos80 = await db.select().from(notificationsTable).where(and(eq(notificationsTable.companyId, company), eq(notificationsTable.kind, "sistema")));
  assert.equal(avisos80.length, 1, "the 80 % notice goes to the administrator (not to the manager)"); assert.equal(avisos80[0]!.userId, ids.admin); assert.match(avisos80[0]!.title, /80 %/);
  await runAsTenant(tenant(), () => registrarCusto({ tipo: "voz", provedor: "elevenlabs", quantidade: 80, unidade: "caracteres", custoUsd: 0.012 }));
  status = await statusDosTetos(company);
  assert.equal(status.bloqueado, true); assert.equal(status.motivo, "empresa_dia"); assert.equal(status.mensagem, mensagens.empresa_dia);
  const before = await db.select().from(costsTable).where(eq(costsTable.companyId, company));
  const text = await runAsTenant(tenant(), () => answerQuestion({ question: "Quanto faturamos hoje?", freedomLevel: 1, includeVoice: true }));
  assert.equal(text.answer, "Atingimos o limite de uso de hoje. Volte amanhã ou fale com o administrador.");
  assert.equal(text.inputTokens, 0); assert.equal(text.audioBase64, null, "no voice is synthesised for a blocked turn");
  assert.equal((text.parameters as { _limiteMotivo?: string })._limiteMotivo, "empresa_dia");
  const run = await startRun(tenant());
  assert.ok("error" in run && /hoje/.test(run.error), "test runs are refused too");
  const after = await db.select().from(costsTable).where(eq(costsTable.companyId, company));
  assert.equal(after.length, before.length, "nothing was booked while blocked");
  await verificarTeto(company); await verificarTeto(company);
  const avisos = await db.select().from(notificationsTable).where(and(eq(notificationsTable.companyId, company), eq(notificationsTable.kind, "sistema")));
  assert.equal(avisos.length, 2, "80 % and the block, each once, however many times the gate runs");
  assert.ok(avisos.some(a => /atingido/.test(a.title) && a.conditionText === "bloqueado"));
  const eventos = await db.select().from(ceilingEventsTable).where(eq(ceilingEventsTable.companyId, company));
  assert.deepEqual(eventos.map(e => [e.scope, e.level]).sort(), [["empresa_dia", 100], ["empresa_dia", 80]]);
  const painel = await call("GET", "/api/uso?dias=7", "admin");
  assert.equal(painel.body.tetos.dia.bloqueado, true); assert.equal(painel.body.eventos.length, 2); assert.ok(painel.body.porTipo.hoje.voz > 0);
  const geral = await call("GET", "/api/plataforma/uso?dias=7", "dono");
  const linha = geral.body.empresas.find((e: { empresaId: number }) => e.empresaId === company);
  assert.equal(linha.dia.bloqueado, true); assert.equal(linha.dia.limiteUsd, 0.05); assert.ok(geral.body.eventos.some((e: { empresaId: number; nivel: number }) => e.empresaId === company && e.nivel === 100));
  assert.ok(geral.body.plataforma.teto && geral.body.plataforma.hoje.total >= linha.hoje.total);
  // Isolation: the other companies keep answering, and the routes that spend no AI (favourites, lists, inbox) are neither gated nor paced.
  assert.equal((await statusDosTetos(1)).dia.bloqueado, false, "the demonstration company is not affected");
  assert.equal(categoriaPaga("GET", "/favoritos/12/executar"), null); assert.equal(categoriaPaga("GET", "/dados/listas"), null); assert.equal(categoriaPaga("GET", "/notificacoes"), null);
  assert.equal((await call("GET", "/api/notificacoes", "admin")).status, 200);
  const limpo = await call("PATCH", `/api/plataforma/empresas/${company}`, "dono", { limiteDiarioUsd: null });
  assert.equal(limpo.body.limiteDiarioUsd, null);
  assert.equal((await statusDosTetos(company)).bloqueado, false, "back to the default daily ceiling");
});

test("the platform-wide daily ceiling is the owner's setting and blocks every company with its own sentence", async () => {
  assert.equal((await call("GET", "/api/plataforma/configuracao", "admin")).status, 403);
  const atual = await call("GET", "/api/plataforma/configuracao", "dono");
  assert.equal(atual.status, 200); assert.equal(typeof atual.body.valores.teto_diario_plataforma_usd, "number");
  const salvo = await call("PUT", "/api/plataforma/configuracao", "dono", { teto_diario_plataforma_usd: 0.001 });
  assert.equal(salvo.status, 200); assert.equal(salvo.body.valores.teto_diario_plataforma_usd, 0.001);
  const status = await statusDosTetos(company);
  assert.equal(status.plataforma.bloqueado, true); assert.equal(status.motivo, "plataforma_dia"); assert.equal(status.mensagem, mensagens.plataforma_dia);
  await verificarTeto(company);
  const evento = await db.select().from(ceilingEventsTable).where(and(eq(ceilingEventsTable.companyId, 0), eq(ceilingEventsTable.scope, "plataforma_dia"), eq(ceilingEventsTable.level, 100)));
  assert.ok(evento.length >= 1 && evento.some(e => e.triggeredBy === company), "the owner sees which company's call hit the platform ceiling");
  const geral = await call("GET", "/api/plataforma/uso?dias=7", "dono");
  assert.equal(geral.body.plataforma.teto.bloqueado, true);
  assert.equal((await call("PUT", "/api/plataforma/configuracao", "dono", { teto_diario_plataforma_usd: -1 })).status, 400);
  await call("PUT", "/api/plataforma/configuracao", "dono", { teto_diario_plataforma_usd: configAntes.teto_diario_plataforma_usd });
  assert.equal((await statusDosTetos(company)).plataforma.bloqueado, false);
});

test("A-27 under the test runner the pace limit is generous by default, so no file needs RITMO_POR_MINUTO exported by hand", () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, "node --test marks its workers");
  if (process.env.RITMO_POR_MINUTO === undefined) assert.equal(RITMO_POR_MINUTO, 1000);
});

test("paid routes are paced per person: the 21st call within a minute is refused with 429 and nothing else is touched", async () => {
  _limparRitmo(); _definirRitmo(20);
  for (let i = 0; i < 20; i++) assert.equal(permitirRitmo(999_999, "texto", 1_000 + i), true);
  assert.equal(permitirRitmo(999_999, "texto", 1_100), false);
  assert.equal(permitirRitmo(999_999, "voz", 1_100), true, "another category has its own window");
  assert.equal(permitirRitmo(999_999, "texto", 1_000 + 60_001), true, "the window slides");
  _limparRitmo();
  // The implantation analysis is a paid route that this company refuses before any model call (no source configured): cheap to repeat.
  let last = 0;
  for (let i = 0; i < 20; i++) last = (await call("POST", `/api/plataforma/empresas/${company}/implantacao/analisar`, "dono", { esquema: "public" })).status;
  assert.equal(last, 409);
  const refused = await call("POST", `/api/plataforma/empresas/${company}/implantacao/analisar`, "dono", { esquema: "public" });
  assert.equal(refused.status, 429); assert.match(refused.body.error, /Aguarde um minuto/);
  assert.equal((await call("GET", "/api/plataforma/uso?dias=7", "dono")).status, 200, "reading is never paced");
  _limparRitmo(); _definirRitmo(null);
});

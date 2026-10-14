import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { alertsTable, db, favoritesTable, notificationsTable, pool, pushSubscriptionsTable, queryLogsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { runAsTenant } from "../lib/tenant";
import { prepararFavorito, salvarFavorito, type Execucao, type Favorito, type Resultado } from "../lib/favoritos";
import { _limparVerificacoes, avaliar, criarAviso, definirConfiguracao, emSilencio, observar, verificarAvisosDaEmpresa, type Deps } from "../lib/avisos";
import { alertRequested, favoritoDoAssunto, interpretarPedidoDeAviso, numeroFalado } from "../lib/avisos-fala";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const emails: string[] = [];
const logIds: number[] = [];
const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, as: string, body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "administrador" | "gestor") {
  const email = `${key}.aviso.${tag}@teste.local`.toLowerCase(); emails.push(email);
  const [u] = await db.insert(usersTable).values({ companyId: 1, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false }).returning();
  ids[key] = u!.id;
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
const tenant = (key: string) => ({ companyId: 1, userId: ids[key]!, role: "gestor" as const });
const SQL = "SELECT SUM(valor_liquido) AS total FROM vw_vendas_itens";
async function liveCard(key: string, title: string): Promise<Favorito> {
  const [log] = await db.insert(queryLogsTable).values({ companyId: 1, question: `pergunta aviso ${tag}`, answer: "resposta", freedomLevel: 1, latencyMs: 10,
    parameters: { _fixavel: true, _executions: [{ tool: "consultar_dados", sql: SQL, formatos: [], status: "ok", linhas: 1, views: ["vw_vendas_itens"] }] } }).returning();
  logIds.push(log!.id);
  return runAsTenant(tenant(key), async () => {
    const draft = await prepararFavorito({ queryLogId: log!.id, tipo: "vivo" }, { rewrite: async () => { throw new Error("no model"); } });
    return salvarFavorito({ rascunhoId: draft.id, titulo: title, tipo: "vivo", naTelaInicial: false });
  });
}
const column = { name: "total", label: "Total", type: "dinheiro" as const };
const numero = (value: number): Resultado => ({ columns: [column], rows: [{ total: String(value) }], truncated: false, updatedAt: null, executadoEm: new Date().toISOString(), forma: "numero", formas: ["numero", "tabela"], dados: { form: "numero", column, raw: String(value), value } });
const tabela = (rows: Array<Record<string, string>>): Resultado => ({ columns: [{ name: "placa", label: "Placa", type: "texto" }, { name: "estado", label: "Estado", type: "texto" }], rows, truncated: false, updatedAt: null, executadoEm: new Date().toISOString(), forma: "tabela", formas: ["tabela"], dados: { form: "tabela", columns: [], rows, total: rows.length, truncated: false } });
const ok = (resultado: Resultado): Execucao => ({ estado: "ok", resultado, variacao: null, cache: false, marcador: "m", estadoDados: "em_dia" });

/** A harness: controllable value, marker and clock; every push attempt is recorded. */
function harness(initial: number) {
  const state = { value: initial, marca: "2026-10-14T10:00:00.000Z", now: new Date("2026-10-14T13:00:00.000Z"), runs: 0, pushes: [] as Array<{ endpoint: string; title: string }>, pushResult: { ok: true } as { ok: boolean; gone?: boolean } };
  const deps: Deps = {
    now: () => state.now,
    marcador: async () => ({ marcador: state.marca, estado: "em_dia", verificadoEm: state.now.toISOString() }),
    executar: async () => { state.runs++; return ok(numero(state.value)); },
    push: async (sub, payload) => { state.pushes.push({ endpoint: sub.endpoint, title: payload.title }); return state.pushResult; },
  };
  const newData = (value: number, minutesLater = 60) => { state.value = value; state.marca = new Date(Date.parse(state.marca) + 60_000).toISOString(); state.now = new Date(state.now.getTime() + minutesLater * 60_000); };
  return { state, deps, newData };
}
const noticesOf = (userId: number) => db.select().from(notificationsTable).where(eq(notificationsTable.userId, userId)).orderBy(notificationsTable.id);

before(async () => {
  await ensureDemoCompany(); await app.ready();
  await seed("gestor", "gestor"); await seed("colega", "gestor"); await seed("admin", "administrador");
});
after(async () => {
  await db.delete(alertsTable).where(inArray(alertsTable.userId, Object.values(ids)));
  await db.delete(notificationsTable).where(inArray(notificationsTable.userId, Object.values(ids)));
  await db.delete(favoritesTable).where(inArray(favoritesTable.userId, Object.values(ids)));
  if (logIds.length) await db.delete(queryLogsTable).where(inArray(queryLogsTable.id, logIds));
  await db.delete(queryLogsTable).where(eq(queryLogsTable.question, `[favorito] pergunta aviso ${tag}`));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await app.close(); await pool.end();
});

test("conditions are evaluated by code: above/below are states, variation and change are events", () => {
  const now = observar(numero(1200)); const prev = { numero: 1000, fingerprint: "x", rows: null };
  assert.ok(avaliar({ condition: "acima", threshold: "1000", thresholdKind: "valor" }, now, prev).verdadeiro);
  assert.ok(!avaliar({ condition: "abaixo", threshold: "1000", thresholdKind: "valor" }, now, prev).verdadeiro);
  assert.ok(avaliar({ condition: "variacao", threshold: "15", thresholdKind: "percentual" }, now, prev).verdadeiro, "20% up > 15%");
  assert.ok(!avaliar({ condition: "variacao", threshold: "25", thresholdKind: "percentual" }, now, prev).verdadeiro);
  assert.ok(avaliar({ condition: "variacao", threshold: "150", thresholdKind: "valor" }, now, prev).verdadeiro);
  assert.equal(avaliar({ condition: "acima", threshold: "1000", thresholdKind: "valor" }, now, prev).valor, "R$ 1.200,00");
  const t1 = observar(tabela([{ placa: "ABC1D23", estado: "em rota" }])), t2 = observar(tabela([{ placa: "ABC1D23", estado: "parado" }]));
  assert.ok(!avaliar({ condition: "mudou", threshold: null, thresholdKind: "valor" }, t1, { numero: null, fingerprint: null, rows: null }).verdadeiro, "no reference yet: never fires");
  const changed = avaliar({ condition: "mudou", threshold: null, thresholdKind: "valor" }, t2, { numero: null, fingerprint: t1.fingerprint, rows: t1.rows });
  assert.ok(changed.verdadeiro); assert.equal(changed.detalhe, "1 linha(s) nova(s)");
  assert.ok(!avaliar({ condition: "mudou", threshold: null, thresholdKind: "valor" }, t2, { numero: null, fingerprint: t2.fingerprint, rows: t2.rows }).verdadeiro);
  const cfg = { silencioAtivo: true, silencioInicio: 22, silencioFim: 7 };
  assert.ok(emSilencio(cfg, new Date("2026-10-15T02:30:00.000Z")), "23:30 in São Paulo");
  assert.ok(!emSilencio(cfg, new Date("2026-10-14T13:00:00.000Z")), "10:00 in São Paulo");
  assert.ok(!emSilencio({ ...cfg, silencioAtivo: false }, new Date("2026-10-15T02:30:00.000Z")));
});

test("spoken alert requests are understood by fixed patterns", () => {
  assert.ok(alertRequested("me avisa quando o faturamento de hoje passar de 200 mil"));
  assert.ok(alertRequested("quero ser avisado quando os títulos vencidos ficarem acima de 50 mil"));
  assert.ok(!alertRequested("qual foi o faturamento de hoje")); assert.ok(!alertRequested("fixa esse faturamento"));
  assert.deepEqual(numeroFalado("passar de 200 mil"), { valor: 200_000, percentual: false });
  assert.deepEqual(numeroFalado("R$ 10.500,50"), { valor: 10_500.5, percentual: false });
  assert.deepEqual(numeroFalado("cair mais de 20%"), { valor: 20, percentual: true });
  assert.deepEqual(numeroFalado("1,5 milhão"), { valor: 1_500_000, percentual: false });
  const p = interpretarPedidoDeAviso("me avisa quando o faturamento de hoje passar de 200 mil");
  assert.equal(p.condicao, "acima"); assert.equal(p.limiar, 200_000); assert.equal(p.assunto, "faturamento de hoje");
  const q = interpretarPedidoDeAviso("me avisa quando os títulos vencidos caírem mais de 20%");
  assert.equal(q.condicao, "variacao"); assert.equal(q.tipoLimiar, "percentual"); assert.equal(q.limiar, 20);
  const r = interpretarPedidoDeAviso("avisa quando o estado do caminhão ABC mudar");
  assert.equal(r.condicao, "mudou"); assert.equal(r.limiar, null);
  const favs = [{ id: 1, title: "Faturamento de hoje" }, { id: 2, title: "Faturamento do mês" }, { id: 3, title: "Títulos vencidos" }];
  assert.equal(favoritoDoAssunto("faturamento de hoje", favs)?.id, 1);
  assert.equal(favoritoDoAssunto("títulos vencidos", favs)?.id, 3);
  assert.equal(favoritoDoAssunto("faturamento", favs), null, "tie: the screen asks");
  assert.equal(favoritoDoAssunto("frota parada", favs), null);
});

test("a rule fires once on the false→true transition, stays quiet while true, reminds after the period and re-arms after returning to normal", async () => {
  _limparVerificacoes();
  const card = await liveCard("gestor", `Faturamento ${tag}`);
  const h = harness(900);
  await runAsTenant(tenant("gestor"), () => definirConfiguracao({ silencioAtivo: false }));
  // A rule created while the condition already holds starts "true": it only fires after the value leaves and comes back.
  const already = await runAsTenant(tenant("gestor"), () => criarAviso({ favoritoId: card.id, condicao: "acima", limiar: 1, reavisarAposMin: 120 }));
  assert.equal(already.currentState, true); await db.delete(alertsTable).where(eq(alertsTable.id, already.id));
  await db.update(favoritesTable).set({ lastValue: "900" }).where(eq(favoritesTable.id, card.id));
  const rule = await runAsTenant(tenant("gestor"), () => criarAviso({ favoritoId: card.id, condicao: "acima", limiar: 1000, reavisarAposMin: 120 }));
  assert.equal(rule.currentState, false);
  await db.insert(pushSubscriptionsTable).values({ companyId: 1, userId: ids.gestor!, endpoint: `https://push.test/${tag}/a`, p256dh: "k", auth: "a" });
  // First check: the value is below the threshold, nothing fires; the marker is remembered.
  let v = await verificarAvisosDaEmpresa(1, h.deps);
  assert.equal(v.verificados, 1); assert.equal(v.disparados, 0);
  assert.deepEqual(await verificarAvisosDaEmpresa(1, h.deps), { empresaId: 1, marcador: h.state.marca, verificados: 0, disparados: 0, pulado: "sem-marcador-novo" }, "same marker: no query at all");
  assert.equal(h.state.runs, 1);
  // New data above the threshold: one notice, one push.
  h.newData(1500); v = await verificarAvisosDaEmpresa(1, h.deps);
  assert.equal(v.disparados, 1);
  let notices = await noticesOf(ids.gestor!);
  assert.equal(notices.length, 1); assert.equal(notices[0]!.value, "R$ 1.500,00"); assert.equal(notices[0]!.conditionText, "acima de R$ 1.000,00"); assert.ok(notices[0]!.pushed);
  assert.equal(h.state.pushes.length, 1); assert.equal(h.state.pushes[0]!.title, `Tato · Faturamento ${tag}`);
  // Still above on the next loads: suppressed (within the reminder period).
  h.newData(1600, 30); h.newData(1700, 30); await verificarAvisosDaEmpresa(1, h.deps); 
  h.newData(1800, 30); await verificarAvisosDaEmpresa(1, h.deps);
  assert.equal((await noticesOf(ids.gestor!)).length, 1, "no repeat while the condition keeps holding");
  // After the reminder period (120 min) still true: one reminder.
  h.newData(1900, 90); v = await verificarAvisosDaEmpresa(1, h.deps);
  assert.equal(v.disparados, 1); assert.equal((await noticesOf(ids.gestor!)).length, 2);
  // Back to normal, then above again: fires again immediately.
  h.newData(800, 10); v = await verificarAvisosDaEmpresa(1, h.deps); assert.equal(v.disparados, 0);
  h.newData(1200, 10); v = await verificarAvisosDaEmpresa(1, h.deps); assert.equal(v.disparados, 1);
  notices = await noticesOf(ids.gestor!); assert.equal(notices.length, 3);
  // A subscription the push service reports as gone is removed.
  h.state.pushResult = { ok: false, gone: true };
  h.newData(700, 10); await verificarAvisosDaEmpresa(1, h.deps); h.newData(1300, 10); await verificarAvisosDaEmpresa(1, h.deps);
  assert.equal((await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, ids.gestor!))).length, 0);
  assert.equal((await noticesOf(ids.gestor!)).at(-1)!.pushed, false);
  // Variation rule: fires on each change beyond the threshold, measured from the previous check.
  const varRule = await runAsTenant(tenant("gestor"), () => criarAviso({ favoritoId: card.id, condicao: "variacao", limiar: 20, tipoLimiar: "percentual" }));
  await db.update(alertsTable).set({ active: false }).where(eq(alertsTable.id, rule.id));
  h.newData(1300, 10); await verificarAvisosDaEmpresa(1, h.deps); // baseline for the new rule (1300 → 1300: 0%)
  h.newData(1000, 10); v = await verificarAvisosDaEmpresa(1, h.deps); assert.equal(v.disparados, 1, "−23%");
  h.newData(1050, 10); v = await verificarAvisosDaEmpresa(1, h.deps); assert.equal(v.disparados, 0, "+5%");
  const last = (await noticesOf(ids.gestor!)).at(-1)!; assert.match(last.conditionText!, /^caiu 23,08% desde R\$ 1\.300,00$/);
  await db.delete(alertsTable).where(inArray(alertsTable.id, [rule.id, varRule.id]));
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, ids.gestor!));
});

test("rules of several people on the same card share one run, each is evaluated for its owner, and a deactivated user's rules are dropped", async () => {
  _limparVerificacoes();
  const card = await liveCard("admin", `Vencidos ${tag}`);
  await db.update(favoritesTable).set({ scope: "empresa", sharedBy: ids.admin!, sharedAt: new Date() }).where(eq(favoritesTable.id, card.id));
  const h = harness(100);
  for (const k of ["gestor", "colega", "admin"]) await runAsTenant(tenant(k), () => definirConfiguracao({ silencioAtivo: false }));
  const a = await runAsTenant(tenant("gestor"), () => criarAviso({ favoritoId: card.id, condicao: "acima", limiar: 500 }));
  const b = await runAsTenant(tenant("colega"), () => criarAviso({ favoritoId: card.id, condicao: "acima", limiar: 5000 }));
  const c = await runAsTenant(tenant("admin"), () => criarAviso({ favoritoId: card.id, condicao: "abaixo", limiar: 50 }));
  await verificarAvisosDaEmpresa(1, h.deps);
  h.newData(1000); const v = await verificarAvisosDaEmpresa(1, h.deps);
  assert.equal(h.state.runs, 2, "two checks, one run each despite three rules");
  assert.equal(v.verificados, 3); assert.equal(v.disparados, 1, "only the 500 rule crossed");
  assert.equal((await noticesOf(ids.gestor!)).length, 1); assert.equal((await noticesOf(ids.colega!)).length, 0);
  // A deactivated person's rules are removed at the next check.
  await db.update(usersTable).set({ active: false }).where(eq(usersTable.id, ids.colega!));
  h.newData(1001); await verificarAvisosDaEmpresa(1, h.deps);
  assert.equal((await db.select().from(alertsTable).where(eq(alertsTable.id, b.id))).length, 0);
  await db.update(usersTable).set({ active: true }).where(eq(usersTable.id, ids.colega!));
  await db.delete(alertsTable).where(inArray(alertsTable.id, [a.id, c.id]));
  await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [ids.gestor!, ids.colega!, ids.admin!]));
});

test("daily cap folds notices into one summary and quiet hours keep push away while the inbox still receives", async () => {
  _limparVerificacoes();
  const card = await liveCard("colega", `Pico ${tag}`);
  const h = harness(0);
  await runAsTenant(tenant("colega"), () => definirConfiguracao({ silencioAtivo: false }));
  await db.insert(pushSubscriptionsTable).values({ companyId: 1, userId: ids.colega!, endpoint: `https://push.test/${tag}/b`, p256dh: "k", auth: "a" });
  const rule = await runAsTenant(tenant("colega"), () => criarAviso({ favoritoId: card.id, condicao: "mudou" }));
  await verificarAvisosDaEmpresa(1, h.deps);
  for (let i = 1; i <= 12; i++) { h.newData(i, 5); await verificarAvisosDaEmpresa(1, h.deps); }
  const notices = await noticesOf(ids.colega!);
  const avisos = notices.filter(n => n.kind === "aviso"), resumos = notices.filter(n => n.kind === "resumo");
  assert.equal(avisos.length, 12, "every notice is in the inbox"); assert.equal(resumos.length, 1); assert.equal(resumos[0]!.count, 2);
  assert.equal(avisos.filter(n => n.pushed).length, 10, "pushed up to the cap");
  assert.equal(h.state.pushes.length, 11, "10 notices + 1 summary push");
  // Quiet hours: notice recorded, push skipped, reason kept.
  await runAsTenant(tenant("colega"), () => definirConfiguracao({ silencioAtivo: true, silencioInicio: 22, silencioFim: 7 }));
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, ids.colega!));
  h.state.now = new Date("2026-10-15T02:00:00.000Z"); h.newData(99, 0); await verificarAvisosDaEmpresa(1, h.deps);
  const quiet = await noticesOf(ids.colega!);
  assert.equal(quiet.length, 1); assert.equal(quiet[0]!.pushed, false); assert.equal(quiet[0]!.pushSkippedReason, "silencio"); assert.equal(h.state.pushes.length, 11);
  await db.delete(alertsTable).where(eq(alertsTable.id, rule.id));
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, ids.colega!));
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, ids.colega!));
});

test("routes: owner-only access, quota, condition validation, inbox and read marks; no AI cost is ever logged", async () => {
  const card = await liveCard("gestor", `Rota ${tag}`);
  const other = await liveCard("colega", `Alheio ${tag}`);
  const costBefore = await db.select().from(queryLogsTable).where(and(eq(queryLogsTable.companyId, 1), eq(queryLogsTable.question, `pergunta aviso ${tag}`)));
  assert.equal((await call("POST", "/api/avisos", "gestor", { favoritoId: other.id, condicao: "acima", limiar: 1 })).status, 404, "a card not visible to me");
  assert.equal((await call("POST", "/api/avisos", "gestor", { favoritoId: card.id, condicao: "acima" })).status, 422, "threshold required");
  const created = await call("POST", "/api/avisos", "gestor", { favoritoId: card.id, condicao: "acima", limiar: 1000 });
  assert.equal(created.status, 201); assert.equal(created.body.descricao, "quando passar de 1.000", "value type is learnt at the first check when the answer declared no format"); assert.equal(created.body.favoritoTitulo, `Rota ${tag}`);
  const list = await call("GET", `/api/avisos?favoritoId=${card.id}`, "gestor");
  assert.equal(list.body.itens.length, 1); assert.deepEqual(list.body.condicoes, ["acima", "abaixo", "variacao", "mudou"]); assert.equal(list.body.cota, 20);
  assert.equal((await call("GET", "/api/avisos", "colega")).body.itens.length, 0, "rules are personal");
  assert.equal((await call("PATCH", `/api/avisos/${created.body.id}`, "colega", { ativo: false })).status, 404);
  assert.equal((await call("PATCH", `/api/avisos/${created.body.id}`, "gestor", { ativo: false })).body.ativo, false);
  for (let i = 0; i < 19; i++) assert.equal((await call("POST", "/api/avisos", "gestor", { favoritoId: card.id, condicao: "mudou" })).status, 201);
  assert.equal((await call("POST", "/api/avisos", "gestor", { favoritoId: card.id, condicao: "mudou" })).status, 409, "quota of 20");
  assert.equal((await call("GET", "/api/avisos/push", "gestor")).body.disponivel, false, "no VAPID keys in tests");
  assert.equal((await call("POST", "/api/avisos/push/assinatura", "gestor", { endpoint: "https://push.test/x", keys: { p256dh: "a", auth: "b" } })).status, 409);
  const cfg = await call("PUT", "/api/avisos/configuracao", "gestor", { silencioAtivo: true, silencioInicio: 23, silencioFim: 6 });
  assert.deepEqual(cfg.body, { silencioAtivo: true, silencioInicio: 23, silencioFim: 6 });
  await db.insert(notificationsTable).values([{ companyId: 1, userId: ids.gestor!, title: "t", message: "m" }, { companyId: 1, userId: ids.gestor!, title: "t2", message: "m2" }, { companyId: 1, userId: ids.colega!, title: "c", message: "m" }]);
  const inbox = await call("GET", "/api/notificacoes", "gestor");
  assert.equal(inbox.body.naoLidas, 2); assert.equal(inbox.body.itens.length, 2);
  assert.equal((await call("POST", "/api/notificacoes/lidas", "gestor", { ids: [inbox.body.itens[0].id] })).body.marcadas, 1);
  assert.equal((await call("POST", "/api/notificacoes/lidas", "gestor", { todas: true })).body.marcadas, 1);
  assert.equal((await call("GET", "/api/notificacoes", "colega")).body.naoLidas, 1, "inboxes are personal");
  assert.equal((await call("DELETE", `/api/avisos/${created.body.id}`, "gestor")).status, 204);
  // The spoken request goes through the assistant route without a model call: zero tokens, zero cost, dialog pre-filled.
  const ask = await call("POST", "/api/assistant/ask", "gestor", { question: `me avisa quando a rota ${tag} passar de 300 mil`, freedomLevel: 1 });
  assert.equal(ask.status, 200); assert.equal(ask.body.inputTokens, 0); assert.equal(ask.body.parameters._aviso.favoritoId, card.id); assert.equal(ask.body.parameters._aviso.limiar, 300_000);
  assert.match(ask.body.answer, /Abri o aviso para "Rota/);
  logIds.push(ask.body.id);
  const costAfter = await db.select().from(queryLogsTable).where(and(eq(queryLogsTable.companyId, 1), eq(queryLogsTable.question, `pergunta aviso ${tag}`)));
  assert.equal(costAfter.length, costBefore.length, "no answer logs were created by alert checks");
  await db.delete(alertsTable).where(eq(alertsTable.userId, ids.gestor!));
  await db.delete(notificationsTable).where(inArray(notificationsTable.userId, [ids.gestor!, ids.colega!]));
});

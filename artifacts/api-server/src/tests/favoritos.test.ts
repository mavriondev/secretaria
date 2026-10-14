import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { companiesTable, db, favoritesTable, pool, queryLogsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { runAsTenant } from "../lib/tenant";
import { _limparCaches, copiarFavorito, executarFavorito, listarFavoritos, pegarFavorito, prepararFavorito, salvarFavorito, temDatasLiterais, tituloSugerido, type DateRewriter } from "../lib/favoritos";
import { runFreeQuery } from "../lib/free-query";
import { pinRequested } from "../lib/assistant";

const tag = Math.random().toString(36).slice(2, 8);
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};
const emails: string[] = [];
const logIds: number[] = [];
const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, as: string, body?: unknown) => {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "administrador" | "gestor", companyId: number) {
  const email = `${key}.fav.${tag}@teste.local`.toLowerCase(); emails.push(email);
  const [u] = await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false }).returning();
  ids[key] = u!.id;
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
/** An audit log shaped like a real answer that came from a free query. */
async function logWith(sql: string, question = `pergunta ${tag}`, formatos: unknown[] = []) {
  const [log] = await db.insert(queryLogsTable).values({ companyId: 1, question, answer: "resposta", freedomLevel: 1, latencyMs: 10,
    parameters: { _fixavel: true, _executions: [{ tool: "consultar_dados", sql, formatos, status: "ok", linhas: 1, views: ["vw_vendas_itens"] }] } }).returning();
  logIds.push(log!.id); return log!.id;
}
const gestor = () => ({ companyId: 1, userId: ids.gestor!, role: "gestor" as const });
const LITERAL = "SELECT SUM(valor_liquido) AS total FROM vw_vendas_itens WHERE data >= '2026-09-01' AND data < '2026-10-01'";
const RELATIVE = "SELECT SUM(valor_liquido) AS total FROM vw_vendas_itens WHERE data >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date AND data < date_trunc('month', CURRENT_DATE)::date";
const NO_DATES = "SELECT cliente, SUM(valor_liquido) AS total FROM vw_vendas_itens GROUP BY cliente ORDER BY total DESC LIMIT 5";

before(async () => {
  await ensureDemoCompany(); await app.ready();
  await seed("gestor", "gestor", 1); await seed("colega", "gestor", 1); await seed("admin", "administrador", 1);
});
after(async () => {
  await db.delete(favoritesTable).where(inArray(favoritesTable.userId, Object.values(ids)));
  if (logIds.length) await db.delete(queryLogsTable).where(inArray(queryLogsTable.id, logIds));
  await db.delete(queryLogsTable).where(eq(queryLogsTable.question, `[favorito] pergunta ${tag}`));
  await db.delete(queryLogsTable).where(like(queryLogsTable.question, `[compartilhamento] %: Partilha ${tag}%`));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  if (ids.outraEmpresa) await db.delete(companiesTable).where(eq(companiesTable.id, ids.outraEmpresa));
  await app.close(); await pool.end();
});

test("pin requests and suggested titles are decided by code", () => {
  assert.ok(pinRequested("fixa esse faturamento")); assert.ok(pinRequested("salva essa resposta como favorito")); assert.ok(pinRequested("favorita isso"));
  assert.ok(!pinRequested("qual foi o faturamento de setembro")); assert.ok(!pinRequested("exporta essa resposta em planilha"));
  assert.equal(tituloSugerido("me mostra o faturamento de setembro?"), "O faturamento de setembro");
  assert.ok(temDatasLiterais(LITERAL)); assert.ok(!temDatasLiterais(RELATIVE));
});

test("literal dates are rewritten once, validated by running both today, and the live option is withdrawn when results differ", async () => {
  let calls = 0;
  const rewrite: DateRewriter = async () => { calls++; return { sql: RELATIVE, usage: { input: 10, output: 5 } }; };
  const logId = await logWith(LITERAL);
  // Simulate "today" by giving the query a clock where last month is September 2026: the two must match.
  const query = (sql: string) => runFreeQuery(sql.replace(/CURRENT_DATE/g, "DATE '2026-10-14'"));
  const draft = await runAsTenant(gestor(), () => prepararFavorito({ queryLogId: logId, tipo: "vivo" }, { rewrite, query }));
  assert.equal(calls, 1); assert.equal(draft.reescrita, "ok"); assert.ok(draft.podeVivo); assert.equal(draft.sql, RELATIVE);
  assert.equal(draft.resultado.forma, "numero");
  // Another day, the relative version would cover another month: the comparison fails and only "fixo" is offered.
  const other = (sql: string) => runFreeQuery(sql.replace(/CURRENT_DATE/g, "DATE '2026-11-20'"));
  const rejected = await runAsTenant(gestor(), () => prepararFavorito({ queryLogId: logId, tipo: "vivo" }, { rewrite, query: other }));
  assert.equal(rejected.reescrita, "rejeitada"); assert.equal(rejected.podeVivo, false); assert.match(rejected.motivo!, /diferente/);
  await assert.rejects(runAsTenant(gestor(), () => salvarFavorito({ rascunhoId: rejected.id, titulo: "x", tipo: "vivo", naTelaInicial: false })), /fixo/);
  const fixo = await runAsTenant(gestor(), () => salvarFavorito({ rascunhoId: rejected.id, titulo: "Setembro", tipo: "fixo", naTelaInicial: false }));
  assert.equal(fixo.kind, "fixo"); assert.ok(fixo.frozenAt && fixo.fixedResult && fixo.savedSql === null);
  // A rewrite that fails the guard is rejected too.
  const bad: DateRewriter = async () => ({ sql: "DELETE FROM vw_vendas_itens", usage: { input: 1, output: 1 } });
  const guarded = await runAsTenant(gestor(), () => prepararFavorito({ queryLogId: logId, tipo: "vivo" }, { rewrite: bad }));
  assert.equal(guarded.reescrita, "rejeitada");
  // The cost of the rewrite is in the audit log, with the same model accounting as answers.
  const costs = await db.select().from(queryLogsTable).where(eq(queryLogsTable.question, `[favorito] pergunta ${tag}`));
  assert.ok(costs.length >= 2 && Number(costs[0]!.estimatedCostUsd) > 0);
});

test("a live card runs the saved SQL without the model, is cached briefly, and a failing query turns into the refazer state", async () => {
  const logId = await logWith(NO_DATES);
  const neverCalled: DateRewriter = async () => { throw new Error("model must not be called"); };
  const draft = await runAsTenant(gestor(), () => prepararFavorito({ queryLogId: logId, tipo: "vivo" }, { rewrite: neverCalled }));
  assert.equal(draft.reescrita, "nao-necessaria"); assert.equal(draft.resultado.forma, "ranking");
  const saved = await runAsTenant(gestor(), () => salvarFavorito({ rascunhoId: draft.id, titulo: "Top clientes", tipo: "vivo", naTelaInicial: true }));
  assert.equal(saved.intervalSec, null, "no refresh interval: live cards follow the data marker");
  const before = (await db.select().from(queryLogsTable).where(like(queryLogsTable.question, "[favorito]%"))).length;
  _limparCaches();
  let runs = 0;
  const query = (sql: string) => { runs++; return runFreeQuery(sql); };
  let marca = "2026-10-14T10:00:00.000Z";
  const marcador = async () => ({ marcador: marca, estado: "em_dia" as const });
  const first = await runAsTenant(gestor(), () => executarFavorito(saved, { query, marcador }));
  const second = await runAsTenant(gestor(), () => executarFavorito(saved, { query, marcador }));
  assert.equal(first.estado, "ok"); assert.equal(second.estado, "ok"); assert.equal(runs, 1, "same marker: served from the cache, no SQL"); assert.ok(second.estado === "ok" && second.cache);
  marca = "2026-10-14T11:00:00.000Z";
  const third = await runAsTenant(gestor(), () => executarFavorito(saved, { query, marcador }));
  assert.ok(third.estado === "ok" && !third.cache && third.marcador === marca, "new data arrived (marker moved): the query runs again"); assert.equal(runs, 2);
  assert.equal((await db.select().from(queryLogsTable).where(like(queryLogsTable.question, "[favorito]%"))).length, before, "no model call and no audit row on refresh");
  const broken = { ...saved, savedSql: "SELECT nao_existe FROM vw_vendas_itens" };
  const failed = await runAsTenant(gestor(), () => executarFavorito(broken));
  assert.equal(failed.estado, "refazer");
  assert.ok((await runAsTenant(gestor(), () => pegarFavorito(saved.id))).lastError, "ultimo_erro recorded");
  // Over the HTTP route the card is the user's own; a colleague of the same company sees nothing.
  assert.equal((await call("GET", `/api/favoritos/${saved.id}/executar`, "gestor")).status, 200);
  assert.equal((await call("GET", `/api/favoritos/${saved.id}/executar`, "colega")).status, 404);
  assert.equal((await call("GET", "/api/favoritos", "colega")).body.itens.length, 0);
  assert.equal((await call("PATCH", `/api/favoritos/${saved.id}`, "colega", { titulo: "roubo" })).status, 404);
});

test("the route enforces the quota, the home limit and fixed-card immutability, and no refresh interval is offered", async () => {
  const logId = await logWith(NO_DATES);
  const prep = await call("POST", "/api/favoritos/preparar", "colega", { queryLogId: logId, tipo: "vivo" });
  assert.equal(prep.status, 200); assert.ok(!("sql" in prep.body), "SQL never leaves the server"); assert.ok(!("intervaloMinimoSeg" in prep.body));
  assert.ok(prep.body.previas.ranking && prep.body.previas.tabela, "the dialog gets a preview per compatible form");
  assert.equal((await call("POST", "/api/favoritos", "colega", { rascunhoId: prep.body.rascunhoId, titulo: "x", tipo: "vivo", intervaloSeg: 60, naTelaInicial: false })).status, 400, "interval is no longer accepted");
  const ok = await call("POST", "/api/favoritos", "colega", { rascunhoId: prep.body.rascunhoId, titulo: "x", tipo: "vivo", naTelaInicial: true });
  assert.equal(ok.status, 201); assert.ok(!("intervaloSeg" in ok.body));
  assert.equal((await call("PATCH", `/api/favoritos/${ok.body.id}`, "colega", { intervaloSeg: 300 })).status, 400);
  assert.equal((await call("PATCH", `/api/favoritos/${ok.body.id}`, "colega", { forma: "tabela" })).status, 200, "compatible form switch is saved");
  const lista = (await call("GET", "/api/favoritos", "colega")).body;
  assert.ok(!("intervalos" in lista) && !("intervaloMinimoSeg" in lista));
  // The data marker: stable for the demo company, exposed with its health state.
  const m1 = await call("GET", "/api/favoritos/marcador", "colega"); const m2 = await call("GET", "/api/favoritos/marcador", "colega");
  assert.equal(m1.status, 200); assert.ok(m1.body.marcador); assert.equal(m1.body.marcador, m2.body.marcador); assert.ok(["em_dia", "atencao", "desatualizado"].includes(m1.body.estado));
  const run = await call("GET", `/api/favoritos/${ok.body.id}/executar`, "colega");
  assert.equal(run.body.marcador, m1.body.marcador, "an execution carries the marker it was computed for");
  // Fixed copies: the value is frozen and never recalculated.
  const list = (await call("GET", "/api/favoritos", "colega")).body;
  const vivo = list.itens.find((f: { tipo: string }) => f.tipo === "vivo");
  const fixo = await call("POST", `/api/favoritos/${vivo.id}/congelar`, "colega");
  assert.equal(fixo.status, 201); assert.equal(fixo.body.tipo, "fixo"); assert.ok(fixo.body.guardadoEm);
  const frozen = await call("GET", `/api/favoritos/${fixo.body.id}/executar`, "colega");
  assert.equal(frozen.body.resultado.executadoEm, fixo.body.guardadoEm.replace(/\.\d{3}Z$/, (m: string) => m), "the frozen result is returned as stored");
  // Home strip: at most three; quota: thirty.
  for (let i = 0; i < 3; i++) {
    const p = await call("POST", "/api/favoritos/preparar", "colega", { queryLogId: logId, tipo: "fixo" });
    const r = await call("POST", "/api/favoritos", "colega", { rascunhoId: p.body.rascunhoId, titulo: `h${i}`, tipo: "fixo", naTelaInicial: true });
    if (i < 2) assert.equal(r.status, 201); else assert.equal(r.status, 409);
  }
  const current = (await call("GET", "/api/favoritos", "colega")).body.itens.length;
  for (let i = current; i < 30; i++) {
    const p = await call("POST", "/api/favoritos/preparar", "colega", { queryLogId: logId, tipo: "fixo" });
    assert.equal((await call("POST", "/api/favoritos", "colega", { rascunhoId: p.body.rascunhoId, titulo: `q${i}`, tipo: "fixo", naTelaInicial: false })).status, 201);
  }
  const p = await call("POST", "/api/favoritos/preparar", "colega", { queryLogId: logId, tipo: "fixo" });
  const over = await call("POST", "/api/favoritos", "colega", { rascunhoId: p.body.rascunhoId, titulo: "31", tipo: "fixo", naTelaInicial: false });
  assert.equal(over.status, 409); assert.match(over.body.error, /30 favoritos/);
  // Reorder and personal setting.
  const all = (await call("GET", "/api/favoritos", "colega")).body.itens.map((f: { id: number }) => f.id);
  const reordered = await call("PUT", "/api/favoritos/ordem", "colega", { ids: [...all].reverse() });
  assert.equal(reordered.body.itens[0].id, all.at(-1));
  assert.equal((await call("PUT", "/api/favoritos/configuracao", "colega", { faixaTelaInicial: false })).status, 200);
  assert.equal((await call("GET", "/api/favoritos", "colega")).body.faixaTelaInicial, false);
  // An answer without a data query cannot be pinned.
  const [plain] = await db.insert(queryLogsTable).values({ companyId: 1, question: "oi", answer: "olá", freedomLevel: 1, latencyMs: 1, parameters: {} }).returning(); logIds.push(plain!.id);
  assert.equal((await call("POST", "/api/favoritos/preparar", "colega", { queryLogId: plain!.id, tipo: "fixo" })).status, 422);
});

test("a disabled user loses access to their cards and administrators do not have the personal routes blocked by role", async () => {
  await db.update(usersTable).set({ active: false }).where(eq(usersTable.id, ids.colega!));
  assert.equal((await call("GET", "/api/favoritos", "colega")).status, 401);
  await db.update(usersTable).set({ active: true }).where(eq(usersTable.id, ids.colega!));
  assert.equal((await call("GET", "/api/favoritos", "admin")).status, 200);
});

test("shared favourites: administrators publish to the company, managers see and copy but never edit, companies stay isolated", async () => {
  const logId = await logWith(NO_DATES, `Partilha ${tag}`);
  await db.delete(favoritesTable).where(eq(favoritesTable.userId, ids.colega!)); // the quota test filled this manager's thirty
  const prep = async (as: string) => (await call("POST", "/api/favoritos/preparar", as, { queryLogId: logId, tipo: "vivo" })).body.rascunhoId;
  // A manager cannot share, neither when creating nor afterwards.
  const own = await call("POST", "/api/favoritos", "gestor", { rascunhoId: await prep("gestor"), titulo: `Partilha ${tag} gestor`, tipo: "vivo", naTelaInicial: false });
  assert.equal(own.status, 201); assert.equal(own.body.escopo, "pessoal"); assert.ok(own.body.meu && own.body.editavel);
  assert.equal((await call("POST", "/api/favoritos", "gestor", { rascunhoId: await prep("gestor"), titulo: "x", tipo: "vivo", naTelaInicial: false, compartilhar: true })).status, 403);
  assert.equal((await call("PATCH", `/api/favoritos/${own.body.id}`, "gestor", { escopo: "empresa" })).status, 403);
  assert.equal((await call("GET", "/api/favoritos", "gestor")).body.podeCompartilhar, false);
  // The administrator shares one card at creation and another one later (personal → shared).
  const shared = await call("POST", "/api/favoritos", "admin", { rascunhoId: await prep("admin"), titulo: `Partilha ${tag} A`, tipo: "vivo", naTelaInicial: false, compartilhar: true });
  assert.equal(shared.status, 201); assert.equal(shared.body.escopo, "empresa"); assert.ok(shared.body.compartilhadoEm);
  const later = await call("POST", "/api/favoritos", "admin", { rascunhoId: await prep("admin"), titulo: `Partilha ${tag} B`, tipo: "vivo", naTelaInicial: false });
  assert.equal(later.body.escopo, "pessoal");
  assert.equal((await call("GET", "/api/favoritos", "colega")).body.itens.filter((f: { id: number }) => f.id === later.body.id).length, 0, "personal card of the administrator is not visible");
  const published = await call("PATCH", `/api/favoritos/${later.body.id}`, "admin", { escopo: "empresa" });
  assert.equal(published.status, 200); assert.equal(published.body.escopo, "empresa");
  const audit = await db.select().from(queryLogsTable).where(like(queryLogsTable.question, `[compartilhamento] compartilhado: Partilha ${tag}%`));
  assert.equal(audit.length, 2, "who shared and when is in the audit log");
  // A manager of the same company sees both (section "da empresa"), with the creator's name, and cannot edit, rename, delete or unpublish them.
  const seen = (await call("GET", "/api/favoritos", "colega")).body;
  const vistos = seen.itens.filter((f: { escopo: string; titulo: string }) => f.escopo === "empresa" && f.titulo.startsWith(`Partilha ${tag}`));
  assert.equal(vistos.length, 2); assert.equal(vistos[0].meu, false); assert.equal(vistos[0].editavel, false); assert.equal(vistos[0].criadoPor.nome, "admin");
  assert.equal(seen.itens.filter((f: { id: number }) => f.id === own.body.id).length, 0, "another manager's personal card stays invisible");
  assert.equal((await call("PATCH", `/api/favoritos/${shared.body.id}`, "colega", { titulo: "roubo" })).status, 403);
  assert.equal((await call("PATCH", `/api/favoritos/${shared.body.id}`, "colega", { escopo: "pessoal" })).status, 403);
  assert.equal((await call("PATCH", `/api/favoritos/${shared.body.id}`, "colega", { naTelaInicial: true })).status, 403);
  assert.equal((await call("DELETE", `/api/favoritos/${shared.body.id}`, "colega")).status, 403);
  assert.equal((await call("PUT", `/api/favoritos/${shared.body.id}/consulta`, "colega", { rascunhoId: "qualquer" })).status, 403);
  // Executed with the viewer's own session (their company, their rate limit), not the creator's.
  _limparCaches();
  const run = await call("GET", `/api/favoritos/${shared.body.id}/executar`, "colega");
  assert.equal(run.status, 200); assert.equal(run.body.estado, "ok"); assert.equal(run.body.resultado.forma, "ranking");
  // Copy to personal: the manager owns the copy, which does not depend on the original any more.
  const copy = await call("POST", `/api/favoritos/${shared.body.id}/copiar`, "colega");
  assert.equal(copy.status, 201); assert.equal(copy.body.escopo, "pessoal"); assert.ok(copy.body.meu && copy.body.editavel); assert.equal(copy.body.titulo, shared.body.titulo);
  assert.equal((await call("PATCH", `/api/favoritos/${copy.body.id}`, "colega", { titulo: "Minha cópia", naTelaInicial: true })).status, 200);
  assert.equal((await call("POST", `/api/favoritos/${copy.body.id}/copiar`, "colega")).status, 403, "a personal card is not copied again");
  // Everyone's home strip: an administrator fixes a shared card; own cards come first, three at most; only shared cards qualify.
  assert.equal((await call("PATCH", `/api/favoritos/${own.body.id}`, "gestor", { naTelaInicialTodos: true })).status, 403);
  assert.equal((await call("PATCH", `/api/favoritos/${shared.body.id}`, "admin", { naTelaInicialTodos: true })).status, 200);
  const faixa = (await call("GET", "/api/favoritos", "colega")).body.faixa;
  assert.deepEqual(faixa.slice(0, 1), [copy.body.id]); assert.ok(faixa.includes(shared.body.id)); assert.ok(faixa.length <= 3);
  // Unpublishing takes it off everyone's screen; the copy survives.
  const back = await call("PATCH", `/api/favoritos/${shared.body.id}`, "admin", { escopo: "pessoal" });
  assert.equal(back.body.escopo, "pessoal"); assert.equal(back.body.naTelaInicialTodos, false);
  assert.equal((await call("GET", `/api/favoritos/${shared.body.id}/executar`, "colega")).status, 404);
  assert.equal((await call("GET", `/api/favoritos/${copy.body.id}/executar`, "colega")).status, 200);
  assert.equal((await call("PATCH", `/api/favoritos/${later.body.id}`, "admin", { naTelaInicialTodos: true })).status, 200);
  // Another administrator of the company may manage a shared card (rename), even one they did not create.
  await seed("admin2", "administrador", 1);
  assert.equal((await call("PATCH", `/api/favoritos/${later.body.id}`, "admin2", { titulo: `Partilha ${tag} B2` })).status, 200);
  // A deactivated creator: the shared card stays visible and runs for the others.
  await db.update(usersTable).set({ active: false }).where(eq(usersTable.id, ids.admin!));
  assert.equal((await call("GET", `/api/favoritos/${later.body.id}/executar`, "colega")).status, 200);
  await db.update(usersTable).set({ active: true }).where(eq(usersTable.id, ids.admin!));
  // Isolation: a user of another company sees none of it, even by id (library level, since that company has no data connected).
  const [c] = await db.insert(companiesTable).values({ name: `Outra ${tag}`, erp: "outro", dataReady: false }).returning(); ids.outraEmpresa = c!.id;
  await seed("forasteiro", "administrador", c!.id);
  const outro = { companyId: c!.id, userId: ids.forasteiro!, role: "administrador" as const };
  assert.equal((await runAsTenant(outro, () => listarFavoritos())).length, 0);
  await assert.rejects(runAsTenant(outro, () => pegarFavorito(later.body.id)), /não encontrado/);
  await assert.rejects(runAsTenant(outro, () => copiarFavorito(later.body.id)), /não encontrado/);
  // Shared quota: thirty per company, separate from the personal thirty.
  const existing = (await call("GET", "/api/favoritos", "admin")).body.itens.filter((f: { escopo: string }) => f.escopo === "empresa").length;
  for (let i = existing; i < 30; i++) {
    const r = await call("POST", "/api/favoritos", "admin", { rascunhoId: await prep("admin"), titulo: `Partilha ${tag} q${i}`, tipo: "fixo", naTelaInicial: false, compartilhar: true });
    assert.equal(r.status, 201, `shared #${i + 1}`);
  }
  const over = await call("POST", "/api/favoritos", "admin", { rascunhoId: await prep("admin"), titulo: `Partilha ${tag} 31`, tipo: "fixo", naTelaInicial: false, compartilhar: true });
  assert.equal(over.status, 409); assert.match(over.body.error, /30 favoritos compartilhados/);
  assert.equal((await call("POST", "/api/favoritos", "admin", { rascunhoId: await prep("admin"), titulo: `Partilha ${tag} pessoal`, tipo: "fixo", naTelaInicial: false })).status, 201, "personal quota is independent");
  await db.delete(favoritesTable).where(and(eq(favoritesTable.companyId, 1), eq(favoritesTable.scope, "empresa"), like(favoritesTable.title, `Partilha ${tag}%`)));
});

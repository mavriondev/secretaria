import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { inArray } from "drizzle-orm";
import { db, favoritesTable, pool, queryLogsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { runAsTenant } from "../lib/tenant";
import { _limparCaches, executarFavorito, fonteDosParametros, prepararFavorito, salvarFavorito, type DateRewriter } from "../lib/favoritos";
import { metricaDosParametros, periodoRelativo, resultadoDaMetrica, rodarMetrica, type MetricaSalva } from "../lib/favoritos-metrica";
import { resolvePeriod } from "../lib/periods";

const tag = Math.random().toString(36).slice(2, 8);
const ids: Record<string, number> = {};
const emails: string[] = [];
const logIds: number[] = [];
const cookies: Record<string, string> = {};
async function seed(key: string, companyId: number) {
  const email = `${key}.favm.${tag}@teste.local`.toLowerCase(); emails.push(email);
  const [u] = await db.insert(usersTable).values({ companyId, email, name: key, role: "gestor", passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false }).returning();
  ids[key] = u!.id;
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
/** An audit log shaped like a real answer of a ready-made shortcut (what assistant.ts records in _executions). */
async function logWith(tool: string, parameters: Record<string, unknown>, question = `atalho ${tag}`) {
  const [log] = await db.insert(queryLogsTable).values({ companyId: 1, question, answer: "resposta", freedomLevel: 1, latencyMs: 10, functionName: tool,
    parameters: { _fixavel: true, _executions: [{ tool, parameters, result: { metric: tool } }] } }).returning();
  logIds.push(log!.id); return log!.id;
}
const gestor = () => ({ companyId: 1, userId: ids.gestor!, role: "gestor" as const });
const neverRewrite: DateRewriter = async () => { throw new Error("model must not be called"); };

before(async () => { await ensureDemoCompany(); await app.ready(); await seed("gestor", 1); await seed("colega", 1); });
after(async () => {
  await db.delete(favoritesTable).where(inArray(favoritesTable.userId, Object.values(ids)));
  if (logIds.length) await db.delete(queryLogsTable).where(inArray(queryLogsTable.id, logIds));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  await app.close(); await pool.end();
});

test("a shortcut answer is a pinnable source, and only relative periods can be live", () => {
  const params = { _executions: [{ tool: "faturamento", parameters: { periodo: "this_month", meses: null, data_inicio: "2026-10-01", data_fim: "2026-10-14" }, result: {} }] };
  const found = metricaDosParametros(params);
  assert.equal(found?.ferramenta, "faturamento"); assert.ok(fonteDosParametros(params)?.metrica);
  assert.ok(periodoRelativo(found!));
  assert.ok(!periodoRelativo({ ferramenta: "faturamento", parametros: { periodo: "custom", data_inicio: "2026-09-01", data_fim: "2026-09-30" } }));
  assert.ok(periodoRelativo({ ferramenta: "contas_a_receber_vencidas", parametros: { data_referencia: "2026-10-14", _hoje: true } }));
  assert.ok(!periodoRelativo({ ferramenta: "contas_a_receber_vencidas", parametros: { data_referencia: "2026-10-01" } }));
  assert.equal(metricaDosParametros({ _executions: [{ tool: "responder" }] }), null);
  assert.equal(metricaDosParametros({ _executions: [{ tool: "faturamento", parameters: {} }] }), null, "a shortcut without result (clarification) is not pinnable");
});

test("a live shortcut card re-runs the metric with the period resolved on the day it runs, without the model", async () => {
  const logId = await logWith("faturamento", { periodo: "this_month", meses: null, comparar_com: "anterior", data_inicio: "2026-10-01", data_fim: "2026-10-14" }, `Quanto vendemos este mês? ${tag}`);
  const draft = await runAsTenant(gestor(), () => prepararFavorito({ queryLogId: logId, tipo: "vivo" }, { rewrite: neverRewrite }));
  assert.equal(draft.reescrita, "nao-necessaria"); assert.ok(draft.podeVivo); assert.equal(draft.resultado.forma, "numero"); assert.equal(draft.metrica?.ferramenta, "faturamento");
  const saved = await runAsTenant(gestor(), () => salvarFavorito({ rascunhoId: draft.id, titulo: "Vendas do mês", tipo: "vivo", intervaloSeg: 300, naTelaInicial: false }));
  assert.equal(saved.tool, "faturamento"); assert.equal(saved.savedSql, null); assert.equal(saved.toolParams?.periodo, "this_month");
  const before = (await db.select().from(queryLogsTable)).length;
  _limparCaches();
  const seen: string[] = [];
  const metrica = async (m: MetricaSalva, now: Date) => { seen.push(resolvePeriod({ preset: m.parametros.periodo as "this_month" }, now).startDate); return resultadoDaMetrica(m, await rodarMetrica(m, now)); };
  const today = await runAsTenant(gestor(), () => executarFavorito(saved, { metrica, now: () => new Date("2026-10-14T15:00:00Z") }));
  const otherDay = await runAsTenant(gestor(), () => executarFavorito(saved, { metrica, now: () => new Date("2026-11-20T15:00:00Z") }));
  assert.equal(today.estado, "ok"); assert.equal(otherDay.estado, "ok");
  assert.deepEqual(seen, ["2026-10-01", "2026-11-01"], "the period follows the calendar of the day the card runs");
  const again = await runAsTenant(gestor(), () => executarFavorito(saved, { metrica, now: () => new Date("2026-11-20T15:00:10Z") }));
  assert.ok(again.estado === "ok" && again.cache, "served from the short cache"); assert.equal(seen.length, 2);
  assert.equal((await db.select().from(queryLogsTable)).length, before, "no model call and no audit row");
  // Isolation: a colleague of the same company cannot see or run it.
  const res = await app.inject({ method: "GET", url: `/api/favoritos/${saved.id}/executar`, headers: { cookie: cookies.colega! } });
  assert.equal(res.statusCode, 404);
});

test("a literal period can only be fixed, with the reason; the fixed card keeps the value", async () => {
  const logId = await logWith("faturamento", { periodo: "custom", meses: null, data_inicio: "2026-09-01", data_fim: "2026-09-30" }, `Faturamento de setembro ${tag}`);
  const draft = await runAsTenant(gestor(), () => prepararFavorito({ queryLogId: logId, tipo: "vivo" }, { rewrite: neverRewrite }));
  assert.ok(!draft.podeVivo); assert.match(draft.motivo ?? "", /datas fixas/);
  await assert.rejects(runAsTenant(gestor(), () => salvarFavorito({ rascunhoId: draft.id, titulo: "Setembro", tipo: "vivo", intervaloSeg: 300, naTelaInicial: false })), /ao vivo/);
  const fixed = await runAsTenant(gestor(), () => salvarFavorito({ rascunhoId: draft.id, titulo: "Setembro", tipo: "fixo", naTelaInicial: false }));
  assert.equal(fixed.kind, "fixo"); assert.equal(fixed.tool, null); assert.ok(fixed.frozenAt);
  const run = await runAsTenant(gestor(), () => executarFavorito(fixed));
  assert.ok(run.estado === "ok" && run.resultado.dados.form === "numero");
});

test("ranking for best sellers and a table for overdue receivables, through the same card pipeline", async () => {
  const produtos = await logWith("produtos_mais_vendidos", { periodo: "this_month", meses: null, limite: 5, data_inicio: "2026-10-01", data_fim: "2026-10-14" });
  const vencidos = await logWith("contas_a_receber_vencidas", { data_referencia: "2026-10-14", _hoje: true });
  const d1 = await runAsTenant(gestor(), () => prepararFavorito({ queryLogId: produtos, tipo: "vivo" }, { rewrite: neverRewrite }));
  const d2 = await runAsTenant(gestor(), () => prepararFavorito({ queryLogId: vencidos, tipo: "vivo" }, { rewrite: neverRewrite }));
  assert.equal(d1.resultado.forma, "ranking"); assert.ok(d1.podeVivo);
  assert.equal(d2.resultado.forma, "tabela"); assert.ok(d2.podeVivo);
  assert.deepEqual(d2.resultado.columns.map(c => c.name), ["cliente", "valor", "titulos", "dias"]);
});

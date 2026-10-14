import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { companiesTable, costsTable, db, favoritesTable, pool, queryLogsTable, usersTable } from "@workspace/db";
import app from "../app";
import { ensureDemoCompany, hashPassword } from "../lib/auth";
import { camposDaConsulta, dataPorExtenso, explicarFavorito, explicarResposta, periodoDaConsulta, periodoRelativoTexto } from "../lib/explicacao";
import { runAsTenant } from "../lib/tenant";
import { DEMO_FICHA } from "../lib/ficha";

const tag = Math.random().toString(36).slice(2, 8);
const ids: Record<string, number> = {};
const emails: string[] = [];
const logIds: number[] = [];
const cookies: Record<string, string> = {};
let outraEmpresa = 0;

const call = async (url: string, as: string) => {
  const res = await app.inject({ method: "GET", url, headers: { cookie: cookies[as]! } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
async function seed(key: string, role: "administrador" | "gestor", companyId: number) {
  const email = `${key}.expl.${tag}@teste.local`.toLowerCase(); emails.push(email);
  const [u] = await db.insert(usersTable).values({ companyId, email, name: key, role, passwordHash: await hashPassword("senha-de-teste-1"), mustChangePassword: false }).returning();
  ids[key] = u!.id;
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, senha: "senha-de-teste-1" } })).headers["set-cookie"]).split(";")[0]!;
}
async function log(companyId: number, question: string, parameters: Record<string, unknown>) {
  const [row] = await db.insert(queryLogsTable).values({ companyId, question, answer: "resposta", freedomLevel: 1, latencyMs: 10, functionName: null, parameters }).returning();
  logIds.push(row!.id); return row!.id;
}
const custos = async () => (await db.select({ id: costsTable.id }).from(costsTable)).length;

const faturamentoLog = () => ({ _fixavel: true, _executions: [{ tool: "faturamento",
  parameters: { periodo: "this_month", meses: null, data_inicio: "2026-10-01", data_fim: "2026-10-14", comparar_com: "anterior", apresentacao: "normal" },
  result: { metric: "faturamento", value: 1234.5, period: { label: "Este mês até hoje", startDate: "2026-10-01", endDate: "2026-10-14", referenceDate: null },
    filters: ["Empresa: CODEMP = 1"], lastUpdatedAt: "2026-10-14T06:00:00.000Z", comparisons: [], details: [], rawResult: {} } }] });
const livreLog = () => ({ _fixavel: true, _executions: [
  { tool: "responder", kind: "general" },
  { tool: "consultar_dados", interpretacao: "considerei vendas confirmadas de outubro de 2026 por cliente", sql: "SELECT cliente, SUM(valor_liquido) AS total_vendido FROM vw_vendas_itens WHERE data BETWEEN '2026-10-01' AND '2026-10-14' GROUP BY cliente ORDER BY total_vendido DESC LIMIT 50",
    formatos: [{ coluna: "total_vendido", formato: "dinheiro", rotulo: "Total vendido" }], tentativas: [], linhas: 12, truncado: false, views: ["vw_vendas_itens"], status: "ok" },
] });

before(async () => {
  await ensureDemoCompany(); await app.ready();
  await seed("gestor", "gestor", 1); await seed("admin", "administrador", 1);
  const [c] = await db.insert(companiesTable).values({ name: `Outra ${tag}`, erp: "outro", dataReady: false }).returning(); outraEmpresa = c!.id;
  await seed("forasteiro", "administrador", outraEmpresa);
});
after(async () => {
  await db.delete(favoritesTable).where(inArray(favoritesTable.userId, Object.values(ids)));
  if (logIds.length) await db.delete(queryLogsTable).where(inArray(queryLogsTable.id, logIds));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
  if (outraEmpresa) await db.delete(companiesTable).where(eq(companiesTable.id, outraEmpresa));
  await app.close(); await pool.end();
});

test("dates, relative periods and query fields are rendered in Portuguese by code", () => {
  assert.equal(dataPorExtenso("2026-10-01"), "1 de outubro de 2026");
  assert.equal(periodoRelativoTexto({ periodo: "this_month" }), "mês atual, até hoje");
  assert.equal(periodoRelativoTexto({ periodo: "rolling_months", meses: 3 }), "últimos 3 meses, até hoje");
  assert.equal(periodoRelativoTexto({ periodo: "custom" }), null);
  assert.equal(periodoDaConsulta("SELECT 1 FROM vw_vendas_itens WHERE data BETWEEN '2026-10-01' AND '2026-10-14'", "2026-10-14")?.texto, "de 1 de outubro de 2026 a 14 de outubro de 2026");
  assert.equal(periodoDaConsulta("SELECT 1 FROM vw_vendas_itens WHERE data >= date_trunc('month', CURRENT_DATE)", "2026-10-14")?.relativo, "acompanha o dia de hoje");
  assert.equal(periodoDaConsulta("SELECT placa FROM vw_frota_veiculos", "2026-10-14"), null);
  assert.deepEqual(camposDaConsulta("SELECT placa, descricao AS veiculo, COUNT(*) AS total_viagens FROM vw_frota_viagens GROUP BY 1, 2", [{ coluna: "total_viagens", formato: "inteiro", rotulo: "Viagens" }], ["vw_frota_viagens"], DEMO_FICHA), ["Placa", "Veiculo", "Viagens"]);
});

test("a shortcut answer explains period, sources and method; the manager never sees SQL, the administrator does", async () => {
  const before = await custos();
  const id = await log(1, `Quanto vendemos este mês? ${tag}`, faturamentoLog());
  const gestor = await call(`/api/assistant/respostas/${id}/explicacao`, "gestor");
  assert.equal(gestor.status, 200);
  const e = gestor.body;
  assert.equal(e.origem, "atalho");
  assert.equal(e.periodo.texto, "de 1 de outubro de 2026 a 14 de outubro de 2026");
  assert.equal(e.periodo.relativo, "mês atual, até hoje");
  assert.deepEqual(e.fontes.map((f: { assunto: string }) => f.assunto), ["Vendas"]);
  assert.match(e.metodo, /Soma do valor líquido dos itens de vendas confirmadas/);
  assert.match(e.metodo, /período imediatamente anterior/);
  assert.equal(e.dadosDe, "2026-10-14T06:00:00.000Z");
  assert.equal(e.sql, null); assert.deepEqual(e.tabelas, []);
  assert.ok(!JSON.stringify(e).includes("vw_vendas_itens"), "no technical table name reaches the manager");
  const admin = await call(`/api/assistant/respostas/${id}/explicacao`, "admin");
  assert.equal(admin.status, 200);
  assert.match(admin.body.sql, /SUM\(valor_liquido\)[\s\S]*BETWEEN '2026-10-01' AND '2026-10-14'/);
  assert.deepEqual(admin.body.tabelas, ["vw_vendas_itens"]);
  assert.equal(await custos(), before, "the explanation never calls the model");
});

test("a free-query answer uses the recorded interpretation, labelled fields and row count", async () => {
  const id = await log(1, `Vendas por cliente ${tag}`, livreLog());
  const e = (await call(`/api/assistant/respostas/${id}/explicacao`, "gestor")).body;
  assert.equal(e.origem, "livre");
  assert.equal(e.entendimento, "considerei vendas confirmadas de outubro de 2026 por cliente");
  assert.deepEqual(e.campos, ["Cliente", "Total vendido"]);
  assert.equal(e.linhas, 12); assert.equal(e.truncado, false);
  assert.equal(e.periodo.texto, "de 1 de outubro de 2026 a 14 de outubro de 2026");
  assert.equal(e.sql, null);
  assert.ok(e.dadosDe, "the data marker stands in for the age of the data");
  const admin = (await call(`/api/assistant/respostas/${id}/explicacao`, "admin")).body;
  assert.match(admin.sql, /^SELECT cliente/);
});

test("answers without internal data have no explanation to offer", async () => {
  const conversa = await log(1, `Bom dia ${tag}`, { _executions: [{ tool: "responder", kind: "general" }] });
  assert.equal((await call(`/api/assistant/respostas/${conversa}/explicacao`, "gestor")).body.origem, "nenhuma");
  const web = await log(1, `Dólar hoje ${tag}`, { _executions: [{ tool: "pesquisar", topic: "dólar" }], _sources: [{ title: "PTAX", url: "https://www.bcb.gov.br", retrievedAt: "2026-10-14T10:00:00Z", referenceDate: null }] });
  const e = (await call(`/api/assistant/respostas/${web}/explicacao`, "gestor")).body;
  assert.equal(e.origem, "externa"); assert.equal(e.fontesPublicas[0].url, "https://www.bcb.gov.br");
});

test("live and fixed favourites are explained from what the card stores, with the relative period spelled out", async () => {
  const [vivo] = await db.insert(favoritesTable).values({ companyId: 1, userId: ids.gestor!, title: `Vendas do mês ${tag}`, originalQuestion: "Quanto vendemos este mês?", kind: "vivo",
    tool: "faturamento", toolParams: { periodo: "this_month", meses: null, data_inicio: "2026-10-01", data_fim: "2026-10-14", apresentacao: "normal" }, formats: [], form: "numero", order: 0 }).returning();
  const e = (await call(`/api/favoritos/${vivo!.id}/explicacao`, "gestor")).body;
  assert.equal(e.origem, "atalho"); assert.equal(e.periodo.relativo, "mês atual, até hoje");
  assert.match(e.periodo.texto, /^de 1 de \w+ de \d{4} a \d+ de \w+ de \d{4}$/);
  assert.ok(e.filtros.some((f: string) => /recalculado quando chegam dados novos/.test(f)));
  assert.equal(e.sql, null);
  const logId = await log(1, `Vendas por cliente ${tag}`, livreLog());
  const [fixo] = await db.insert(favoritesTable).values({ companyId: 1, userId: ids.gestor!, title: `Clientes de outubro ${tag}`, originalQuestion: "Vendas por cliente em outubro", kind: "fixo", queryLogId: logId,
    savedSql: null, formats: [{ coluna: "total_vendido", formato: "dinheiro", rotulo: "Total vendido" }], form: "tabela", order: 1, frozenAt: new Date("2026-10-14T12:00:00Z"),
    fixedResult: { columns: [{ name: "cliente", label: "Cliente", type: "texto" }, { name: "total_vendido", label: "Total vendido", type: "dinheiro" }], rows: [{ cliente: "A", total_vendido: "10" }, { cliente: "B", total_vendido: "5" }], truncated: false, updatedAt: "2026-10-14T06:00:00.000Z", executadoEm: "2026-10-14T12:00:00.000Z", forma: "tabela", formas: ["tabela"], dados: { form: "tabela", columns: [], rows: [] } } }).returning();
  const f = (await call(`/api/favoritos/${fixo!.id}/explicacao`, "gestor")).body;
  assert.equal(f.origem, "livre"); assert.equal(f.linhas, 2); assert.equal(f.dadosDe, "2026-10-14T06:00:00.000Z");
  assert.equal(f.entendimento, "considerei vendas confirmadas de outubro de 2026 por cliente", "interpretation comes from the answer the card was pinned from");
  assert.deepEqual(f.campos, ["Cliente", "Total vendido"]);
  assert.ok(f.filtros.some((x: string) => /não é recalculado/.test(x)));
  assert.equal((await call(`/api/favoritos/${vivo!.id}/explicacao`, "admin")).status, 404, "a personal card of another user is not visible");
});

test("nothing crosses companies: another company's user never reaches the log or the card", async () => {
  const id = await log(1, `Isolamento ${tag}`, faturamentoLog());
  const [card] = await db.select({ id: favoritesTable.id }).from(favoritesTable).where(eq(favoritesTable.userId, ids.gestor!)).limit(1);
  // Over HTTP the other company has no data connected yet, so the route is closed before any lookup (409); at library level the lookup itself finds nothing.
  assert.equal((await call(`/api/assistant/respostas/${id}/explicacao`, "forasteiro")).status, 409);
  const outro = { companyId: outraEmpresa, userId: ids.forasteiro!, role: "administrador" as const };
  await assert.rejects(runAsTenant(outro, () => explicarResposta(id)), /Não encontrei/);
  await assert.rejects(runAsTenant(outro, () => explicarFavorito(card!.id)), /não encontrado/);
  const daOutra = await log(outraEmpresa, `Da outra ${tag}`, faturamentoLog());
  assert.equal((await call(`/api/assistant/respostas/${daOutra}/explicacao`, "gestor")).status, 404);
  assert.equal((await call(`/api/assistant/respostas/${daOutra}/explicacao`, "admin")).status, 404);
});
